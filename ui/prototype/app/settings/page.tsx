"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { LoadingScreen } from "@/components/loading-screen";
import { PERSONAL_SETTINGS_ROUTES } from "@/components/settings/settings-routes";

/**
 * Settings open on the first section, as they do in the application. That
 * is a server redirect there and a client one here, an exported page having
 * no server to redirect from.
 */
export default function SettingsPage() {
  const router = useRouter();

  React.useEffect(() => {
    router.replace(PERSONAL_SETTINGS_ROUTES[0].href);
  }, [router]);

  return <LoadingScreen message="Opening settings…" />;
}
