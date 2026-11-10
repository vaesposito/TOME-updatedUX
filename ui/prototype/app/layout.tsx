import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${mono.variable} antialiased`}>
        <PrototypeShell>{children}</PrototypeShell>
      </body>
    </html>
  );
}
