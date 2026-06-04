/**
 * PWA-S9b (#461) — `wallet-bridge` component API.
 *
 * Surface consumed by the RSC entry point (`app/page.tsx`): a single client
 * component that runs the `signIn` chain when the pending cookie is present.
 * The pure decision + the cookie constants live in `@/lib/wallet-bridge`;
 * splitting "decide" from "perform" keeps every middleware branch
 * vitest-pinnable in node env without spinning up Next.
 */
export {
  WalletBridgeRunner,
  type WalletBridgeRunnerProps,
} from "./wallet-bridge-runner";
