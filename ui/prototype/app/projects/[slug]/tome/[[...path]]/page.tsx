import { TomeWiki } from "@/components/tome/TomeWiki";

import { tomeParams } from "~/mock/routes";

/**
 * A space and all its views, exported one file per address.
 *
 * The application resolves the trailing segments on the client, so this page
 * only has to exist at each of them; `TomeWiki` reads the URL itself.
 */
export function generateStaticParams() {
  return tomeParams();
}

export default async function ProjectTomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <TomeWiki slug={slug} />;
}
