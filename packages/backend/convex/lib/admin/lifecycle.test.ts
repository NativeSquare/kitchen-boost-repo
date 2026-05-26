import { describe, expect, it } from "vitest";
import {
  CONTRACT_STATUS_TRANSITIONS,
  assertLegalContractTransition,
  isLegalContractTransition,
} from "./lifecycle";

/**
 * 2.9-D — the PURE contract lifecycle state machine (PRD 70 §3.5, kb-admin
 * CONTEXT "Statut contrat": `draft → sent → signed`, plus `→ expired`), written
 * BEFORE the implementation (TDD red).
 *
 * The state machine is the SINGLE source of truth for which status transitions
 * are legal; the mutations (`lifecycle.kbAdmin*`) defer to it so an illegal move
 * (e.g. `signed → draft`) can never be persisted. No state outside the schema's
 * `contractStatus` union is introduced.
 */

describe("2.9-D contract lifecycle state machine — legal transitions", () => {
  it("allows draft → sent", () => {
    expect(isLegalContractTransition("draft", "sent")).toBe(true);
  });

  it("allows sent → signed", () => {
    expect(isLegalContractTransition("sent", "signed")).toBe(true);
  });

  it("allows draft → expired and sent → expired", () => {
    expect(isLegalContractTransition("draft", "expired")).toBe(true);
    expect(isLegalContractTransition("sent", "expired")).toBe(true);
  });

  it("rejects skipping draft → signed", () => {
    expect(isLegalContractTransition("draft", "signed")).toBe(false);
  });

  it("rejects the backward move signed → draft", () => {
    expect(isLegalContractTransition("signed", "draft")).toBe(false);
  });

  it("rejects leaving the terminal signed / expired states", () => {
    expect(CONTRACT_STATUS_TRANSITIONS.signed).toEqual([]);
    expect(CONTRACT_STATUS_TRANSITIONS.expired).toEqual([]);
    expect(isLegalContractTransition("signed", "expired")).toBe(false);
    expect(isLegalContractTransition("expired", "signed")).toBe(false);
  });

  it("rejects self-loops", () => {
    expect(isLegalContractTransition("draft", "draft")).toBe(false);
    expect(isLegalContractTransition("sent", "sent")).toBe(false);
  });

  it("assertLegalContractTransition throws INVALID_STATE on an illegal edge", () => {
    expect(() => assertLegalContractTransition("signed", "draft")).toThrow(
      /signed.*draft/i,
    );
    // A legal edge does not throw.
    expect(() => assertLegalContractTransition("draft", "sent")).not.toThrow();
  });
});
