import { spaceParams } from "~/mock/routes";

import { OpenSpace } from "./open-space";

/**
 * Opening a space goes straight to its wiki, as it does in the application.
 *
 * The application redirects on the server; an exported page has no server, so
 * the hop happens on the client the moment the file is served.
 */
export function generateStaticParams() {
  return spaceParams();
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <OpenSpace slug={slug} />;
}
