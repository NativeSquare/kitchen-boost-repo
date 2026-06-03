import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression pin (E2E AC2 — Alex, 2026-06-03): the magic-link sent to a gérant
 * invited from the wizard step 7 USED to point at `http://localhost:3001`
 * (the PWA `apps/web`) instead of `http://localhost:3000` (the admin app
 * `apps/admin`, where `/accept-invite` lives). Root cause: `emails.ts` read a
 * non-canonical `ADMIN_URL` env var (set nowhere in the project) and fell back
 * to the PWA port. Fixed by switching to the canonical `SITE_URL` env var
 * (README §5d, STACK.md) with a safe admin-port fallback.
 *
 * `emails.ts` is `"use node"` and top-level-imports the Resend SDK + Convex
 * generated server, both of which would fail to resolve under vitest. So we
 * mock those modules to no-ops and only exercise the pure helper.
 */
vi.mock("@convex-dev/resend", () => ({
  Resend: class {
    sendEmail() {
      return "stub";
    }
  },
}));
vi.mock("./_generated/server", () => ({
  internalAction: (def: unknown) => def,
}));
vi.mock("./_generated/api", () => ({
  components: { resend: {} },
}));
vi.mock("@packages/transactional", () => ({
  renderAdminInviteHtml: () => "",
}));

import { getAdminBaseUrl } from "./emails";

describe("getAdminBaseUrl — accept-invite magic-link base", () => {
  const originalSiteUrl = process.env.SITE_URL;

  beforeEach(() => {
    delete process.env.SITE_URL;
  });

  afterEach(() => {
    if (originalSiteUrl === undefined) {
      delete process.env.SITE_URL;
    } else {
      process.env.SITE_URL = originalSiteUrl;
    }
  });

  it("falls back to the ADMIN port (3000) when SITE_URL is unset — NEVER the PWA port (3001)", () => {
    const base = getAdminBaseUrl();
    expect(base).toBe("http://localhost:3000");
    expect(base).not.toContain("3001");
  });

  it("honours SITE_URL when present (prod-shaped URL)", () => {
    process.env.SITE_URL = "https://admin.kitchen-boost.fr";
    expect(getAdminBaseUrl()).toBe("https://admin.kitchen-boost.fr");
  });

  it("the produced magic-link points at /accept-invite on the admin host", () => {
    process.env.SITE_URL = "http://localhost:3000";
    const url = `${getAdminBaseUrl()}/accept-invite?token=abc123`;
    expect(url).toBe("http://localhost:3000/accept-invite?token=abc123");
  });
});
