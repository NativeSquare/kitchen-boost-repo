/**
 * F-MENU-02 (#200) — `useDebouncedCallback`, the autosave gate of the
 * rename input (ADR 0015 « debounce on texts, immediate on actions »).
 *
 * Centralised here, alongside the menu route, because:
 *   - It's tiny, owned by this slice, and not yet shared by other modules
 *     (when a second consumer lands we lift it to `apps/admin/src/hooks/`).
 *   - The contract (« only the LAST keystroke fires », « cancel on
 *     unmount », « flush on blur ») is testable in isolation, under the
 *     same `environment: "node"` setup as the rest of the menu route — no
 *     React renderer, no jsdom.
 *
 * Design notes:
 *   - We do NOT use `useRef` / `useEffect`: the hook is called inside a
 *     React component but its STATE (the pending timer + value) lives in a
 *     closure-scoped object created once per hook instantiation. Each render
 *     of the row produces a fresh debouncer — that's intentional in this
 *     slice (the row is unmounted on category delete, which calls `cancel`).
 *     If a future slice needs stable identity across renders, lift to
 *     `useRef`. Pinned by `use-debounced-callback.test.ts`.
 */

export type DebouncedCallback<T> = {
  (value: T): void;
  /** Cancel any pending invocation (used on row unmount). */
  cancel: () => void;
  /**
   * Fire the pending invocation immediately with the latest scheduled
   * value, and clear the timer. No-op if nothing is pending (used on
   * input blur to commit before the natural window elapses).
   */
  flush: () => void;
};

export function useDebouncedCallback<T>(
  fn: (value: T) => void,
  delayMs: number,
): DebouncedCallback<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;

  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = null;
  };

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending !== null) {
      const captured = pending.value;
      pending = null;
      fn(captured);
    }
  };

  const debounced = ((value: T) => {
    pending = { value };
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      const captured = pending?.value as T;
      pending = null;
      timer = null;
      fn(captured);
    }, delayMs);
  }) as DebouncedCallback<T>;

  debounced.cancel = cancel;
  debounced.flush = flush;
  return debounced;
}
