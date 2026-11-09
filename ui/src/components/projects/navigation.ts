import type { WorkspaceNavigationGroup } from "@/components/layout/WorkspaceNavigation";
import { FolderKanban, LayoutGrid, Newspaper, Settings, Users } from "lucide-react";

/**
 * TOME's own destinations, shown under it in the application navigation.
 *
 * The first two are the catalogue read two ways, then the two summary views
 * the hub already offered through its tab bar, then settings. They are listed
 * here rather than reached only through that tab bar so a reader can see what
 * TOME holds without first arriving in it.
 */
export const TOME_GROUPS: WorkspaceNavigationGroup[] = [{
  id: "tome-sections",
  items: [
    {
      id: "projects",
      label: "By project",
      href: "/projects",
      icon: FolderKanban,
      description: "Every space, grouped by initiative",
    },
    {
      id: "functions",
      label: "By function",
      href: "/projects?tab=functions",
      icon: Users,
      description: "Every space, grouped by the function that owns it",
    },
    {
      id: "overview",
      label: "Overview",
      href: "/projects?tab=overview",
      icon: LayoutGrid,
      description: "What changed across everything you can see",
    },
    {
      id: "digest",
      label: "Digest",
      href: "/projects?tab=digest",
      icon: Newspaper,
      description: "The written week",
    },
    {
      id: "settings",
      label: "Settings",
      href: "/projects/admin",
      icon: Settings,
      description: "TOME settings",
    },
  ],
}];

/**
 * Which of the above a location counts as.
 *
 * The first four are one route told apart by its query, so the path alone
 * cannot say where a reader is.
 */
export function activeTomeNavigationId(
  pathname: string | null | undefined,
  params: { tab?: string | null; groupBy?: string | null },
): string {
  if (!pathname?.startsWith("/projects")) return "";
  if (pathname.startsWith("/projects/admin")) return "settings";
  // A space of its own is somewhere below the catalogue, and the catalogue is
  // how a reader got there.
  if (pathname !== "/projects") return "projects";
  if (params.tab === "overview") return "overview";
  if (params.tab === "digest") return "digest";
  // groupBy predates the tab, and a link written against it still has to
  // mark the row the reader ends up looking at.
  if (params.tab === "functions" || params.groupBy === "function") {
    return "functions";
  }
  return "projects";
}
