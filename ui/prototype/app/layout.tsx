import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import { PROTOTYPE_THEME } from "~/mock/theme";
import { PrototypeShell } from "./shell";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
  fallback: ["system-ui", "arial"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
  fallback: ["monospace"],
});

export const metadata: Metadata = {
  title: "TOME — interface prototype",
  description:
    "The TOME interface, running against fixtures: no server, no data, nothing to sign in to.",
};

/**
 * Choose the theme before the first paint.
 *
 * The application does this from its server-rendered layout; an exported
 * page has no server, so the same work has to happen in the document itself.
 * Done in an effect instead, the first paint would be the unthemed page and
 * every visit would open with a flash of light before snapping to dark.
 *
 * It writes the two attributes `ThemeProvider` reads, and the provider's own
 * effect stands down when it finds `data-theme-preference` already set. A
 * stored choice wins, so a visitor who switches to light stays in light.
 *
 * Written as a plain tag rather than through `next/script`: that component's
 * "beforeInteractive" hands the code to the framework to run once its own
 * runtime boots, which measured a frame or two after DOMContentLoaded — late
 * enough to be the flash this is here to prevent. An inline tag in the head
 * runs while the document is still being parsed.
 */
const themeScript = `(function(){try{var preference=localStorage.getItem("theme")||${JSON.stringify(
  PROTOTYPE_THEME,
).replace(/</g, "\\u003c")};var theme=preference;if(theme==="system"){theme=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}document.documentElement.setAttribute("data-theme-preference",preference);document.documentElement.setAttribute("data-theme",theme);document.documentElement.style.removeProperty("color-scheme");}catch(_error){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line react/no-danger -- a literal string built above, no input of any kind reaches it */}
        <script
          dangerouslySetInnerHTML={{ __html: themeScript }}
          id="initial-appearance-theme"
        />
      </head>
      <body className={`${inter.variable} ${mono.variable} antialiased`}>
        <PrototypeShell>{children}</PrototypeShell>
      </body>
    </html>
  );
}
