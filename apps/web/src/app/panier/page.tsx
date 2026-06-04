"use client";

/**
 * PWA-S5 (#453) — `/panier`: client-only cart page (decisions-log Q2 :
 * « /panier → Client-only (localStorage) »).
 *
 * The page reads NO cookie + makes NO Convex query of its own — the cart
 * state lives in the `<CartProvider>` (localStorage-backed, S4) and the
 * delivery verdict lives in the `<DeliveryModeProvider>` (one-shot
 * localStorage read of what S3 cached). Both are mounted right here so
 * the page is fully self-sufficient and free to navigate-into without
 * server round-trips (LCP-friendly + survives transient backend
 * outages, which only matter at checkout — S6).
 *
 * Layout :
 *  - Header : tenant heading + permanent `<DeliveryModeToggle>` (US 24).
 *  - Body : `<CartView>` (lines, Note, totals — US 20-23).
 *  - Footer (S5 scope) : back-to-menu link + a placeholder « Continuer
 *    vers le paiement » CTA that routes to `/checkout` (the checkout
 *    page itself is the S6 scope, not this slice).
 */
import Link from "next/link";
import { CartProvider } from "@/components/cart/cart-context";
import { CartView } from "@/components/cart/cart-view";
import { DeliveryModeProvider } from "@/components/delivery-mode/delivery-mode-context";
import { DeliveryModeToggle } from "@/components/delivery-mode/delivery-mode-toggle";

export default function PanierPage(): React.JSX.Element {
  return (
    <main className="min-h-screen bg-zinc-50">
      <CartProvider>
        <DeliveryModeProvider>
          <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 pb-32 pt-8 md:px-8">
            <header className="flex flex-col gap-3">
              <h1 className="text-3xl font-bold text-black">Ton panier</h1>
              <DeliveryModeToggle />
            </header>

            <CartView />

            <footer className="flex items-center justify-between gap-3">
              <Link
                href="/menu"
                className="text-sm font-medium text-zinc-700 hover:underline"
              >
                ← Retour au menu
              </Link>
              <Link
                href="/checkout"
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
              >
                Continuer vers le paiement
              </Link>
            </footer>
          </div>
        </DeliveryModeProvider>
      </CartProvider>
    </main>
  );
}
