"""Exercise the locked SDK's real JSON reader without a model or provider call."""

import json
from collections.abc import AsyncIterator
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest
from claude_agent_sdk import ClaudeAgentOptions, CLIJSONDecodeError
from claude_agent_sdk._internal.transport.subprocess_cli import SubprocessCLITransport

from tome_agent.agent.document_worker import MAX_PDF_BATCH_BYTES
from tome_agent.agent.loop import build_agent_options
from tome_agent.agent.sharepoint_documents import (
    SharePointPreparationError,
    SharePointPreparer,
    document_sdk_max_buffer_size,
)
from tome_agent.orchestrator.contract import ProjectSnapshot


def document_options(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, **overrides: Any
) -> ClaudeAgentOptions:
    monkeypatch.setenv("TTT_PROJECT_ROOT", str(tmp_path))
    return build_agent_options(
        snapshot=ProjectSnapshot(project_id="project-1", name="Example"),
        system_prompt="test",
        model="claude-test",
        max_turns=1,
        persist_author="tester",
        restrict_untrusted_evidence=True,
        **overrides,
    )


async def sdk_messages(options: ClaudeAgentOptions, payload: str) -> list[dict[str, Any]]:
    # Chunk the stdout message just as the SDK's TextReceiveStream does.
    async def stdout() -> AsyncIterator[str]:
        for start in range(0, len(payload), 524_288):
            yield payload[start : start + 524_288]

    transport = SubprocessCLITransport(prompt="test", options=options)
    transport._process = SimpleNamespace(wait=AsyncMock(return_value=0))
    transport._stdout_stream = stdout()
    return [message async for message in transport.read_messages()]


def visual_message(batch_count: int) -> str:
    encoded_size = ((MAX_PDF_BATCH_BYTES + 2) // 3) * 4
    return json.dumps(
        {
            "type": "user",
            "message": {
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": f"read-{index}",
                        "content": [{"type": "document", "data": "A" * encoded_size}],
                    }
                    for index in range(batch_count)
                ]
            },
        },
        separators=(",", ":"),
    )


def test_document_buffer_default_is_bounded_and_other_passes_unchanged(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("TOME_DOCUMENT_SDK_MAX_BUFFER_MIB", raising=False)
    assert document_sdk_max_buffer_size() == 64 * 1_048_576
    assert document_options(monkeypatch, tmp_path).max_buffer_size is None
    options = document_options(
        monkeypatch, tmp_path, max_buffer_size=document_sdk_max_buffer_size()
    )
    assert options.max_buffer_size == 64 * 1_048_576
    assert options.strict_mcp_config is True
    assert options.mcp_servers == {}
    assert "Bash" not in options.tools


@pytest.mark.parametrize("size", ["32", "48", "64"])
def test_document_buffer_can_be_configured_within_the_cap(
    monkeypatch: pytest.MonkeyPatch, size: str
) -> None:
    monkeypatch.setenv("TOME_DOCUMENT_SDK_MAX_BUFFER_MIB", size)
    assert document_sdk_max_buffer_size() == int(size) * 1_048_576


@pytest.mark.parametrize("size", ["", "invalid", "32.5", "0", "-1", "31", "65", "999999"])
def test_invalid_buffer_config_fails_before_preparation(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, size: str
) -> None:
    monkeypatch.setenv("TOME_DOCUMENT_SDK_MAX_BUFFER_MIB", size)
    with pytest.raises(SharePointPreparationError, match="between 32 and 64"):
        SharePointPreparer.from_env(tmp_path)


@pytest.mark.asyncio
async def test_real_sdk_reproduces_default_overflow_then_accepts_document_results(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("TOME_DOCUMENT_SDK_MAX_BUFFER_MIB", raising=False)
    default_options = document_options(monkeypatch, tmp_path)
    payload = visual_message(2)
    assert 32 * 1_048_576 < len(payload) < document_sdk_max_buffer_size()
    with pytest.raises(CLIJSONDecodeError, match="1048576 bytes"):
        await sdk_messages(default_options, payload)

    options = document_options(
        monkeypatch, tmp_path, max_buffer_size=document_sdk_max_buffer_size()
    )
    messages = await sdk_messages(options, payload)
    assert len(messages) == 1
    assert len(messages[0]["message"]["content"]) == 2
    assert messages[0]["message"]["content"][1]["tool_use_id"] == "read-1"


@pytest.mark.asyncio
async def test_real_sdk_still_rejects_a_message_above_the_document_cap(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("TOME_DOCUMENT_SDK_MAX_BUFFER_MIB", raising=False)
    options = document_options(
        monkeypatch, tmp_path, max_buffer_size=document_sdk_max_buffer_size()
    )
    payload = visual_message(3)
    with pytest.raises(CLIJSONDecodeError, match="67108864 bytes"):
        await sdk_messages(options, payload)
