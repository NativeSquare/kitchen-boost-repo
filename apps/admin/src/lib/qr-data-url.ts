/**
 * F-QR.1 — Thin wrapper around the `qrcode` lib's `toDataURL` so the rest of
 * the admin app (page QR, step-6 wizard) depends on a STABLE internal
 * contract: `(url: string, options?) → Promise<dataUrl: string>`. If we ever
 * swap the lib (qr-code-styling, server-side rendering, …) only this module
 * changes; consumers stay intact.
 *
 * Why not call `qrcode` directly from components? Two reasons:
 *   - Lib name is an implementation detail; the rest of the app should not
 *     import it (deep-module rule, KB CONTEXT).
 *   - We may want to inject options (margin, color, errorCorrectionLevel) per
 *     format later (sticker rond vs A4 affiche) — concentrating that logic
 *     here keeps it tractable.
 */
import QRCode from "qrcode";

/**
 * Options forwarded to the underlying QR lib. Re-exported through the wrapper
 * type so callers don't import `qrcode` types directly. Kept loose V1 — the
 * 3 layouts (sticker / A6 / A4) only need `margin` + `width` + `color`.
 */
export type QrDataUrlOptions = QRCode.QRCodeToDataURLOptions;

/**
 * Generate a PNG data URL (`data:image/png;base64,...`) encoding the given
 * URL. Suitable for direct injection into `@react-pdf/renderer`'s `<Image
 * src={...} />`.
 */
export async function generateQrDataUrl(
  url: string,
  options?: QrDataUrlOptions,
): Promise<string> {
  return QRCode.toDataURL(url, options);
}
