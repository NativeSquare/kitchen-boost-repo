/**
 * KB Orders — bannière persistante « disponibilité commerciale » sur TOUTES
 * les routes authentifiées de l'app native (PRD 20 §7 + ADR 0018, frontière
 * disponibilité commerciale).
 *
 * Aujourd'hui, `<PauseControl />` (#406) et `<ClosureControl />` (#407) ne
 * surfacent l'état pause / fermeture exceptionnelle QUE sur l'écran
 * `/settings/availability`. Conséquence : si le cuisinier est sur la home,
 * l'historique ou les stats, il n'a aucun rappel visuel que le resto est en
 * pause / fermé. La bannière vit dans `(app)/_layout.tsx` au-dessus du
 * `<Stack>`, à côté des bannières existantes
 * (`<TenantStatusBanner />`, `<PushPermissionBanner />`).
 *
 * Le composant `<AvailabilityBanner />` est un adaptateur fin :
 *
 *  - résout `tenantId` via `useActiveTenantId` (#399),
 *  - souscrit aux 3 queries Convex tenant-scoped :
 *      * `api.lib.orders.orders.getOperationalPause`
 *      * `api.lib.orders.orders.getExceptionalClosure`
 *      * `api.lib.menu.serviceHours.isOpenNow`
 *  - tique un horloge locale `nowMs` toutes les 30s (auto-flip auto-reprise
 *    sans attendre re-render Convex, même discipline que ClosureControl),
 *  - délègue le verdict à `decideAvailabilityBanner` ci-dessous.
 *
 * Cinq verdicts mutuellement exclusifs, dans l'ordre de priorité
 * d'affichage (le plus visible au moins) :
 *
 *  1. `closure`          — fermeture exceptionnelle ACTIVE
 *                          (`from <= now < until`). Rouge, la plus longue
 *                          donc la plus impactante.
 *  2. `pause`            — pause exceptionnelle ACTIVE (`until > now`).
 *                          Amber, transient (15-60 min).
 *  3. `closureScheduled` — fermeture exceptionnelle PROGRAMMÉE (`from > now`).
 *                          Gris/info muted — preview persistante des bornes
 *                          saisies par le gérant, sert de confirmation
 *                          visuelle immédiate après la saisie du bottom
 *                          sheet (bug 2026-06-07 Alex : sans ça, aucun
 *                          feedback pour valider les bornes custom).
 *  4. `outsideHours`     — `isOpenNow === false` (hors horaires de service).
 *                          Gris/neutre — non bloquant, c'est l'état normal en
 *                          dehors des plages, juste un rappel pour le gérant
 *                          qui reste connecté.
 *  5. `hidden`           — tenant ouvre normalement, aucune anomalie à
 *                          surfacer.
 *
 * Priorité — si DEUX états sont actifs en même temps (pause `+` fermeture,
 * ou hors horaires `+` fermeture), la fermeture l'emporte. La pause
 * l'emporte sur la closure programmée ET sur le hors horaires (active >
 * planifiée > info passive). Cohérent avec le gate backend
 * `acceptsOrderNow` qui refuse dès qu'UN signal ACTIF est négatif, et avec
 * la grammaire « le plus durable / impactant gagne l'attention du gérant ».
 * V1 : on ne stacke pas 2 bannières — si pause active ET closure
 * programmée, on perd l'info programmée jusqu'à la fin de la pause.
 *
 * Pure / déterministe — aucun `Date.now()` interne, l'horloge est injectée
 * via `nowMs`. La truth table est pinnée par
 * `decide-availability-banner.test.ts` (vitest, node env, no jsdom).
 */

import type {
  ExceptionalClosure,
  OperationalPause,
} from "@packages/backend/convex/lib/orders";

/** Inputs the decision needs to reach a verdict. */
export type AvailabilityBannerInputs = {
  /**
   * Convex `getOperationalPause` result :
   *  - `undefined` = query en flight (loading sentinel),
   *  - `null` = aucune pause configurée,
   *  - `{ until }` = pause ACTIVE OU expirée (le prédicat `until > now` décide).
   */
  pause: OperationalPause | undefined;
  /**
   * Convex `getExceptionalClosure` result :
   *  - `undefined` = query en flight (loading sentinel),
   *  - `null` = aucune fermeture configurée,
   *  - `{ from, until }` = fermeture planifiée / active / expirée (le prédicat
   *    `from <= now < until` décide).
   */
  closure: ExceptionalClosure | undefined;
  /**
   * Convex `isOpenNow` result (PUBLIC tenant query, REUSED depuis la PWA
   * checkout gate) :
   *  - `undefined` = query en flight,
   *  - `true` = tenant DANS une plage de service maintenant,
   *  - `false` = tenant HORS plage (pas d'horaires configurés OU hors créneau).
   */
  isOpenNow: boolean | undefined;
  /**
   * Wall-clock `Date.now()` résolu par le composant. Injecté pour garder la
   * décision pure — les tests pinnent des dates déterministes sans toucher
   * la vraie horloge.
   */
  nowMs: number;
};

/** Verdict de la bannière. `hidden` quand tout va bien OU pendant le loading
 *  (la bannière n'apparaît que sur info confirmée — on ne flash pas la
 *  bannière hors horaires avant la résolution Convex). */
export type AvailabilityBannerDecision =
  | { kind: "hidden" }
  | {
      kind: "closure";
      /** epoch ms — fin de la fermeture (le composant formate en `JJ/MM`). */
      until: number;
    }
  | {
      kind: "pause";
      /** epoch ms — fin de la pause (le composant formate en `HH:MM`). */
      until: number;
    }
  | {
      kind: "closureScheduled";
      /** epoch ms — début de la fermeture programmée (`JJ/MM`). */
      from: number;
      /** epoch ms — fin de la fermeture programmée (`JJ/MM`). */
      until: number;
    }
  | { kind: "outsideHours" };

/**
 * Pure predicate, mirror du backend `isPauseActive` (status.ts). `until` est
 * EXCLUSIVE : à exactement `until` la pause est finie (auto-reprise dérivée,
 * pas de cron). Aligné sur `decidePauseControl.isPauseLive`.
 */
function isPauseLive(pause: OperationalPause, nowMs: number): boolean {
  return pause !== null && pause.until > nowMs;
}

/**
 * Pure predicate, mirror du backend `isClosureActive` (status.ts). `from`
 * INCLUSIVE, `until` EXCLUSIVE — une fermeture planifiée pour demain ne gate
 * pas aujourd'hui. Aligné sur `decideClosureControl.isClosureLive`.
 */
function isClosureLive(closure: ExceptionalClosure, nowMs: number): boolean {
  if (closure === null) return false;
  return closure.from <= nowMs && closure.until > nowMs;
}

/**
 * Pure predicate : la fermeture est PROGRAMMÉE dans le futur (pas encore
 * live). `from > nowMs` ET `until > nowMs` — le second test est défensif
 * pour ignorer un row corrompu où `until < from` (le backend rejette déjà
 * cette forme mais on ne fait pas confiance au shape de la sub).
 */
function isClosureScheduled(
  closure: ExceptionalClosure,
  nowMs: number,
): boolean {
  if (closure === null) return false;
  return closure.from > nowMs && closure.until > nowMs;
}

/**
 * Décide ce que la bannière de disponibilité rend cette frame. Pure : mêmes
 * inputs ⇒ même output, no `Date.now()`, no side effects. Truth table pinnée
 * dans `decide-availability-banner.test.ts`.
 *
 * Loading : tant qu'au moins une des queries clés (`pause`, `closure`) est
 * `undefined`, on rend `hidden` plutôt que de flasher un état partiel. On NE
 * gate PAS sur `isOpenNow === undefined` parce qu'il sert uniquement au kind 3
 * (le moins prioritaire) — si seul isOpenNow est en flight, on peut quand
 * même décider closure/pause/hidden sur la base des deux autres.
 */
export function decideAvailabilityBanner(
  inputs: AvailabilityBannerInputs,
): AvailabilityBannerDecision {
  // Loading guard sur les deux queries principales (pause + closure). Le
  // hors-horaires est un signal MOLLE — on attend juste qu'il revienne pour
  // décider entre `outsideHours` et `hidden`, mais on peut déjà décider
  // closure / pause sans lui.
  if (inputs.pause === undefined || inputs.closure === undefined) {
    return { kind: "hidden" };
  }

  // 1. Fermeture exceptionnelle ACTIVE — la plus impactante (1+ jour). Wins
  //    sur tout. Re-narrow `closure !== null` côté local pour atteindre
  //    `.until` — `isClosureLive` retourne un `boolean` qui perd le
  //    discriminant.
  if (inputs.closure !== null && isClosureLive(inputs.closure, inputs.nowMs)) {
    return { kind: "closure", until: inputs.closure.until };
  }

  // 2. Pause exceptionnelle — transient (15-60 min). Wins sur fermeture
  //    programmée + hors horaires (active > planifiée > info passive). Même
  //    pattern de re-narrow que pour la fermeture ci-dessus.
  if (inputs.pause !== null && isPauseLive(inputs.pause, inputs.nowMs)) {
    return { kind: "pause", until: inputs.pause.until };
  }

  // 3. Fermeture exceptionnelle PROGRAMMÉE (`from > now`) — preview
  //    persistante. Indispensable comme feedback immédiat après la saisie
  //    du bottom sheet `<ClosureControl />` (bug 2026-06-07 Alex : sans
  //    cette ligne, le gérant n'a aucune confirmation que les bornes
  //    custom ont bien été enregistrées). Le backend `acceptsOrderNow` ne
  //    refuse PAS encore les checkouts (cohérent avec `isClosureActive`
  //    inclusif sur `from`) — c'est uniquement un signal d'information UX.
  if (
    inputs.closure !== null &&
    isClosureScheduled(inputs.closure, inputs.nowMs)
  ) {
    return {
      kind: "closureScheduled",
      from: inputs.closure.from,
      until: inputs.closure.until,
    };
  }

  // 4. Hors horaires — uniquement si `isOpenNow` est résolu ET vaut `false`.
  //    Si la query est en flight, on rend `hidden` plutôt que de flasher un
  //    « hors horaires » qui se révélerait faux 200ms plus tard.
  if (inputs.isOpenNow === false) {
    return { kind: "outsideHours" };
  }

  // 5. Tout va bien (ou isOpenNow encore en flight) — hidden.
  return { kind: "hidden" };
}

/**
 * Formate l'heure de fin de pause en fr-FR `HH:MM`. Mirror de
 * `formatPauseEta` (decide-pause-control.ts) pour que le gérant voie le
 * même format dans la bannière persistante et dans le `<PauseControl />`
 * sur l'écran availability.
 */
export function formatAvailabilityPauseEta(untilMs: number): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(untilMs));
  } catch {
    const d = new Date(untilMs);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }
}

/**
 * Formate la date de fin de fermeture en fr-FR `JJ/MM`. Mirror de
 * `formatClosureUntilDate` (decide-closure-control.ts) pour que le gérant
 * voie le même format dans la bannière persistante et dans le
 * `<ClosureControl />` sur l'écran availability.
 */
export function formatAvailabilityClosureUntilDate(untilMs: number): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "2-digit",
    }).format(new Date(untilMs));
  } catch {
    const d = new Date(untilMs);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    return `${day}/${month}`;
  }
}
