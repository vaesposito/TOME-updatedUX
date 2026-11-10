import { AuthGuard } from "@/components/auth-guard";
import { FunctionCategoryView } from "@/components/projects/FunctionCategoryView";

/**
 * One function's category, addressed as `<function id>--<category id>`.
 *
 * A page rather than a panel inside the hub, so a category can be linked to
 * and come back on a refresh. The names it is addressed by come from the
 * browser and from the subjects themselves, so resolving the slug is the
 * view's job, on the client.
 */
export default async function FunctionCategoryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <AuthGuard>
      <FunctionCategoryView slug={slug} />
    </AuthGuard>
  );
}
