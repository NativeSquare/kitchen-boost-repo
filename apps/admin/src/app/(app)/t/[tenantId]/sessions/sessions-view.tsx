"use client";

/**
 * #396 (KB Admin — Page Sessions actives) — `SessionsView`, pure
 * presentational component pour la page « Sessions actives » du tenant
 * (PRD 20 §13 « Révocation session distante », Compliance RGPD Article 2 ter
 * du contrat).
 *
 * Pure (zéro coupling Convex / URL / tenant) — la page parent (`page.tsx`)
 * lit les données via `useTenantQuery` et passe les props ici. Mirror exact
 * du split `ParametresView` / `MesClientsView` / `MenuView`.
 *
 * 2-step destructive UX (PRD 70 — onboarding wizard step 8 + revoke patterns) :
 *  1. Bouton « Révoquer » par ligne → ouvre `<AlertDialog/>` (NE révoque PAS
 *     directement).
 *  2. Dialog header surface l'identité ciblée (email + name si dispo) ; le
 *     bouton « Révoquer la session » est `variant="destructive"`. Cancel →
 *     ferme sans action.
 *
 * Self-session warning : si la ligne porte `sessionId === currentSessionId`,
 * un marker « cette session » s'affiche (l'utilisateur va se déconnecter
 * lui-même — visible AVANT le confirm).
 *
 * Sub-flow `onRevokeSession` :
 *  - Le handler renvoyé par la page wrap `useTenantMutation(revokeSession)`
 *    + toast success / error + re-throw. La view ne sait rien de la
 *    plomberie ; elle appelle juste `onRevokeSession(sessionId)`.
 */

import { useState } from "react";

import type { Id } from "@packages/backend/convex/_generated/dataModel";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ---------------------------------------------------------------------------
// Public types — mirror the backend `sessionRowValidator`.
// ---------------------------------------------------------------------------

/** One row of the listing — projection of `authSessions` + `users`. */
export type SessionRow = {
  sessionId: Id<"authSessions">;
  userId: Id<"users">;
  userEmail: string | undefined;
  userName: string | undefined;
  /** Session creation time (ms epoch). */
  createdAt: number;
  /** Session expiration time (ms epoch). */
  expiresAt: number;
};

export type SessionsViewProps = {
  /**
   * Liste des sessions actives du tenant courant. `undefined` = chargement
   * Convex (sentinel useQuery). `[]` = pas de session active (équipe pas
   * encore connectée).
   */
  sessions: SessionRow[] | undefined;
  /**
   * Appelé quand l'utilisateur confirme la révocation (étape 2 du dialog).
   * La promesse re-throw permet au handler page-level de surfacer une
   * erreur (toast).
   */
  onRevokeSession: (sessionId: Id<"authSessions">) => Promise<void>;
  /**
   * `sessionId` du caller, si disponible. Quand une ligne porte cette
   * valeur, la view affiche un marker « cette session » pour avertir
   * l'utilisateur qu'il va se déconnecter lui-même.
   */
  currentSessionId: Id<"authSessions"> | undefined;
};

// ---------------------------------------------------------------------------
// Helpers — date formatting (Europe/Paris locale)
// ---------------------------------------------------------------------------

function formatDateTime(ms: number): string {
  // Intl is available in node + browsers. We pin to fr-FR for the FR market.
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(ms));
  } catch {
    // Defensive fallback — should never trigger in modern runtimes.
    return new Date(ms).toISOString();
  }
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export function SessionsView({
  sessions,
  onRevokeSession,
  currentSessionId,
}: SessionsViewProps): React.ReactElement {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Sessions actives
        </h1>
        <p className="text-sm text-muted-foreground">
          Les appareils actuellement connectés à ce restaurant. Révoque une
          session perdue, volée, ou pour un employé qui a quitté l&apos;équipe.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Appareils connectés</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {sessions === undefined ? (
            <LoadingState />
          ) : sessions.length === 0 ? (
            <EmptyState />
          ) : (
            <SessionsTable
              sessions={sessions}
              onRevokeSession={onRevokeSession}
              currentSessionId={currentSessionId}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-views
// ---------------------------------------------------------------------------

function LoadingState(): React.ReactElement {
  return (
    <div className="flex flex-col gap-3 px-6 py-4" aria-busy="true">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

function EmptyState(): React.ReactElement {
  return (
    <div className="px-6 py-10 text-center text-sm text-muted-foreground">
      Aucune session active sur ce restaurant pour le moment.
    </div>
  );
}

function SessionsTable({
  sessions,
  onRevokeSession,
  currentSessionId,
}: {
  sessions: SessionRow[];
  onRevokeSession: (sessionId: Id<"authSessions">) => Promise<void>;
  currentSessionId: Id<"authSessions"> | undefined;
}): React.ReactElement {
  return (
    <div data-slot="sessions-table">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Utilisateur</TableHead>
            <TableHead>Connecté depuis</TableHead>
            <TableHead>Expire</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((row) => (
            <SessionRowView
              key={row.sessionId as unknown as string}
              row={row}
              isCurrent={row.sessionId === currentSessionId}
              onRevokeSession={onRevokeSession}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SessionRowView({
  row,
  isCurrent,
  onRevokeSession,
}: {
  row: SessionRow;
  isCurrent: boolean;
  onRevokeSession: (sessionId: Id<"authSessions">) => Promise<void>;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const identity = row.userName ?? row.userEmail ?? "Utilisateur inconnu";

  async function handleConfirm() {
    setSubmitting(true);
    try {
      await onRevokeSession(row.sessionId);
      setOpen(false);
    } catch {
      // The page-level handler surfaces the toast + re-throws. We swallow
      // here so the dialog stays open + the user can retry.
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">
            {row.userEmail ?? "(email inconnu)"}
          </span>
          {row.userName !== undefined && (
            <span className="text-xs text-muted-foreground">
              {row.userName}
            </span>
          )}
          {isCurrent && (
            <Badge variant="outline" className="mt-1 w-fit">
              Votre session actuelle
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {formatDateTime(row.createdAt)}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {formatDateTime(row.expiresAt)}
      </TableCell>
      <TableCell className="text-right">
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">
              Révoquer
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Révoquer la session ?</AlertDialogTitle>
              <AlertDialogDescription>
                {isCurrent ? (
                  <>
                    Tu vas révoquer <strong>ta propre session actuelle</strong>.
                    Tu seras déconnecté(e) immédiatement et devras te
                    reconnecter.
                  </>
                ) : (
                  <>
                    L&apos;appareil de <strong>{identity}</strong> sera
                    déconnecté immédiatement et devra se reconnecter avec ses
                    identifiants.
                  </>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={submitting}>
                Annuler
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirm}
                disabled={submitting}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                {submitting ? "Révocation…" : "Révoquer la session"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  );
}
