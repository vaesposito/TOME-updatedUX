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
