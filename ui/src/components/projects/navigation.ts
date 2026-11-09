import type { WorkspaceNavigationGroup } from "@/components/layout/WorkspaceNavigation";
import { FolderKanban, LayoutGrid, Newspaper, Settings, Users } from "lucide-react";

/**
 * The organisation's functions, as a space may be grouped by.
 *
 * Fixed rather than derived from whatever projects happen to be tagged: the
 * point of the view is to show the whole organisation, including the parts
 * that have nothing in TOME yet, since an absent function and an empty one
 * read identically once the list is only what was found.
 */
export const ORG_FUNCTIONS = [
  "SLT",
  "Engineering",
  "Marketing",
  "Product Design",
  "Business Development",
] as const;

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
      href: "/projects?groupBy=function",
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
  return params.groupBy === "function" ? "functions" : "projects";
}
