/**
 * Walk the exported prototype in a browser and report what it shows.
 *
 * The build only proves the files exist; the screens themselves run in the
 * browser, against the mocked API. This opens the main ones, waits for them
 * to settle, writes a screenshot and collects anything the console
 * complained about — the only way to see whether a screen arrived empty.
 *
 * Run from `ui/`: `node prototype/check.mjs`
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const OUT = new URL("./out/", import.meta.url).pathname;
const SHOTS = new URL("./shots/", import.meta.url).pathname;
const PORT = 4321;

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
  ".png": "image/png",
};

async function fileFor(pathname) {
  const candidates = [
    join(OUT, pathname),
    join(OUT, pathname, "index.html"),
    join(OUT, `${pathname.replace(/\/$/, "")}.html`),
  ];
  for (const candidate of candidates) {
    try {
      const found = await stat(candidate);
      if (found.isFile()) return candidate;
    } catch {
      // next candidate
    }
  }
  return null;
}

const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = await fileFor(pathname);
  if (!file) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(await readFile(file));
});

const SCREENS = [
  ["home", "/"],
  ["catalogue", "/projects/"],
  ["by-function", "/projects/?tab=functions"],
  ["overview", "/projects/?tab=overview"],
  ["digest", "/projects/?tab=digest"],
  ["space-home", "/projects/build-pipeline/tome/"],
  ["wiki", "/projects/build-pipeline/tome/wiki/"],
  ["page", "/projects/build-pipeline/tome/wiki/overview.md/"],
  ["nested-page", "/projects/build-pipeline/tome/wiki/decisions/cache-key.md/"],
  ["related", "/projects/build-pipeline/tome/related/"],
  ["sources", "/projects/build-pipeline/tome/sources/"],
  ["glossary", "/projects/build-pipeline/tome/glossary/"],
  ["meetings", "/projects/build-pipeline/tome/meetings/"],
  ["gists", "/projects/build-pipeline/tome/gists/"],
  ["issues", "/projects/build-pipeline/tome/issues/"],
  ["ingest", "/projects/build-pipeline/tome/ingest/"],
  ["settings", "/projects/build-pipeline/tome/settings/"],
  ["notifications", "/notifications/"],
  ["category", "/projects/functions/engineering--engineering-reliability/"],
];

// Point at a running dev server instead to get unminified errors:
// `node prototype/check.mjs http://localhost:3000`
const origin = process.argv[2] ?? `http://localhost:${PORT}`;
const only = process.argv[3];

await mkdir(SHOTS, { recursive: true });
if (!process.argv[2]) await new Promise((resolve) => server.listen(PORT, resolve));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const problems = [];
page.on("console", (message) => {
  if (message.type() === "error") problems.push(message.text());
});
page.on("pageerror", (error) => problems.push(`uncaught: ${error.message}`));
page.on("response", (response) => {
  if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`);
});

for (const [name, path] of SCREENS) {
  if (only && name !== only) continue;
  problems.length = 0;
  await page.goto(`${origin}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  // The first-run welcome covers whatever is behind it, and it is the one
  // thing on these screens that is already known to work.
  const close = page.getByRole("button", { name: /close|skip/i }).first();
  if (await close.isVisible().catch(() => false)) {
    await close.click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  console.log(`\n=== ${name} (${path})`);
  console.log(`   ${text.slice(0, 320)}`);
  if (problems.length) {
    console.log(`   ! ${[...new Set(problems)].slice(0, 4).join("\n   ! ")}`);
  }
}

await browser.close();
server.close();
