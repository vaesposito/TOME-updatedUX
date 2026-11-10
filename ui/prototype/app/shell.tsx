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

// Before the first render rather than in an effect: the screens fetch on
// mount, and a request that left during the first paint would have gone to a
// server that is not there.
if (typeof window !== "undefined") {
  installMockApi();
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
  };
}

const SESSION = {
  user: { name: USER.name, email: USER.email, image: null },
  expires: "2099-01-01T00:00:00.000Z",
};

export function PrototypeShell({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider session={SESSION as never} refetchInterval={0}>
      <ThemeProvider>
        <ToastProvider>
          <ApplicationNavigationProvider initialCollapsed={false}>
            <HeaderBreadcrumbSlotProvider>
              <div className="app-shell-canvas flex h-dvh overflow-hidden bg-background noise-overlay">
                <ApplicationNavigationRail />
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  <AppHeader />
                  <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                    {/* Screens read the query to know which tab or page they
                        are showing. The application answers that per request;
                        an exported file cannot, so the whole screen waits for
                        the browser. */}
                    <React.Suspense fallback={null}>{children}</React.Suspense>
                  </div>
                </div>
                <ApplicationNavigationDrawer />
                {/* The runner reads the query to know which step it is on,
                    which an exported page cannot answer until it is in the
                    browser. */}
                <React.Suspense fallback={null}>
                  <TourRunner />
                </React.Suspense>
              </div>
            </HeaderBreadcrumbSlotProvider>
          </ApplicationNavigationProvider>
        </ToastProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
