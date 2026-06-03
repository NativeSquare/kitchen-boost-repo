"use client";

/**
 * #397 (KB Admin — Toggles disponibilité commerciale) — `DisponibiliteView`,
 * pure presentational shell of the « Disponibilité commerciale » page
 * (PRD 20 §7 / ADR 0018). Surface équivalente à l'app native (#406–#409) avec
 * **même state Convex partagé** : un changement KB Admin se reflète
 * immédiatement côté app native (et inversement, via la subscription Convex).
 *
 * Pure (zéro coupling Convex / URL / tenant) — la page parent (`page.tsx`) lit
 * les données via `useTenantQuery` + branche les mutations via
 * `useTenantMutation` et passe les props ici. Mirror exact du split
 * `ParametresView` / `SessionsView` / `MesClientsView`.
 *
 * Frontière ADR 0018
 * ------------------
 * Les 4 surfaces de disponibilité commerciale sont accessibles aux DEUX
 * apps (KB Admin web + KB Orders native). L'édition catalogue (création /
 * suppression item, prix, photo, modifiers) reste KB Admin seul (page
 * `/menu`). Les sections 3 (toggle item) et 4 (horaires) pointent vers les
 * pages existantes qui hébergent déjà l'éditeur live, plutôt que de
 * dupliquer la surface ici — le state Convex partagé fait le reste.
 */

import { useState } from "react";
import Link from "next/link";
import {
  IconArrowRight,
  IconCalendarOff,
  IconClock,
  IconClockPause,
  IconToolsKitchen2,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ---------------------------------------------------------------------------
// Public types — mirror the backend `getOperationalPause` /
// `getExceptionalClosure` shapes (cf. `lib/orders/orders.ts`).
// ---------------------------------------------------------------------------

/** A transient operational pause (PRD 20 §7a). Null = no active pause. */
export type Pause = { until: number } | null;

/** A durable exceptional closure (PRD 20 §7b). Null = no active closure. */
export type Closure = { from: number; until: number } | null;

/** Pause duration choices fixed by the PRD (no custom V1, acté §7a). */
const PAUSE_DURATIONS_MIN = [15, 30, 60] as const;
type PauseDurationMin = (typeof PAUSE_DURATIONS_MIN)[number];

export type DisponibiliteViewProps = {
  /**
   * The tenant id (string) — used to compose the `/menu` and `/parametres`
   * hrefs of the cross-link sections. Passed in as a string so the view
   * stays decoupled from the Convex `Id<"tenants">` brand.
   */
  tenantId: string;
  /**
   * Current operational pause — `undefined` = chargement (Convex sentinel),
   * `null` = no pause, `{ until }` = active or expired pause. The view
   * checks `until > nowMs` to decide whether to surface the « Lever la
   * pause » CTA (auto-reprise discipline, PRD 20 §7a).
   */
  pause: Pause | undefined;
  /**
   * Current exceptional closure — same loading / null / value contract as
   * `pause`. The view checks `from <= nowMs < until` for active state
   * (PRD 20 §7b).
   */
  closure: Closure | undefined;
  /** Set a pause for N minutes starting now (computes `until`). */
  onSetPause: (durationMin: PauseDurationMin) => Promise<void>;
  /** Lift the current pause immediately. */
  onClearPause: () => Promise<void>;
  /** Set an exceptional closure for `[from, until)` (epoch ms). */
  onSetClosure: (from: number, until: number) => Promise<void>;
  /** Lift the current exceptional closure immediately. */
  onClearClosure: () => Promise<void>;
  /**
   * Injected clock (epoch ms) — every time-sensitive display + the active /
   * expired decision derives from this. Defaults to `Date.now()` at call
   * site so unit tests can pin deterministic dates without touching the
   * real wall-clock.
   */
  nowMs: number;
};

// ---------------------------------------------------------------------------
// Helpers — Europe/Paris-aware formatting + pure active-state predicates
// ---------------------------------------------------------------------------

/** `HH:MM` in fr-FR (e.g. « 18:30 »). Defensive try/catch for old runtimes. */
function formatTime(ms: number): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms));
  } catch {
    const d = new Date(ms);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }
}

/** `JJ/MM/AAAA` in fr-FR (e.g. « 05/06/2026 »). */
function formatDate(ms: number): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short" }).format(
      new Date(ms),
    );
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/** PRD 20 §7a — `until` EXCLUSIVE (auto-reprise dérivée). */
function isPauseLive(pause: Pause, nowMs: number): boolean {
  return pause !== null && pause.until > nowMs;
}

/** PRD 20 §7b — `[from, until)` window. */
function isClosureLive(closure: Closure, nowMs: number): boolean {
  return closure !== null && closure.from <= nowMs && closure.until > nowMs;
}

/** Convert a yyyy-MM-dd HTML `<input type="date">` value to a local epoch ms
 *  at midnight (00:00). Returns `null` for an empty / invalid input. */
function dateInputToMs(value: string): number | null {
  if (value.length === 0) return null;
  // `new Date("YYYY-MM-DD")` parses as UTC midnight — for the closure window
  // we want local midnight so the gérant's « JJ/MM » expectations align with
  // his wall-clock. We split + use the local-time constructor.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    return null;
  }
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
}

/** Convert an epoch ms to the `yyyy-MM-dd` shape `<input type="date">` expects. */
function msToDateInput(ms: number): string {
  const d = new Date(ms);
  const y = String(d.getFullYear()).padStart(4, "0");
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export function DisponibiliteView({
  tenantId,
  pause,
  closure,
  onSetPause,
  onClearPause,
  onSetClosure,
  onClearClosure,
  nowMs,
}: DisponibiliteViewProps): React.ReactElement {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Disponibilité commerciale
        </h1>
        <p className="text-sm text-muted-foreground">
          Mets en pause les commandes en cours de service, ferme
          exceptionnellement plusieurs jours, marque un article en rupture ou
          ajuste les horaires d&apos;ouverture. Toute action ici est
          synchronisée en temps réel avec l&apos;app KB Orders sur la tablette
          cuisine.
        </p>
      </header>

      <PauseSection
        pause={pause}
        nowMs={nowMs}
        onSetPause={onSetPause}
        onClearPause={onClearPause}
      />
      <ClosureSection
        closure={closure}
        nowMs={nowMs}
        onSetClosure={onSetClosure}
        onClearClosure={onClearClosure}
      />
      <ItemsSection tenantId={tenantId} />
      <HoursSection tenantId={tenantId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Pause exceptionnelle — PRD 20 §7a / #406
// ---------------------------------------------------------------------------

function PauseSection({
  pause,
  nowMs,
  onSetPause,
  onClearPause,
}: {
  pause: Pause | undefined;
  nowMs: number;
  onSetPause: (durationMin: PauseDurationMin) => Promise<void>;
  onClearPause: () => Promise<void>;
}): React.ReactElement {
  const [submitting, setSubmitting] = useState<
    PauseDurationMin | "clear" | null
  >(null);

  const live =
    pause !== undefined && pause !== null && isPauseLive(pause, nowMs);

  async function handleSet(durationMin: PauseDurationMin) {
    setSubmitting(durationMin);
    try {
      await onSetPause(durationMin);
    } catch {
      // Toast surfaced at the page level; swallow here so the section is
      // re-enabled (the user can retry).
    } finally {
      setSubmitting(null);
    }
  }

  async function handleClear() {
    setSubmitting("clear");
    try {
      await onClearPause();
    } catch {
      // see above
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <Card data-slot="disponibilite-section-pause">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconClockPause className="size-5" aria-hidden="true" />
          Pause exceptionnelle
        </CardTitle>
        <CardDescription>
          Suspendre temporairement la prise de commandes (rush, rupture éclair,
          incident en cuisine). Reprise automatique à l&apos;heure indiquée.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {live && pause !== null && pause !== undefined ? (
          <div className="flex flex-col gap-3 rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
            <p className="font-medium">
              Resto en pause — reprise à{" "}
              <span data-slot="disponibilite-pause-eta">
                {formatTime(pause.until)}
              </span>
              .
            </p>
            <p className="text-xs text-muted-foreground">
              Les clients ne peuvent plus passer commande sur le site jusque-là.
            </p>
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-slot="disponibilite-pause-clear"
                disabled={submitting !== null}
                onClick={handleClear}
              >
                {submitting === "clear" ? "Reprise…" : "Lever la pause"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Pas de pause active. Choisis une durée :
            </p>
            <div className="flex flex-wrap gap-2">
              {PAUSE_DURATIONS_MIN.map((d) => (
                <Button
                  key={d}
                  type="button"
                  variant="outline"
                  data-slot={`disponibilite-pause-${d}`}
                  disabled={submitting !== null || pause === undefined}
                  onClick={() => handleSet(d)}
                >
                  {submitting === d ? `Pause ${d} min…` : `Pause ${d} min`}
                </Button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 2. Fermeture exceptionnelle — PRD 20 §7b / #407
// ---------------------------------------------------------------------------

function ClosureSection({
  closure,
  nowMs,
  onSetClosure,
  onClearClosure,
}: {
  closure: Closure | undefined;
  nowMs: number;
  onSetClosure: (from: number, until: number) => Promise<void>;
  onClearClosure: () => Promise<void>;
}): React.ReactElement {
  // Default: from today, until tomorrow (1 day). The gérant typically opens
  // this section already knowing the dates — these are just sane seeds.
  const today = msToDateInput(nowMs);
  const tomorrow = msToDateInput(nowMs + 24 * 60 * 60 * 1000);
  const [from, setFrom] = useState<string>(today);
  const [until, setUntil] = useState<string>(tomorrow);
  const [submitting, setSubmitting] = useState<"set" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const live =
    closure !== undefined && closure !== null && isClosureLive(closure, nowMs);

  async function handleSet() {
    setError(null);
    const fromMs = dateInputToMs(from);
    const untilMs = dateInputToMs(until);
    if (fromMs === null || untilMs === null) {
      setError("Sélectionne une date de début et une date de fin.");
      return;
    }
    if (fromMs >= untilMs) {
      setError("La date de fin doit être strictement après la date de début.");
      return;
    }
    setSubmitting("set");
    try {
      await onSetClosure(fromMs, untilMs);
    } catch {
      // page-level toast
    } finally {
      setSubmitting(null);
    }
  }

  async function handleClear() {
    setSubmitting("clear");
    try {
      await onClearClosure();
    } catch {
      // page-level toast
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <Card data-slot="disponibilite-section-closure">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconCalendarOff className="size-5" aria-hidden="true" />
          Fermeture exceptionnelle
        </CardTitle>
        <CardDescription>
          Fermer le resto pour plusieurs jours (vacances, panne frigo,
          intempéries). Les clients voient « Resto fermé jusqu&apos;au … » et le
          checkout est désactivé pendant toute la fenêtre.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {live && closure !== null && closure !== undefined ? (
          <div className="flex flex-col gap-3 rounded-md border border-rose-500/40 bg-rose-50 p-3 text-sm dark:bg-rose-950/30">
            <p className="font-medium">
              Resto fermé jusqu&apos;au{" "}
              <span data-slot="disponibilite-closure-until-display">
                {formatDate(closure.until)}
              </span>
              .
            </p>
            <p className="text-xs text-muted-foreground">
              Réversible à tout moment.
            </p>
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-slot="disponibilite-closure-clear"
                disabled={submitting !== null}
                onClick={handleClear}
              >
                {submitting === "clear" ? "Réouverture…" : "Lever la fermeture"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="closure-from">Du</Label>
                <Input
                  id="closure-from"
                  type="date"
                  data-slot="disponibilite-closure-from-input"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="closure-until">Au</Label>
                <Input
                  id="closure-until"
                  type="date"
                  data-slot="disponibilite-closure-until-input"
                  value={until}
                  onChange={(e) => {
                    setUntil(e.target.value);
                  }}
                />
              </div>
            </div>
            {error !== null ? (
              <p
                data-slot="disponibilite-closure-error"
                className="text-destructive text-sm"
              >
                {error}
              </p>
            ) : null}
            <div>
              <Button
                type="button"
                data-slot="disponibilite-closure-submit"
                disabled={submitting !== null || closure === undefined}
                onClick={handleSet}
              >
                {submitting === "set" ? "Fermeture…" : "Fermer le resto"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 3. Toggle dispo item — pointe vers /menu (PRD 20 §7c / ADR 0018)
// ---------------------------------------------------------------------------

function ItemsSection({ tenantId }: { tenantId: string }): React.ReactElement {
  return (
    <Card data-slot="disponibilite-section-items">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconToolsKitchen2 className="size-5" aria-hidden="true" />
          Disponibilité des articles
        </CardTitle>
        <CardDescription>
          Marque un article en rupture immédiate (le client ne peut plus le
          commander).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Ce toggle masque l&apos;article du menu côté client. Pas de
          modification permanente — il reste disponible dans ton catalogue
          (édition prix / photo / description côté Menu).
        </p>
        <div>
          <Button asChild variant="outline">
            <Link
              href={`/t/${tenantId}/menu`}
              data-slot="disponibilite-items-link"
            >
              Ouvrir le menu
              <IconArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 4. Modif horaires d'ouverture — pointe vers /parametres (PRD 20 §7d / ADR 0018)
// ---------------------------------------------------------------------------

function HoursSection({ tenantId }: { tenantId: string }): React.ReactElement {
  return (
    <Card data-slot="disponibilite-section-hours">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconClock className="size-5" aria-hidden="true" />
          Horaires d&apos;ouverture
        </CardTitle>
        <CardDescription>
          Ajuste les créneaux d&apos;ouverture du jour ou de la semaine
          courante.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          L&apos;éditeur des horaires de service vit dans la page Paramètres.
        </p>
        <div>
          <Button asChild variant="outline">
            <Link
              href={`/t/${tenantId}/parametres`}
              data-slot="disponibilite-hours-link"
            >
              Ouvrir les paramètres
              <IconArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
