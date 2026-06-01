/**
 * F-PIPELINE-CRM 05 (#255) — `ProspectSearchBar` test matrix.
 *
 * Controlled input that lifts its value to the parent (the parent runs
 * `searchProspectsByName` on the active prospect list to filter the cards
 * in real time). The pure-filter semantics (case + accent insensitive,
 * empty = identity) are pinned by `prospectFilter.test.ts`. Here we only
 * pin the controlled-input contract :
 *
 *   - exposes an `<input>` of type "search"
 *   - reflects the `value` prop
 *   - calls `onChange(string)` with the next value, not the raw event
 *     (the parent is React-shape-agnostic — it just stores a string)
 *   - has an accessible label / placeholder (« Rechercher un prospect »)
 */
import { describe, expect, it, vi } from "vitest";
import React from "react";

import { ProspectSearchBar } from "./prospect-search-bar";
import { findFirstByName, serialize } from "./test-utils";

describe("ProspectSearchBar — F-PIPELINE-CRM 05 (#255)", () => {
  it("renders a search-typed input that reflects the controlled `value` prop", () => {
    const tree = serialize(
      React.createElement(ProspectSearchBar, {
        value: "pizz",
        onChange: () => {},
      }),
    );
    const input = findFirstByName(tree, "input");
    expect(input).not.toBeNull();
    expect(input?.props.type).toBe("search");
    expect(input?.props.value).toBe("pizz");
  });

  it("has an accessible placeholder « Rechercher un prospect »", () => {
    const tree = serialize(
      React.createElement(ProspectSearchBar, {
        value: "",
        onChange: () => {},
      }),
    );
    const input = findFirstByName(tree, "input");
    const placeholder = input?.props.placeholder;
    expect(typeof placeholder).toBe("string");
    expect(placeholder as string).toMatch(/recherche/i);
  });

  it("calls `onChange` with the next string value (not the raw event)", () => {
    const onChange = vi.fn();
    const tree = serialize(
      React.createElement(ProspectSearchBar, { value: "", onChange }),
    );
    const input = findFirstByName(tree, "input");
    // The DOM-level onChange fires with a synthetic event; the component
    // adapter forwards `event.target.value` to the prop callback. Simulate
    // the synthetic event shape directly (no jsdom in this env).
    const handler = input?.props.onChange as (e: unknown) => void;
    expect(typeof handler).toBe("function");
    handler({ target: { value: "sushi" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("sushi");
  });
});
