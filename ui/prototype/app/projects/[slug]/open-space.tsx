"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { LoadingScreen } from "@/components/loading-screen";

export function OpenSpace({ slug }: { slug: string }) {
  const router = useRouter();

  React.useEffect(() => {
    router.replace(`/projects/${slug}/tome`);
  }, [router, slug]);

  return <LoadingScreen message="Opening…" />;
}
