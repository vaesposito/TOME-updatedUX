/**
 * Walk a whole tour in the exported prototype, the way a reader would.
 *
 * Serves `prototype/out` under the prefix it was built for, because a host
 * that serves pages as directories is where the tour's own routing has to
 * hold up: a step is written without a trailing slash and arrives with one.
 *
 * Run from `ui/`: `node prototype/tours.mjs "Writing a page"`
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const OUT = new URL("./out/", import.meta.url).pathname;
const BASE = "/TOME-updatedUX";
const PORT = 4324;
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
  for (const candidate of [
    join(OUT, pathname),
    join(OUT, pathname, "index.html"),
    join(OUT, `${pathname.replace(/\/$/, "")}.html`),
  ]) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // next candidate
    }
  }
  return null;
}

const server = createServer(async (req, res) => {
  const asked = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (!asked.startsWith(BASE)) {
    res.writeHead(404).end("not found");
    return;
  }
  const path = asked.slice(BASE.length);
  // As the published host does: a directory asked for without its slash is
  // redirected, which is a fresh page load and the thing that broke tours.
  if (!path.endsWith("/") && (await fileFor(`${path}/`))) {
    res.writeHead(301, { location: `${asked}/` }).end();
    return;
  }
  const file = await fileFor(path);
  if (!file) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
  });
  res.end(await readFile(file));
});

await new Promise((resolve) => server.listen(PORT, resolve));
const origin = `http://localhost:${PORT}${BASE}`;
const which = process.argv[2] ?? "Writing";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`uncaught: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") problems.push(m.text());
});
// What the tour asks for while it works out which space to borrow.
page.on("response", async (r) => {
  if (!/\/pages|following/.test(r.url())) return;
  let shape = "";
  try {
    const body = await r.json();
    const pages = body?.data?.pages;
    shape = pages ? `pages: ${Object.keys(pages).slice(0, 3).join(", ")}` : "no pages key";
  } catch {
    shape = "not json";
  }
  console.log(`  asked ${new URL(r.url()).pathname} -> ${r.status()} ${shape}`);
});

const card = page.locator("[data-tour-card]");

await page.goto(`${origin}/projects/`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
await page.getByRole("button", { name: /take a tour/i }).first().click();
await page.waitForTimeout(600);
// Scoped to the chooser the button opened: the rail and the page carry some
// of the same words, and clicking one of those navigates instead of starting
// anything.
const chooser = page.locator("[data-popover-content]");
await chooser.first().waitFor({ state: "visible", timeout: 10000 });
await chooser
  .getByRole("button", { name: new RegExp(which, "i") })
  .first()
  .click();
await card.waitFor({ state: "visible", timeout: 20000 });

for (let step = 1; step <= 12; step += 1) {
  await page.waitForTimeout(1100);
  const said = (await card.innerText()).replace(/\s+/g, " ");
  const spotlit = await page.evaluate(() => {
    const ring = document.querySelector('[data-testid="tour-spotlight"]');
    if (!ring) return "none";
    const box = ring.getBoundingClientRect();
    const under = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    return under?.closest("[data-tour]")?.getAttribute("data-tour") ?? "something else";
  });
  console.log(
    `\nstep ${step} | ${new URL(page.url()).pathname.replace(BASE, "")}` +
      `\n  ${said.slice(0, 150)}\n  pointing at: ${spotlit}`,
  );
  const next = card.getByRole("button", { name: /^(Next|Done)$/ }).first();
  if (!(await next.isVisible().catch(() => false))) {
    console.log("  (nothing to press)");
    break;
  }
  const label = (await next.innerText()).trim();
  await next.click();
  await page.waitForTimeout(400);
  console.log(
    `  pressed ${label}; saved place now ${await page.evaluate(() => sessionStorage.getItem("grid.tour"))}`,
  );
  if (label === "Done") {
    console.log("  (that was the last)");
    break;
  }
}

await page.waitForTimeout(900);
console.log(
  "\nwhen it ends:",
  await page.evaluate(() => ({
    card: document.querySelector("[data-tour-card]") ? "still up" : "gone",
    drafts: Object.keys(localStorage).filter((k) => /draft/i.test(k)),
    claimsUnsaved: document.body.innerText.includes("Unsaved"),
    canvasScrollTop: document.querySelector(".app-shell-canvas")?.scrollTop ?? "none",
  })),
);
if (problems.length) {
  console.log(`\nproblems:\n  ${[...new Set(problems)].slice(0, 5).join("\n  ")}`);
}
await browser.close();
server.close();
