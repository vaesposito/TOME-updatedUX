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
// Served under the same prefix it was built for, so the walk below asks for
// the paths the published site really serves. A build without one is served
// at the root, as before.
const BASE = (process.env.PROTOTYPE_BASE_PATH ?? "").replace(/\/$/, "");

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
  const asked = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  // Anything outside the prefix is a mark the export left pointing at the
  // domain root, and has to 404 here exactly as it would in production.
  const pathname = BASE && asked.startsWith(BASE) ? asked.slice(BASE.length) : asked;
  const file = BASE && !asked.startsWith(BASE) ? null : await fileFor(pathname);
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
  ["appearance", "/settings/appearance/"],
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
  await page.goto(`${origin}${BASE}${path}`, { waitUntil: "networkidle" });
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

/**
 * The theme, checked the way a visitor meets it.
 *
 * What matters is the first paint, so the theme is recorded at the moment
 * the document finishes parsing rather than asked for afterwards: a theme
 * set a frame late looks identical once things settle, and a frame late is
 * the flash this is here to catch.
 *
 * In a context of its own, so the pages walked above cannot have left a
 * stored preference behind: the point is what a first-time visitor sees.
 */
async function themeOf(page) {
  return page.evaluate(() => ({
    theme: document.documentElement.getAttribute("data-theme"),
    preference: document.documentElement.getAttribute("data-theme-preference"),
    paper: getComputedStyle(document.body).backgroundColor,
    stored: localStorage.getItem("theme"),
    // Recorded by the watcher below, not read now: asking after the fact
    // cannot tell a theme set during parsing from one set a frame later,
    // and a frame later is exactly the flash being guarded against.
    atParse: window.__themeAtParse,
  }));
}

/**
 * Watch the html element from before any of the page's own code runs, and
 * remember what the theme was when the document finished parsing.
 *
 * `document.documentElement` does not exist this early, hence the wait.
 */
async function watchFirstPaint(page) {
  await page.addInitScript(() => {
    const attach = () => {
      if (!document.documentElement) return void setTimeout(attach, 0);
      document.addEventListener("DOMContentLoaded", () => {
        window.__themeAtParse =
          document.documentElement.getAttribute("data-theme") ?? "none";
      });
    };
    attach();
  });
}

if (!only) {
  const fresh = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const first = await fresh.newPage();
  await watchFirstPaint(first);

  for (const [name, path] of [
    ["dark-catalogue", "/projects/"],
    ["dark-page", "/projects/build-pipeline/tome/wiki/overview.md/"],
  ]) {
    await first.goto(`${origin}${BASE}${path}`, { waitUntil: "networkidle" });
    await first.waitForTimeout(700);
    const settled = await themeOf(first);
    await first.screenshot({ path: join(SHOTS, `${name}.png`) });
    console.log(
      `\n=== ${name} (${path})\n` +
        `   when the document finished parsing: ${settled.atParse}\n` +
        `   once settled: ${settled.theme} (preference ${settled.preference}),` +
        ` body ${settled.paper}`,
    );
  }

  // A browser that was here before dark was the default.
  //
  // The application stores a theme on sight rather than only when someone
  // switches, so everyone who opened the prototype while it still started in
  // light is carrying "light" or "system" and a stored choice wins. Changing
  // the default has to reach them once — and must not reach someone who
  // picked light after being shown dark, whose choice is their own.
  for (const [label, stored, mark, expected] of [
    ["was here before dark, stored light", "light", null, "dark"],
    ["was here before dark, stored system", "system", null, "dark"],
    ["chose light after being shown dark", "light", "dark", "light"],
  ]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(
      ([theme, defaultMark]) => {
        try {
          localStorage.setItem("theme", theme);
          if (defaultMark) {
            localStorage.setItem("tome.prototype.theme-default", defaultMark);
          }
        } catch {
          // a browser refusing storage has nothing stored to carry over
        }
      },
      [stored, mark],
    );
    const visitor = await context.newPage();
    await watchFirstPaint(visitor);
    await visitor.goto(`${origin}${BASE}/projects/`, { waitUntil: "networkidle" });
    await visitor.waitForTimeout(700);
    const seen = await themeOf(visitor);
    console.log(
      `\n=== ${label}\n` +
        `   when the document finished parsing: ${seen.atParse}\n` +
        `   once settled: ${seen.theme}, now storing ${seen.stored}` +
        `${seen.theme === expected ? "" : `   ! expected ${expected}`}`,
    );
    await context.close();
  }

  // Dark is a starting point, not a lock: switching has to work, and has to
  // hold on the next page the visitor opens.
  await first.goto(`${origin}${BASE}/settings/appearance/`, { waitUntil: "networkidle" });
  await first.waitForTimeout(700);
  // Named by its label and its one-line description together, and anchored
  // so "Legacy Light" is not what gets clicked.
  const light = first.getByRole("button", { name: /^Light\b/ }).first();
  if (await light.isVisible().catch(() => false)) {
    await light.click();
    await first.waitForTimeout(500);
    await first.screenshot({ path: join(SHOTS, "light-appearance.png") });
    const after = await themeOf(first);
    await first.goto(`${origin}${BASE}/projects/`, { waitUntil: "networkidle" });
    await first.waitForTimeout(700);
    const kept = await themeOf(first);
    await first.screenshot({ path: join(SHOTS, "light-catalogue.png") });
    console.log(
      `\n=== switching to light\n` +
        `   after the click: ${after.theme} (stored ${after.stored})\n` +
        `   next page, when it finished parsing: ${kept.atParse}\n` +
        `   next page, once settled: ${kept.theme}, body ${kept.paper}`,
    );
  } else {
    console.log("\n=== switching to light\n   ! no Light control found");
  }

  await fresh.close();
}

await browser.close();
server.close();
