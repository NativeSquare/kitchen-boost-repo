/**
 * F-MENU-02 (#200) — `useDebouncedCallback` test contract.
 *
 * Pure-TS hook used by the rename input: returns a stable `(value) => void`
 * that schedules `fn(value)` after `delayMs` of inactivity, cancelling any
 * pending call. Centralised here (vs ad-hoc setTimeout-in-effect) so:
 *   1. The debounce window is asserted independent of React rendering.
 *   2. The « only the last keystroke fires » invariant is pinned at the
 *      unit level (the rename mutation MUST NOT fire once per keystroke —
 *      autosave per ADR 0015 «  debounce on texts, immediate on actions »).
 *   3. The `cancel()` helper used on unmount/teardown stays testable.
 *
 * Run under node env w/ fake timers — same shape as the existing
 * `hooks/use-tenant-mutation.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDebouncedCallback } from "./use-debounced-callback";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useDebouncedCallback — autosave gate (ADR 0015)", () => {
  it("does not fire before the debounce window elapses", () => {
    const fn = vi.fn();
    const debounced = useDebouncedCallback(fn, 600);
    debounced("a");
    vi.advanceTimersByTime(599);
    expect(fn).not.toHaveBeenCalled();
  });

  it("fires once with the LAST value after the debounce window", () => {
    const fn = vi.fn();
    const debounced = useDebouncedCallback(fn, 600);
    debounced("a");
    vi.advanceTimersByTime(100);
    debounced("ab");
    vi.advanceTimersByTime(100);
    debounced("abc");
    vi.advanceTimersByTime(600);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("abc");
  });

  it("each rapid burst within the window cancels the previous timer (no per-keystroke fires)", () => {
    // 10 keystrokes 50ms apart, then idle — MUST fire exactly once.
    const fn = vi.fn();
    const debounced = useDebouncedCallback(fn, 600);
    for (let i = 0; i < 10; i += 1) {
      debounced(`v${i}`);
      vi.advanceTimersByTime(50);
    }
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("v9");
  });

  it("cancel() drops the pending call so unmount doesn't fire after the row is gone", () => {
    const fn = vi.fn();
    const debounced = useDebouncedCallback(fn, 600);
    debounced("a");
    debounced.cancel();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it("flush() fires immediately with the latest pending value (no waiting on the timer)", () => {
    // Used by the rename onBlur path: when the input loses focus we want to
    // commit the user's edit without waiting the rest of the window.
    const fn = vi.fn();
    const debounced = useDebouncedCallback(fn, 600);
    debounced("a");
    debounced("ab");
    debounced.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("ab");
    // And the timer is now drained — advancing past the window doesn't
    // re-fire.
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("flush() with nothing pending is a no-op", () => {
    const fn = vi.fn();
    const debounced = useDebouncedCallback(fn, 600);
    debounced.flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it("a fresh call after a flushed/cancelled call schedules independently", () => {
    const fn = vi.fn();
    const debounced = useDebouncedCallback(fn, 600);
    debounced("a");
    debounced.flush();
    debounced("b");
    vi.advanceTimersByTime(600);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, "a");
    expect(fn).toHaveBeenNthCalledWith(2, "b");
  });
});
