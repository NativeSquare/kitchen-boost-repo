import { describe, expect, it } from "vitest";
import {
  STAR_WEB_PRNT_PATH,
  buildStarWebPrntEndpoint,
  buildStarWebPrntRequestBody,
  buildStarWebPrntTestRequestBody,
  buildStarWebPrntTestTicket,
  buildStarWebPrntTicket,
  decidePrinterConfigForm,
  isValidStarWebPrntUrl,
  normaliseStarWebPrntUrl,
} from "./decide-star-printer";

/**
 * #412 — pure helpers for Star Micronics WebPRNT printing (PRD 20 §14 +
 * kb-orders CONTEXT « Impression thermique cuisine »). Same node-env, no
 * React, no Convex, no Expo split as `decideForceUpdate` (#394),
 * `decideTenantSwitcher` (#399), `decidePauseControl` (#406), …
 *
 * The native gate (`PrinterSettingsScreen`, the « Réimprimer » button on the
 * order detail, the auto-print at `acknowledge`) ALL go through these
 * functions so the truth table is pinned ONCE here — the React surface and
 * the fetch wrapper stay thin.
 *
 *  - `isValidStarWebPrntUrl(input)` — gérant input gate (http/https, non-empty).
 *  - `normaliseStarWebPrntUrl(input)` — trim + lowercase the scheme.
 *  - `buildStarWebPrntEndpoint(ip)` — derive the canonical
 *    `http://<ip>/StarWebPRNT/SendMessage` from a bare IP.
 *  - `buildStarWebPrntTicket(input)` — the ESC/POS ticket body for ONE order.
 *  - `buildStarWebPrntTestTicket(tenantName)` — the test ticket the « Tester
 *    l'impression » button POSTs.
 *  - `buildStarWebPrntRequestBody(ticket)` — the WebPRNT request envelope
 *    (a `request` URL-encoded form key carrying the SBP XML) the printer's
 *    HTTP endpoint expects.
 *  - `decidePrinterConfigForm(input)` — derived form state for the Settings
 *    screen (`{ canSubmit, displayUrl, error }`).
 */

describe("#412 STAR_WEB_PRNT_PATH — canonical WebPRNT path (PRD 20 §14)", () => {
  it("targets `/StarWebPRNT/SendMessage`", () => {
    expect(STAR_WEB_PRNT_PATH).toBe("/StarWebPRNT/SendMessage");
  });
});

describe("#412 isValidStarWebPrntUrl — gérant input gate", () => {
  it("accepts http://<ip>/StarWebPRNT/SendMessage (the canonical form)", () => {
    expect(
      isValidStarWebPrntUrl("http://192.168.1.42/StarWebPRNT/SendMessage"),
    ).toBe(true);
  });

  it("accepts https://<host>/<path>", () => {
    expect(
      isValidStarWebPrntUrl("https://printer.local/StarWebPRNT/SendMessage"),
    ).toBe(true);
  });

  it("rejects a bare IP (no scheme)", () => {
    expect(isValidStarWebPrntUrl("192.168.1.42")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isValidStarWebPrntUrl("")).toBe(false);
  });

  it("rejects whitespace-only input", () => {
    expect(isValidStarWebPrntUrl("   ")).toBe(false);
  });

  it("rejects unsafe schemes (javascript:, file:, data:)", () => {
    expect(isValidStarWebPrntUrl("javascript:alert(1)")).toBe(false);
    expect(isValidStarWebPrntUrl("file:///etc/passwd")).toBe(false);
    expect(isValidStarWebPrntUrl("data:text/html,boom")).toBe(false);
  });
});

describe("#412 normaliseStarWebPrntUrl — trim + lowercase scheme", () => {
  it("trims surrounding whitespace", () => {
    expect(
      normaliseStarWebPrntUrl("  http://192.168.1.42/StarWebPRNT/SendMessage "),
    ).toBe("http://192.168.1.42/StarWebPRNT/SendMessage");
  });

  it("lowercases the scheme (HTTP → http) but keeps the path case", () => {
    expect(
      normaliseStarWebPrntUrl("HTTP://192.168.1.42/StarWebPRNT/SendMessage"),
    ).toBe("http://192.168.1.42/StarWebPRNT/SendMessage");
  });
});

describe("#412 buildStarWebPrntEndpoint — derive URL from a bare IP", () => {
  it("appends the canonical Star path to a v4 IP", () => {
    expect(buildStarWebPrntEndpoint("192.168.1.42")).toBe(
      "http://192.168.1.42/StarWebPRNT/SendMessage",
    );
  });

  it("trims whitespace before deriving", () => {
    expect(buildStarWebPrntEndpoint("  192.168.1.42  ")).toBe(
      "http://192.168.1.42/StarWebPRNT/SendMessage",
    );
  });
});

describe("#412 decidePrinterConfigForm — Settings form state", () => {
  it("invalid empty input → canSubmit=false, error « obligatoire »", () => {
    const v = decidePrinterConfigForm({ input: "", currentUrl: null });
    expect(v.canSubmit).toBe(false);
    expect(v.canTest).toBe(false);
    expect(v.displayUrl).toBe("");
    expect(v.error).toMatch(/obligatoire/i);
  });

  it("invalid scheme → canSubmit=false, error explicite", () => {
    const v = decidePrinterConfigForm({
      input: "192.168.1.42",
      currentUrl: null,
    });
    expect(v.canSubmit).toBe(false);
    expect(v.canTest).toBe(false);
    expect(v.displayUrl).toBe("192.168.1.42");
    expect(v.error).toMatch(/http/i);
  });

  it("valid input → canSubmit=true, canTest=true, displayUrl=normalisé, no error", () => {
    const v = decidePrinterConfigForm({
      input: "  HTTP://192.168.1.42/StarWebPRNT/SendMessage  ",
      currentUrl: null,
    });
    expect(v.canSubmit).toBe(true);
    expect(v.canTest).toBe(true);
    expect(v.displayUrl).toBe("http://192.168.1.42/StarWebPRNT/SendMessage");
    expect(v.error).toBeNull();
  });

  it("valid input identical to current → canSubmit=false (rien à enregistrer), canTest=true", () => {
    // The gérant opens Settings, the input is pre-filled with the saved URL,
    // and they tap « Tester l'impression » — Save is disabled (no diff) but
    // Test is enabled (they can re-fire the test against the saved URL).
    const url = "http://192.168.1.42/StarWebPRNT/SendMessage";
    const v = decidePrinterConfigForm({ input: url, currentUrl: url });
    expect(v.canSubmit).toBe(false);
    expect(v.canTest).toBe(true);
    expect(v.error).toBeNull();
  });

  it("valid input differs from current → canSubmit=true, canTest=true", () => {
    const v = decidePrinterConfigForm({
      input: "http://192.168.1.99/StarWebPRNT/SendMessage",
      currentUrl: "http://192.168.1.42/StarWebPRNT/SendMessage",
    });
    expect(v.canSubmit).toBe(true);
    expect(v.canTest).toBe(true);
  });
});

describe("#412 buildStarWebPrntTicket — ESC/POS body for ONE order", () => {
  const baseInput = {
    tenantName: "Buns and Bao",
    orderId: "ord-abc1234" as const,
    mode: "delivery" as const,
    createdAtMs: new Date(2026, 0, 15, 19, 5, 0, 0).getTime(),
    items: [
      {
        quantity: 2,
        itemName: "Smash Double",
        modifiers: [
          { groupName: "Sauce", optionName: "Ketchup", priceDelta: 0 },
          { groupName: "Cuisson", optionName: "Saignant", priceDelta: 0 },
        ],
      },
      {
        quantity: 1,
        itemName: "Frites maison",
        modifiers: [],
      },
    ],
    restaurantNote: "Sans oignon svp",
    totalCents: 3170,
  };

  it("includes the tenant name as the ticket header (resto identification)", () => {
    const t = buildStarWebPrntTicket(baseInput);
    expect(t).toContain("Buns and Bao");
  });

  it("includes the short order id tail (the same #ABCD the home card surfaces)", () => {
    const t = buildStarWebPrntTicket(baseInput);
    // The card UI rendering uppercases the tail (`order detail` uses
    // `slice(-4).toUpperCase()`); the printed ticket mirrors that.
    expect(t).toContain("Cmd #1234");
  });

  it("XML-escapes a tenant name containing reserved chars (« & ») so the SBP doc stays valid", () => {
    // A real tenant name like « Buns & Bao » would break the <data><text>...</text></data>
    // SBP envelope if injected raw — we escape `&` to `&amp;` so the
    // printer's XML parser still consumes the whole envelope cleanly.
    const t = buildStarWebPrntTicket({
      ...baseInput,
      tenantName: "Buns & Bao",
    });
    expect(t).toContain("Buns &amp; Bao");
    expect(t).not.toMatch(/Buns & Bao/);
  });

  it("renders the mode tag for delivery (🚴 LIVRAISON)", () => {
    const t = buildStarWebPrntTicket(baseInput);
    expect(t).toContain("LIVRAISON");
  });

  it("renders the mode tag for pickup (🛍️ À EMPORTER)", () => {
    const t = buildStarWebPrntTicket({ ...baseInput, mode: "pickup" });
    expect(t).toContain("A EMPORTER");
  });

  it("renders one line per item with its quantity prefix", () => {
    const t = buildStarWebPrntTicket(baseInput);
    expect(t).toContain("2 x Smash Double");
    expect(t).toContain("1 x Frites maison");
  });

  it("renders modifiers under each item, indented", () => {
    const t = buildStarWebPrntTicket(baseInput);
    expect(t).toContain("Sauce: Ketchup");
    expect(t).toContain("Cuisson: Saignant");
  });

  it("renders the restaurant note (cuisine note client) when present", () => {
    const t = buildStarWebPrntTicket(baseInput);
    expect(t).toContain("Note");
    expect(t).toContain("Sans oignon svp");
  });

  it("OMITS the note section when the order has no restaurantNote", () => {
    const t = buildStarWebPrntTicket({
      ...baseInput,
      restaurantNote: undefined,
    });
    expect(t).not.toContain("Note");
  });

  it("renders the total in euros with a comma decimal separator (fr-FR convention)", () => {
    const t = buildStarWebPrntTicket(baseInput);
    expect(t).toContain("31,70");
  });

  it("OMITS the total when the order has no pricingSnapshot yet (defensive)", () => {
    const t = buildStarWebPrntTicket({ ...baseInput, totalCents: undefined });
    expect(t).not.toMatch(/Total/i);
  });

  it("returns a string suitable for the WebPRNT SBP envelope (parseable XML)", () => {
    const t = buildStarWebPrntTicket(baseInput);
    // The output is wrapped in <data> tags — the WebPRNT SBP envelope is
    // <text>…</text> chunks, but the helper wraps the whole body to keep one
    // single document. Pinning the OUTER shape here so a future native
    // surface relying on string contains/expects still works.
    expect(t.startsWith("<data>")).toBe(true);
    expect(t.endsWith("</data>")).toBe(true);
  });
});

describe("#412 buildStarWebPrntTestTicket — the « Tester l'impression » payload", () => {
  it("includes a clear « TEST » header so the gérant ne confond pas avec une vraie cmd", () => {
    const t = buildStarWebPrntTestTicket("Buns and Bao");
    expect(t).toContain("TEST");
    expect(t).toContain("Buns and Bao");
  });

  it("returns a non-empty <data>...</data> envelope (same shape as the order ticket)", () => {
    const t = buildStarWebPrntTestTicket("Buns and Bao");
    expect(t.startsWith("<data>")).toBe(true);
    expect(t.endsWith("</data>")).toBe(true);
  });
});

describe("#412 buildStarWebPrntRequestBody — WebPRNT envelope", () => {
  it("returns a URL-encoded form body with a `request` key carrying the SBP XML", () => {
    const ticket = "<data><text>hi</text></data>";
    const body = buildStarWebPrntRequestBody(ticket);
    // The body is `application/x-www-form-urlencoded` — the WebPRNT endpoint
    // expects `request=<urlencoded XML>` (Star « Browser SDK » Manual §4).
    expect(body).toMatch(/^request=/);
    expect(body).toContain(encodeURIComponent("<data>"));
    expect(body).toContain(encodeURIComponent("<text>hi</text>"));
  });
});
