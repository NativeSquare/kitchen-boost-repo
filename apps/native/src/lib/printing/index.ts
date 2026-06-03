/**
 * Public API of the `printing` native module (#412 KB Orders, PRD 20 §14 +
 * kb-orders CONTEXT « Impression thermique cuisine »).
 *
 * Three concerns surface here, sharing the same Star Micronics WebPRNT spec:
 *
 *  - `PrinterEntry` — React entry pill on the home, sibling of
 *    `<PauseControl />`, `<ClosureControl />`, `<ItemAvailabilityEntry />` and
 *    `<ServiceHoursEntry />`. In V1 the « Imprimante cuisine » section lives
 *    here as the printer config landing — the full Settings page (#418) will
 *    later mount the same `PrinterSettingsScreen` from a Settings index.
 *
 *  - `PrinterSettingsScreen` — the dedicated « Imprimante cuisine » screen.
 *    Field « Adresse IP » + buttons « Enregistrer » / « Tester l'impression »
 *    / « Retirer l'imprimante ». Reads `getPrinterConfig`, writes via
 *    `setPrinterConfig` / `clearPrinterConfig`, fires the test ticket via
 *    `sendStarWebPrntTicket`.
 *
 *  - `useAutoPrintOnAcknowledge` — the hook the order detail mounts to
 *    fire-and-forget the LAN POST after a successful `acknowledge`. Reads
 *    the URL via `useQuery(getPrinterConfig)` so a printer added on KB Admin
 *    (#416) is picked up live without an app reload.
 *
 *  - Pure helpers (`decide-star-printer`) and the fetch wrapper
 *    (`print-order`) — pinned by their respective vitest suites. The React
 *    surfaces stay thin.
 *
 * The backend mutations/queries (`getPrinterConfig`, `setPrinterConfig`,
 * `clearPrinterConfig`) live on `api.lib.printing.printing.*` and ship their
 * cross-tenant fuzz (ADR 0010). The Star printer is on the resto's LAN — the
 * HTTP POST is fired CLIENT-SIDE, the backend only persists the URL.
 */

export { PrinterEntry } from "./printer-entry";
export { PrinterSettingsScreen } from "./printer-settings-screen";
export { printOrderTicket, type PrintOrderInput } from "./print-order-helper";
export {
  STAR_WEB_PRNT_PATH,
  buildStarWebPrntEndpoint,
  buildStarWebPrntRequestBody,
  buildStarWebPrntTestRequestBody,
  buildStarWebPrntTestTicket,
  buildStarWebPrntTicket,
  decidePrinterConfigForm,
  isValidStarWebPrntUrl,
  normaliseStarWebPrntUrl,
  type PrinterConfigFormDecision,
  type PrinterConfigFormInputs,
  type StarPrintInput,
  type StarPrintItem,
} from "./decide-star-printer";
export {
  DEFAULT_STAR_PRINT_TIMEOUT_MS,
  sendStarWebPrntTicket,
  type StarWebPrntSendInput,
  type StarWebPrntSendVerdict,
} from "./print-order";
