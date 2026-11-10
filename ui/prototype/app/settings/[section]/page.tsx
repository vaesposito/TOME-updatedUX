import { WorkspacePageHeader } from "@/components/layout/WorkspacePageHeader";
import {
  findSettingsRouteBySegment,
  PERSONAL_SETTINGS_ROUTES,
} from "@/components/settings/settings-routes";
import { SettingsWorkspace } from "@/components/settings/SettingsWorkspace";

/**
 * Personal settings, Appearance among them.
 *
 * Exported because the prototype opens in dark and a visitor has to be able
 * to leave it: this is where the application keeps its theme control, and
 * the navigation already links here. Settings are held in the browser, so
 * the section works as it does in the application with nothing behind it.
 */
export function generateStaticParams() {
  return PERSONAL_SETTINGS_ROUTES.map((route) => ({ section: route.segment }));
}

export default async function SettingsSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const route = findSettingsRouteBySegment(section);
  if (!route) return null;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto min-h-full w-full max-w-[108rem] space-y-6 px-4 pb-6 pt-3 sm:px-6 lg:pb-8">
        <WorkspacePageHeader
          breadcrumbs={[
            { label: "Home", href: "/" },
            { label: "Settings", href: PERSONAL_SETTINGS_ROUTES[0].href },
            { label: route.label, href: route.href },
          ]}
          description={route.description}
          title={route.label}
        />
        <SettingsWorkspace activeRouteId={route.id} />
      </div>
    </main>
  );
}
