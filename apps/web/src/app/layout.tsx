import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { cookies } from "next/headers";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { ConvexClientProvider } from "@/providers/convex-client-provider";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { WalletBridgeRunner } from "@/components/wallet-bridge";
import { PWAInstallProvider } from "@/components/a2hs-install";
import { IOSStandaloneHeuristicRunner } from "@/components/a2hs-ios";
import { WALLET_BRIDGE_PENDING_COOKIE } from "@/lib/wallet-bridge";

const TENANT_COOKIE = "__Host-kb_tenant";

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // PWA-S9b (#461) — the PWA edge middleware sets this short-lived cookie
  // when it intercepts `?wallet=<serial>` from the Wallet pass back-of-pass
  // URL (decisions-log Q5, US 39 / 40 / 41 / 42). Mounting the
  // `<WalletBridgeRunner>` in the ROOT layout (not on `/` specifically)
  // means a deep-link landing on any path (`/menu`, `/c/<orderId>`,
  // `/checkout`, …) still gets bridged — the middleware preserves the
  // path when stripping the `wallet` param, so the runner activates on
  // whatever page the tap deep-links into. The cookie value flows once
  // through the RSC (server-side read, prop down) — the client never
  // re-parses cookies. The runner POSTs `/api/wallet-bridge/clear` after
  // running `signIn`, so a refresh / back button does NOT re-trigger.
  const cookieStore = await cookies();
  const pendingBridgeSerial =
    cookieStore.get(WALLET_BRIDGE_PENDING_COOKIE)?.value ?? null;
  // PWA-S11 (#463) — the iOS A2HS standalone heuristic runner needs the
  // tenantId for the `customer.pushEnrollment.recordA2hsAccepted` mutation
  // (self-scoped, wrapper-arg). Skipped in the degraded shell (cookie
  // missing) — the runner mounts but the Convex query is `"skip"`d.
  const tenantId = cookieStore.get(TENANT_COOKIE)?.value as
    | Id<"tenants">
    | undefined;

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
          <ConvexClientProvider>
            {pendingBridgeSerial !== null && (
              <WalletBridgeRunner serial={pendingBridgeSerial} />
            )}
            {/* PWA-S10 (#462) — captures the Android Chrome
                `beforeinstallprompt` event at the ROOT layout (the event
                fires once per page-load, early — must be listening before
                the post-cart `<AndroidInstallButton>` mounts). Also
                listens for `appinstalled` (Chrome 3-dot menu path).
                Wrapped INSIDE the Convex provider so the button (which
                consumes the captured prompt) has access to Convex hooks
                in its subtree (mutation + getCurrentCustomer query). */}
            {/* PWA-S11 (#463) — root-mounted runner that flips
                `customer.pushEnrollment.a2hsStatus = "enrolled"` the first
                time it detects `display-mode: standalone` on a fiche that
                hasn't been flipped yet. Mounted at root so EVERY standalone
                visit gets a chance to attribute the install — also covers
                the rare Android cross-session race where the #462
                `appinstalled` event fired after tab close. Renders nothing
                (pure side-effect). */}
            <IOSStandaloneHeuristicRunner tenantId={tenantId} />
            <PWAInstallProvider>{children}</PWAInstallProvider>
          </ConvexClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
