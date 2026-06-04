import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexClientProvider } from "@/providers/convex-client-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * PWA-S1 (#449) — generic shell metadata.
 *
 * The per-tenant manifest (logo + name + color) lands in a future slice as
 * a dynamic `/manifest.webmanifest` route keyed on the resolved tenant
 * (PRD §10 PWA Client). The static metadata here is a SAFE-ENOUGH baseline
 * the / route can override with `generateMetadata` once the tenant name is
 * resolved server-side (S2).
 */
export const metadata: Metadata = {
  title: "KitchenBoost",
  description: "Commande directement chez ton resto.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ConvexAuthNextjsServerProvider>
      <html lang="fr">
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        >
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
