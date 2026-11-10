import { join } from "node:path";

import type { NextConfig } from "next";

/**
 * The prototype build: the same components, exported as files.
 *
 * `export` because this is published to GitHub Pages, which serves files and
 * runs nothing. Every screen here is a client component reading from the
 * mocked API in `mock/`, so there is no server work left to do at request
 * time — which is exactly what makes exporting them possible.
 *
 * `basePath` because Pages serves a project site from a subdirectory. It is
 * read from the environment so the same build can be served from the root
 * when someone runs it locally.
 */
const basePath = process.env.PROTOTYPE_BASE_PATH ?? "";

// Name the application for the render as well as for the browser.
//
// The shell names it in `window.__APP_CONFIG__`, which does not exist while
// the pages are being rendered to files, so without this the files carry the
// stock name, the browser shows this one, and the brand changes under the
// visitor a moment after the first paint.
//
// Set as an environment variable rather than through `env` below, because
// the application looks it up under a computed key, which a build-time
// substitution cannot see. Only the name: the TOME flag cannot be given the
// same treatment, because with it on, rendering a space to a file asks for
// the space, and there is no server here to answer.
process.env.APP_NAME ??= "TOME";

const nextConfig: NextConfig = {
  output: "export",
  // The app lives here but its components live in `../src`, so the root has
  // to cover both; without it the build picks a root from whichever lockfile
  // it finds first and traces the whole checkout.
  turbopack: { root: join(__dirname, "..") },
  basePath,
  assetPrefix: basePath || undefined,
  // Pages has no image optimiser behind it.
  images: { unoptimized: true },
  // Served as directories, so a deep link lands on its own index.html rather
  // than on a 404 from a host that knows nothing about the router.
  trailingSlash: true,
  env: {
    NEXT_PUBLIC_PROTOTYPE_BASE_PATH: basePath,
    // Same reasoning for the mark, plus one of its own: it is drawn with a
    // plain <img>, so nothing prefixes the path for it, and a site published
    // under a prefix would send the browser looking a directory too high.
    NEXT_PUBLIC_LOGO_URL: `${basePath}/logo.svg`,
    // The function axis is named by whoever runs TOME, so the prototype
    // configures an organisation the same way a deployment would — here,
    // rather than in the fixtures, because this is the file a deployment
    // would edit. The fixtures read it back from the environment, so the
    // exported category addresses and the names the browser shows come from
    // this one string.
    NEXT_PUBLIC_TOME_FUNCTION_CATEGORIES:
      "Engineering: Reliability, Security, Developer tooling"
      + " | Product Design: Research, Design system"
      + " | Marketing: Launches",
  },
};

export default nextConfig;
