import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexClientProvider } from "@/providers/convex-client-provider";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * PWA-S1 (#449) — generic shell metadata, extended in PWA-S2 (#450) with the
 * PWA install primitives.
 *
 * `manifest` → `/manifest.webmanifest` is the DYNAMIC per-tenant manifest
 * route (PRD §10 PWA Client Q4). Next renders `<link rel="manifest" href="/
 * manifest.webmanifest">` in `<head>` automatically. The route reads the
 * `__Host-kb_tenant` cookie set by the PWA edge middleware (#449) and
 * serves the tenant-branded JSON shape decided by `decideManifest`.
 *
 * `appleWebApp.statusBarStyle: "default"` keeps the iOS status bar visible
 * (vs `black-translucent` which would overlap the header). Apple ignores
 * the manifest entirely, hence the dedicated `apple-touch-icon` route
 * referenced via `appleWebApp.startupImage` indirectly (Next auto-emits a
 * `<link rel="apple-touch-icon" href="/apple-touch-icon.png">` from the
 * `icons.apple` block below).
 *
 * The static `title` / `description` here are the GENERIC KitchenBoost
 * baseline; the `/` route overrides with `generateMetadata` once the tenant
 * is resolved (S2 leaves the override hook open for S3 to wire).
 */
export const metadata: Metadata = {
  title: "KitchenBoost",
  description: "Commande directement chez ton resto.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "KitchenBoost",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
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
          {/* PWA-S2 (#450) — registers /sw.js on mount; non-blocking, silent
              failure (PRD §10 Q4). Mounted under the body so any render
              failure inside the providers/children cannot prevent the SW
              from coming up. */}
          <ServiceWorkerRegistration />
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
