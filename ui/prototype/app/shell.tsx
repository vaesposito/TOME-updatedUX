"use client";

/**
 * The application shell, with a function where the server used to be.
 *
 * Everything below this point is the real thing: the same navigation rail,
 * header, tours and screens the application renders. What differs is that
 * the API is answered from fixtures, the session is invented, and the
 * configuration a server would have injected is set here.
 */

import { SessionProvider } from "next-auth/react";
import * as React from "react";

import { ThemeProvider } from "@/components/theme-provider";
import { ToastProvider } from "@/components/ui/toast";
import { ApplicationNavigationProvider } from "@/components/layout/ApplicationNavigationContext";
import { HeaderBreadcrumbSlotProvider } from "@/components/layout/HeaderBreadcrumbSlot";
import { AppHeader } from "@/components/layout/AppHeader";
import {
  ApplicationNavigationDrawer,
  ApplicationNavigationRail,
} from "@/components/layout/ApplicationNavigation";
import { TourRunner } from "@/components/tour/TourRunner";

import { installMockApi } from "~/mock/api";
import { USER } from "~/mock/data";
import {
  repointRootAbsoluteAssets,
  seedBrowserState,
} from "~/mock/browser-state";
import { PROTOTYPE_THEME } from "~/mock/theme";

// Before the first render rather than in an effect: the screens fetch on
// mount, and a request that left during the first paint would have gone to a
// server that is not there.
if (typeof window !== "undefined") {
  installMockApi();
  seedBrowserState();
  repointRootAbsoluteAssets();
  const w = window as unknown as { __APP_CONFIG__?: Record<string, unknown> };
  w.__APP_CONFIG__ = {
    ...(w.__APP_CONFIG__ ?? {}),
    appName: "TOME",
    tagline: "The organisation, written down",
    description: "A prototype of the TOME interface",
    ssoEnabled: false,
    storageMode: "memory",
    tomeEnabled: true,
    workflowsEnabled: false,
    // The application reads this object instead of its own defaults rather
    // than on top of them, so anything left out here comes back undefined.
    // The appearance keys have to be named: the header's appearance hydrator
    // runs on every page and falls back to the system preference when it
    // cannot find a configured theme, which would undo the head script a
    // moment after the first paint.
    defaultTheme: PROTOTYPE_THEME,
    defaultFontFamily: "inter",
    defaultFontSize: "medium",
    defaultGradientTheme: "default",
    // Named from the same place the export's own rendering reads it, so the
    // two agree: the browser takes this object as it stands, and a mark that
    // differed from the one already written into the file would be a
    // mismatch.
    logoUrl: process.env.NEXT_PUBLIC_LOGO_URL ?? "/logo.svg",
    logoStyle: "default",
  };
}

const SESSION = {
  user: { name: USER.name, email: USER.email, image: null },
  expires: "2099-01-01T00:00:00.000Z",
};

export function PrototypeShell({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider session={SESSION as never} refetchInterval={0}>
      {/* The head script has normally settled the theme before this mounts,
          and the provider stands down when it finds it has. Naming the
          default here too is for the case where the script did not run: the
          page would otherwise fall back to the system preference of whatever
          machine it was opened on. */}
      <ThemeProvider defaultTheme={PROTOTYPE_THEME}>
        <ToastProvider>
          <ApplicationNavigationProvider initialCollapsed={false}>
            <HeaderBreadcrumbSlotProvider>
              {/* The whole shell waits for the browser, not just the screen
                  inside it.

                  Screens, the navigation rail, the header and the
                  walkthrough all read the query to know what they are
                  showing. The application answers that per request; an
                  exported file cannot, so anything reading it has to be
                  behind a boundary, and drawing the line around the shell
                  rather than around each reader means the next one does not
                  break the export. Nothing is lost by it: every screen here
                  is client-rendered anyway, and the theme is already settled
                  by the head script before this mounts. */}
              <React.Suspense fallback={null}>
                <div className="app-shell-canvas flex h-dvh overflow-hidden bg-background noise-overlay">
                  <ApplicationNavigationRail />
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                    <AppHeader />
                    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                      {children}
                    </div>
                  </div>
                  <ApplicationNavigationDrawer />
                  <TourRunner />
                </div>
              </React.Suspense>
            </HeaderBreadcrumbSlotProvider>
          </ApplicationNavigationProvider>
        </ToastProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
