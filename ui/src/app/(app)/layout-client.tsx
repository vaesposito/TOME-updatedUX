"use client";

import { AppHeader } from "@/components/layout/AppHeader";
import {
  ApplicationNavigationDrawer,
  ApplicationNavigationRail,
} from "@/components/layout/ApplicationNavigation";
import { ApplicationNavigationProvider } from "@/components/layout/ApplicationNavigationContext";
import { HeaderBreadcrumbSlotProvider } from "@/components/layout/HeaderBreadcrumbSlot";
import { LiveStreamBanner } from "@/components/layout/LiveStreamBanner";
import { FeatureTour } from "@/components/tour/FeatureTour";
import { NotificationTour } from "@/components/tour/NotificationTour";
import { useUserInit } from "@/hooks/use-user-init";
import { finishNavigationProgress } from "@/lib/navigation-progress";
import { usePathname } from "next/navigation";
import React from "react";

export function AppLayoutClient({
  children,
  initialNavigationCollapsed,
}: {
  children: React.ReactNode;
  initialNavigationCollapsed: boolean;
}): React.ReactElement {
  const pathname = usePathname();

  // Initialize user in MongoDB on first login
  useUserInit();

  React.useEffect(() => {
    finishNavigationProgress();
  }, [pathname]);

  return (
    <ApplicationNavigationProvider
      initialCollapsed={initialNavigationCollapsed}
    >
      <HeaderBreadcrumbSlotProvider>
        <div className="app-shell-canvas flex h-dvh overflow-hidden bg-background noise-overlay">
          <ApplicationNavigationRail />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <AppHeader />
            <LiveStreamBanner />
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              {children}
            </div>
          </div>
          <ApplicationNavigationDrawer />
          {/* App-wide because a walkthrough crosses routes: its steps run
              from the catalogue or the header's bell into a project's own
              pages, and only something mounted above the router survives the
              journey. Both are mounted; each waits for its own start event,
              and only one can be running, since starting either stores a
              place the other never reads. */}
          <NotificationTour />
          <FeatureTour />
        </div>
      </HeaderBreadcrumbSlotProvider>
    </ApplicationNavigationProvider>
  );
}
