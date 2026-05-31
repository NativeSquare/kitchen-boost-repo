/**
 * F-SUPPORT/1 (#210) — Module API du dossier `support/`.
 *
 * Surface publique exposée aux deux routes V1 (supervision + opérationnelle).
 * Toute consommation hors de ce dossier doit passer par cet `index.ts` (cf.
 * guardrail "Module API" du workflow).
 */
export { SupportContent } from "./SupportContent";
export type { SupportContentProps } from "./SupportContent";
export { supportConfig } from "./support.config";
export type {
  SupportConfig,
  SupportCsm,
  SupportResource,
} from "./support.config";
