import { FunctionCategoryView } from "@/components/projects/FunctionCategoryView";

import { categoryParams } from "~/mock/routes";

/** One function's category, addressed as `<function>--<category>`. */
export function generateStaticParams() {
  return categoryParams();
}

export default async function FunctionCategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <FunctionCategoryView slug={slug} />;
}
