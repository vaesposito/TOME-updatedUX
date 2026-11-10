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

// Describe the deployment to the render as well as to the browser.
//
// The shell describes it in `window.__APP_CONFIG__`, which does not exist
// while the pages are being rendered to files. Anything the rendered HTML
// shows has to be settled here too, or the files carry the stock answer, the
// browser shows this one, and React throws the first paint away as a
// hydration failure: the name appears in the brand, and the TOME flag
// decides which entries the navigation rail has at all.
//
// Set as environment variables rather than through `env` below, because the
// application looks these up under a computed key, which a build-time
// substitution cannot see.
process.env.APP_NAME ??= "TOME";
process.env.TOME_ENABLED ??= "true";

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
