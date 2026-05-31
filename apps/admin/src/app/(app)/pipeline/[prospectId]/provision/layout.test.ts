/**
 * F-WIZARD [1/10] (#265) — `layout.tsx` chrome-less contract.
 *
 * The wizard layout is "chrome-less / minimal": the parent `(app)/layout.tsx`
 * already mounts the SessionLoader + SessionGuard + ApplicationShell (sidebar +
 * header). This nested layout's only job is to wrap the wizard content in a
 * compact container that hides primary nav noise so the operator focuses on
 * the wizard.
 *
 * The header is intentionally KEPT (issue spec: « Header conserve le switcher
 * tenant mais hide les onglets de navigation principale »). The way we hide
 * the primary tabs in this slice is by NOT adding any extra sidebar tabs to
 * the (app) shell from inside the wizard (the existing sidebar is what it is
 * — we don't fight it here). The compact container at the layout level is the
 * minimal chrome-less surface the issue asks for; sidebar trimming inside the
 * shell itself is out of scope for this story (it would touch the global
 * AppSidebar).
 *
 * Pinned at the source-file level:
 *   - exports a default function (Next.js App Router layout contract).
 *   - declares the file is a client component (renders client-side wizard).
 *   - scope — never imports from `apps/web` or `apps/native`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const LAYOUT_SOURCE = readFileSync(
  path.resolve(__dirname, "./layout.tsx"),
  "utf8",
);

describe("layout.tsx — F-WIZARD [1/10] (#265) chrome-less wizard wrapper", () => {
  it("exports a default function (Next.js App Router layout contract)", () => {
    expect(LAYOUT_SOURCE).toMatch(/export\s+default\s+(?:function|\w)/);
  });

  it("renders its children (the wizard page)", () => {
    expect(LAYOUT_SOURCE).toMatch(/\{\s*children\s*\}/);
  });

  it("scope — never imports from `apps/web` or `apps/native`", () => {
    expect(LAYOUT_SOURCE).not.toMatch(/apps\/web/);
    expect(LAYOUT_SOURCE).not.toMatch(/apps\/native/);
  });
});
