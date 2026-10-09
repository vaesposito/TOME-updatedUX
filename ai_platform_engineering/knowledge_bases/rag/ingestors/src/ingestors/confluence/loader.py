"""Confluence-specific utilities for authenticated web loading and document ID generation.

This module provides helper functions for creating authenticated Confluence sessions,
generating datasource and document IDs, and enhancing metadata with Confluence-specific fields.
"""

import re
import time
import hashlib
import json
from urllib.parse import parse_qs, urlparse, urljoin
from typing import Dict, List, Any, Tuple, Optional
import aiohttp
from aiohttp_retry import RetryClient, ExponentialRetry
from aiohttp import ClientTimeout
from bs4 import BeautifulSoup
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from common.job_manager import JobManager, JobStatus
from common.models.rag import DataSourceInfo, DocumentMetadata
from common.utils import (
  generate_confluence_datasource_id,
  get_fresh_until,
  get_logger,
)

logger = get_logger(__name__)

# Configuration constants
CONFLUENCE_BATCH_SIZE = 100  # Documents per batch
CONFLUENCE_API_PAGE_LIMIT = 100  # Pages per API call for pagination


def generate_datasource_id(
  confluence_url: str,
  space_key: str,
  page_id: Optional[str] = None,
) -> str:
  """Generate datasource ID for a Confluence space or page.

  Format: src_confluence___{domain_normalized}__{space_key}[__{page_id}]

  Args:
      confluence_url: Base URL of the Confluence instance
      space_key: Confluence space key
      page_id: Root page ID for a page-scoped datasource. Omit for a legacy
          whole-space datasource.
  Returns:
      Datasource ID string
  """
  return generate_confluence_datasource_id(confluence_url, space_key, page_id)


class ConfluenceLoader:
  """Loader for fetching and ingesting Confluence pages."""

  def __init__(
    self,
    rag_client,
    job_manager: JobManager,
    datasource_info: DataSourceInfo,
    confluence_url: str,
    username: str,
    token: str,
    verify_ssl: bool,
    max_concurrency: int,
    allowed_title_patterns: Optional[List[str]] = None,
    denied_title_patterns: Optional[List[str]] = None,
  ):
    self.rag_client = rag_client
    self.job_manager = job_manager
    self.datasource_info = datasource_info
    self.confluence_url = confluence_url
    self.max_concurrency = max_concurrency
    self.logger = get_logger(f"confluence_loader:{datasource_info.datasource_id[16:]}")

    # Title filtering (regex patterns, mirroring webloader's URL pattern filtering)
    self.allowed_title_patterns = allowed_title_patterns or []
    self.denied_title_patterns = denied_title_patterns or []
    # Set by ``load_pages`` when a caller supplies ``max_pages`` and more
    # candidates exist. Preview uses this to report a bounded sample even when
    # title filters reduce the returned list below the visible item limit.
    self.last_load_truncated = False

    # Chunking configuration
    self.chunk_size = datasource_info.default_chunk_size
    self.chunk_overlap = datasource_info.default_chunk_overlap
    self.text_splitter = RecursiveCharacterTextSplitter(
      chunk_size=self.chunk_size,
      chunk_overlap=self.chunk_overlap,
      separators=["\n\n", "\n", ". ", " ", ""],
    )

    self.session = None
    self._auth = (username, token)
    self._verify_ssl = verify_ssl

  async def __aenter__(self):
    """Set up retry-enabled session."""
    retry_options = ExponentialRetry(
      attempts=4,
      start_timeout=1.0,
      max_timeout=60.0,
      factor=2.0,
      statuses={429, 502, 503, 504},
      retry_all_server_errors=False,
    )

    base_session = aiohttp.ClientSession(
      timeout=ClientTimeout(total=30),
      auth=aiohttp.BasicAuth(*self._auth),
      connector=aiohttp.TCPConnector(verify_ssl=self._verify_ssl),
      headers={
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; ConfluenceRAGIngestor/1.0)",
      },
    )
    self.session = RetryClient(client_session=base_session, retry_options=retry_options)
    return self

  async def __aexit__(self, exc_type, exc_val, exc_tb):
    """Close session."""
    if self.session:
      await self.session.close()

  def should_skip_page(self, title: str) -> bool:
    """Check whether a page should be skipped based on title filter patterns.

    Mirrors webloader's URL pattern filtering (allowed_url_patterns / denied_url_patterns).
    - If allowed_title_patterns is set, title must match at least one pattern.
    - If denied_title_patterns is set, title must not match any pattern.

    Args:
        title: Confluence page title

    Returns:
        True if the page should be skipped (filtered out).
    """
    if self.allowed_title_patterns:
      if not any(re.search(p, title, re.IGNORECASE) for p in self.allowed_title_patterns):
        self.logger.info(f"Skipping page (title not in allowed patterns): {title!r}")
        return True

    if self.denied_title_patterns:
      if any(re.search(p, title, re.IGNORECASE) for p in self.denied_title_patterns):
        self.logger.info(f"Skipping page (title matches denied pattern): {title!r}")
        return True

    return False

  def _api_url(self, path: str) -> str:
    """Accept a Cloud site root or its /wiki context without duplicating it."""
    return f"{self.confluence_url.rstrip('/').removesuffix('/wiki')}/wiki/rest/api/{path}"

  async def _search_pages(
    self, cql: str, limit: int, cursor: Optional[str] = None, with_body: bool = True,
  ) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    params: Dict[str, Any] = {"cql": cql, "limit": limit}
    if with_body:
      params["expand"] = "content.body.storage,content.version,content.space,content.history,content.history.lastUpdated"
    if cursor:
      params["cursor"] = cursor
    async with self.session.get(self._api_url("search"), params=params) as resp:
      if resp.status != 200:
        raise ValueError(f"Confluence search failed (HTTP {resp.status}); verify connector grants and page visibility for 401/403")
      data = await resp.json()
    if not isinstance(data, dict) or not isinstance(data.get("results"), list):
      raise ValueError("Confluence search response is missing results")
    pages = []
    for item in data["results"]:
      page = item.get("content") if isinstance(item, dict) else None
      if not isinstance(page, dict) or not page.get("id"):
        raise ValueError("Confluence search response is missing a content ID")
      if with_body:
        body = page.get("body")
        storage = body.get("storage") if isinstance(body, dict) else None
        if not isinstance(storage, dict) or not isinstance(storage.get("value"), str):
          raise ValueError(f"Confluence page {page['id']} is missing its expanded storage body")
      page["_source_fetched_at"] = int(time.time())
      pages.append(page)
    next_link = data.get("_links", {}).get("next")
    next_cursor = parse_qs(urlparse(next_link).query).get("cursor", [None])[0] if next_link else None
    if next_link and not next_cursor:
      raise ValueError("Confluence continuation has no cursor; enumeration is incomplete")
    return pages, next_cursor

  async def fetch_child_pages(
    self, parent_page_id: str, max_results: Optional[int] = None,
  ) -> Tuple[List[str], List[Tuple[str, str]], bool]:
    """Enumerate direct children via CQL parent, preserving the selected scope."""
    child_ids: List[str] = []
    cursor = None
    seen_cursors = set()
    try:
      if not str(parent_page_id).isascii() or not str(parent_page_id).isdecimal():
        raise ValueError("Parent page ID must contain ASCII digits")
      while True:
        remaining = CONFLUENCE_API_PAGE_LIMIT if max_results is None else min(CONFLUENCE_API_PAGE_LIMIT, max_results + 1 - len(child_ids))
        batch, next_cursor = await self._search_pages(f"type=page AND parent={parent_page_id} ORDER BY created ASC", remaining, cursor, with_body=False)
        ids = [str(page["id"]) for page in batch]
        if len(set(ids)) != len(ids) or set(ids).intersection(child_ids):
          raise ValueError("Confluence child enumeration repeated a page")
        child_ids.extend(ids)
        if max_results is not None and len(child_ids) > max_results:
          return child_ids[:max_results], [], True
        if not next_cursor:
          return child_ids, [], False
        if next_cursor in seen_cursors:
          raise ValueError("Confluence child enumeration repeated a cursor")
        seen_cursors.add(next_cursor)
        cursor = next_cursor
    except (aiohttp.ClientError, ValueError, TypeError) as exc:
      self.logger.error("Child enumeration failed for %s: %s", parent_page_id, exc)
      return child_ids, [(parent_page_id, str(exc))], False

  def extract_text_from_html(self, html_content: str) -> str:
    """Keep table column associations, link targets and external macro provenance."""
    soup = BeautifulSoup(html_content, "html.parser")
    for node in soup.find_all(["script", "style"]):
      node.decompose()
    for link in soup.find_all("a", href=True):
      label = link.get_text(" ", strip=True)
      href = str(link["href"])
      link.replace_with(f"{label} ({href})" if label else href)
    for macro in soup.find_all("ac:structured-macro"):
      if macro.get("ac:name") == "jira":
        params = [f"{node.get('ac:name', 'value')}={node.get_text(' ', strip=True)}" for node in macro.find_all("ac:parameter")]
        macro.replace_with("External issue macro: " + "; ".join(params) + " (live issue status was not fetched)")
    for table in reversed(soup.find_all("table")):
      rows = table.find_all("tr")
      headers: List[str] = []
      lines = []
      for row in rows:
        cells = row.find_all(["td", "th"], recursive=False)
        values = [cell.get_text(" ", strip=True) for cell in cells]
        if not values:
          continue
        if not headers and all(cell.name == "th" for cell in cells):
          headers = values
          lines.append(" | ".join(values))
        elif headers and len(headers) == len(values) and all(cell.get("colspan", "1") == "1" and cell.get("rowspan", "1") == "1" for cell in cells):
          lines.append(" | ".join(f"{header}: {value}" for header, value in zip(headers, values)))
        else:
          lines.append(" | ".join(values))
      table.replace_with("\n" + "\n".join(lines) + "\n")
    return soup.get_text(separator="\n", strip=True)

  async def fetch_page_content(self, page_id: str) -> Tuple[Optional[Dict], Optional[Tuple[str, str]]]:
    """Fetch the complete storage body through a classic-scope CQL expansion."""
    try:
      if not str(page_id).isascii() or not str(page_id).isdecimal():
        raise ValueError("Page ID must contain ASCII digits")
      pages, _ = await self._search_pages(f"type=page AND id={page_id}", 1)
      if len(pages) != 1 or str(pages[0]["id"]) != str(page_id):
        raise ValueError("Page not found or not visible to the connected user")
      return pages[0], None
    except (aiohttp.ClientError, ValueError, TypeError) as exc:
      self.logger.error("Page fetch failed for %s: %s", page_id, exc)
      return None, (page_id, str(exc))

  async def load_pages(
    self,
    space_key: str,
    page_configs: Optional[List[Dict[str, Any]]] = None,
    page_limit: int = CONFLUENCE_API_PAGE_LIMIT,
    max_pages: Optional[int] = None,
  ) -> Tuple[List[Dict[str, Any]], List[Tuple[str, str]]]:
    """Load pages from Confluence space via REST API.

    Args:
        space_key: Confluence space key
        page_configs: List of page config dicts, each with:
            - page_id (required): Page ID to fetch
            - get_child_pages (optional, default False): Include direct children
        page_limit: Number of pages per API call for enumeration
        max_pages: Optional hard cap used by non-persisting previews

    Returns:
        tuple: (list of successfully fetched pages, list of (page_id, error_msg) tuples)
    """
    self.logger.info(f"Loading pages from space {space_key}")
    self.logger.debug(f"Loading pages with space_key={space_key}, page_configs={page_configs}")
    pages = []
    failed_pages = []
    self.last_load_truncated = False

    if page_configs:
      for config in page_configs:
        if max_pages is not None and len(pages) >= max_pages:
          self.last_load_truncated = True
          break
        page_id = config.get("page_id")
        if not page_id:
          failed_pages.append((space_key, "Selected page configuration is missing page_id"))
          continue

        # Fetch parent page
        page, failure = await self.fetch_page_content(page_id)
        if page:
          pages.append(page)
        if failure:
          failed_pages.append(failure)
          continue

        # Fetch child pages if requested
        if config.get("get_child_pages", False):
          remaining = None if max_pages is None else max(0, max_pages - len(pages))
          child_ids, child_failures, children_truncated = await self.fetch_child_pages(
            page_id,
            max_results=remaining,
          )
          self.last_load_truncated = self.last_load_truncated or children_truncated
          failed_pages.extend(child_failures)

          for child_id in child_ids:
            child_page, child_failure = await self.fetch_page_content(child_id)
            if child_page:
              pages.append(child_page)
            if child_failure:
              failed_pages.append(child_failure)
    else:
      # Search continuation cursors, not short-batch size, determine completeness.
      cursor = None
      seen_cursors = set()
      seen_ids = set()
      while True:
        try:
          batch, next_cursor = await self._search_pages(
            "type=page AND space=" + json.dumps(space_key) + " ORDER BY created ASC", page_limit, cursor,
          )
          ids = [str(page["id"]) for page in batch]
          if len(set(ids)) != len(ids) or seen_ids.intersection(ids):
            raise ValueError("Confluence enumeration repeated a page")
          seen_ids.update(ids)
          if max_pages is not None and len(pages) + len(batch) > max_pages:
            pages.extend(batch[:max(0, max_pages - len(pages))])
            self.last_load_truncated = True
            break
          pages.extend(batch)
          if max_pages is not None and len(pages) >= max_pages:
            self.last_load_truncated = bool(next_cursor)
            break
          if not next_cursor:
            break
          if next_cursor in seen_cursors:
            raise ValueError("Confluence enumeration repeated a cursor")
          seen_cursors.add(next_cursor)
          cursor = next_cursor
        except (aiohttp.ClientError, ValueError, TypeError) as exc:
          self.logger.error("Space enumeration failed for %s: %s", space_key, exc)
          failed_pages.append((space_key, str(exc)))
          break

    # Apply title filtering
    if pages and (self.allowed_title_patterns or self.denied_title_patterns):
      pre_filter_count = len(pages)
      pages = [p for p in pages if not self.should_skip_page(p.get("title", ""))]
      filtered_count = pre_filter_count - len(pages)
      if filtered_count:
        self.logger.info(f"Title filter: kept {len(pages)}/{pre_filter_count} pages ({filtered_count} filtered out)")

    self.logger.info(f"Fetched {len(pages)} pages from space {space_key}, {len(failed_pages)} failures")
    return pages, failed_pages

  async def ingest_pages(self, pages: List[Dict[str, Any]], job_id: str):
    """Ingest pages by extracting content, chunking, and sending to RAG.

    Args:
        pages: List of page metadata dicts (must include 'id' field)
        job_id: Job ID for tracking progress
    """
    # Calculate fresh_until based on datasource reload_interval
    fresh_until = get_fresh_until(self.datasource_info.reload_interval)

    all_documents = []

    for page in pages:
      page_id = page.get("id")
      try:
        if not page_id:
          raise ValueError("Page response is missing its content ID")
        html_content = page.get("body", {}).get("storage", {}).get("value")
        if not isinstance(html_content, str):
          raise ValueError("Page response is missing the expanded storage body")

        # Extract text
        text = self.extract_text_from_html(html_content)

        if not text.strip():
          self.logger.warning(f"Page {page_id} has no content, skipping")
          await self.job_manager.increment_progress(job_id)
          continue

        # Split into chunks
        chunks = self.text_splitter.split_text(text)

        # Extract base metadata from v1 API response
        page_title = page.get("title", "")
        space_key = page.get("space", {}).get("key", "")
        space_name = page.get("space", {}).get("name", "")
        webui = page.get("_links", {}).get("webui", "")
        site_root = self.confluence_url.rstrip("/").removesuffix("/wiki")
        page_url = urljoin(site_root + "/", webui) if webui.startswith("/wiki/") else urljoin(site_root + "/wiki/", webui.lstrip("/"))
        created_date = page.get("history", {}).get("createdDate", "")
        last_modified = page.get("history", {}).get("lastUpdated", {}).get("when") or page.get("version", {}).get("when", "")
        version = page.get("version", {}).get("number", 1)
        author = page.get("history", {}).get("createdBy", {}).get("displayName", "")

        # Create Document objects for each chunk
        for i, chunk in enumerate(chunks):
          # Generate unique document ID for this chunk
          doc_id_base = f"{self.datasource_info.datasource_id}_{page_id}_chunk_{i}"
          doc_id = hashlib.sha256(doc_id_base.encode()).hexdigest()

          # Build additional metadata
          additional_metadata = {
            "page_id": page_id,
            "space_key": space_key,
            "space_name": space_name,
            "url": page_url,
            "created_date": created_date,
            "last_modified": last_modified,
            "version": version,
            "author": author,
            "chunk_index": i,
            "total_chunks": len(chunks),
            "source": "confluence",
            "source_body_sha256": hashlib.sha256(html_content.encode()).hexdigest(),
            "source_fetch_complete": True,
            "source_fetched_at": page.get("_source_fetched_at", int(time.time())),
          }

          # Create DocumentMetadata with all required fields
          doc_metadata = DocumentMetadata(
            document_id=doc_id,
            datasource_id=self.datasource_info.datasource_id,
            ingestor_id=self.rag_client.ingestor_id,
            title=page_title,
            description=f"Chunk {i + 1}/{len(chunks)} from {page_title}",
            document_type="confluence_page",
            document_ingested_at=int(time.time()),
            fresh_until=fresh_until,
            is_structured_entity=False,
            metadata=additional_metadata,
          )

          doc = Document(
            id=doc_id,
            page_content=chunk,
            metadata=doc_metadata.model_dump(),
          )
          all_documents.append(doc)

          # Batch ingestion
          if len(all_documents) >= CONFLUENCE_BATCH_SIZE:
            await self._ingest_batch(all_documents, job_id, fresh_until)
            all_documents = []

        # Update progress (document_count is auto-incremented by Client.ingest_documents)
        await self.job_manager.increment_progress(job_id)
        await self.job_manager.upsert_job(job_id, message=f"Processed page: {page.get('title', page_id)}")

      except Exception as e:
        error_msg = f"Page {page_id}: {str(e)}"
        self.logger.error(f"Error processing page {page_id}: {e}")
        await self.job_manager.add_error_msg(job_id, error_msg)
        await self.job_manager.increment_failure(job_id=job_id, message=error_msg)
        await self.job_manager.increment_progress(job_id)

    # Ingest remaining documents
    if all_documents:
      await self._ingest_batch(all_documents, job_id, fresh_until)

    # Set final job status with message
    job = await self.job_manager.get_job(job_id)
    if job.status == JobStatus.TERMINATED:
      await self.job_manager.upsert_job(
        job_id=job_id,
        status=JobStatus.TERMINATED,
        message="Job was terminated during page processing.",
      )
    elif job.failed_counter and job.failed_counter == job.total:
      await self.job_manager.upsert_job(
        job_id=job_id,
        status=JobStatus.FAILED,
        message=f"All {job.total} pages failed to process",
      )
    elif job.failed_counter and job.failed_counter > 0:
      await self.job_manager.upsert_job(
        job_id=job_id,
        status=JobStatus.COMPLETED_WITH_ERRORS,
        message=f"Processed {job.progress_counter} pages with {job.failed_counter} failures",
      )
    else:
      await self.job_manager.upsert_job(
        job_id=job_id,
        status=JobStatus.COMPLETED,
        message=f"Processed: {job.total} pages",
      )

  async def _ingest_batch(self, documents: List[Document], job_id: str, fresh_until: int):
    """Send batch of documents to RAG server.

    Args:
        documents: List of Document objects to ingest
        job_id: Job ID for tracking
        fresh_until: Timestamp until which data is considered fresh (epoch seconds)
    """
    try:
      await self.rag_client.ingest_documents(
        job_id=job_id,
        datasource_id=self.datasource_info.datasource_id,
        documents=documents,
        fresh_until=fresh_until,
      )
      self.logger.debug(f"Ingested batch of {len(documents)} documents")
    except Exception as e:
      self.logger.error(f"Error ingesting batch: {e}")
      raise
