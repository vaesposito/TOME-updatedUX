"use client";

import { Suspense } from "react";

import { ProjectsHub } from "@/components/projects/ProjectsHub";

export default function ProjectsPage() {
  return (
    <Suspense>
      <ProjectsHub />
    </Suspense>
  );
}
