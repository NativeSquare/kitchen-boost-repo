/**
 * F-SUPPORT/1 (#210) — `SupportContent` : the shared support surface
 * mounted by both V1 support routes (admin supervision + tenant
 * operational). Tracer-bullet of the F-SUPPORT épique (#150).
 *
 * Pure-presentational, 100 % static — no Convex query, no analytics, no
 * router dependency. The caller picks where to mount it (PRD §4.11 +
 * ADR 0014 §1).
 *
 * Layout :
 *   - CSM bandeau pleine largeur en haut : avatar (photo ou initiales) +
 *     nom + email cliquable + téléphone cliquable (si présent) + créneaux.
 *   - Grid de cards ressources sous le bandeau : 1 col mobile / 2 cols
 *     desktop, lien externe (`target="_blank"`, `rel="noopener noreferrer"`)
 *     + icône `ExternalLink` aria-hidden.
 *
 * Accessibilité :
 *   - `alt` significatif sur la photo CSM (nom de la personne).
 *   - Liens externes annoncés au lecteur d'écran via `<span class="sr-only">
 *     (ouvre dans un nouvel onglet)</span>` accolé au titre de la carte.
 *   - Icônes `ExternalLink` marquées `aria-hidden` (purement décoratives).
 */
import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import type {
  SupportConfig,
  SupportCsm,
  SupportResource,
} from "./support.config";

export type SupportContentProps = SupportConfig;

/**
 * Surface support partagée. Reçoit le contenu intégralement par props pour
 * rester découplée de la config (testable, réutilisable sur les deux routes).
 */
export function SupportContent({
  csm,
  resources,
}: SupportContentProps): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <CsmBanner csm={csm} />
      <ResourceGrid resources={resources} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CSM bandeau
// ---------------------------------------------------------------------------
function CsmBanner({ csm }: { csm: SupportCsm }): ReactNode {
  const initials = getInitials(csm.name);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-4">
        <Avatar className="size-16">
          {csm.photoUrl !== undefined ? (
            <AvatarImage src={csm.photoUrl} alt={`Photo de ${csm.name}`} />
          ) : null}
          <AvatarFallback className="text-base font-semibold">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col gap-1">
          <CardTitle>{csm.name}</CardTitle>
          <CardDescription>Votre interlocuteur KitchenBoost</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <div>
          <a
            href={`mailto:${csm.email}`}
            className="text-primary underline-offset-4 hover:underline"
          >
            {csm.email}
          </a>
        </div>
        {csm.phone !== undefined ? (
          <div>
            <a
              href={`tel:${csm.phone}`}
              className="text-primary underline-offset-4 hover:underline"
            >
              {csm.phone}
            </a>
          </div>
        ) : null}
        <div className="text-muted-foreground">{csm.availability}</div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Grid de ressources
// ---------------------------------------------------------------------------
function ResourceGrid({
  resources,
}: {
  resources: ReadonlyArray<SupportResource>;
}): ReactNode {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {resources.map((resource) => (
        <ResourceCard key={resource.url} resource={resource} />
      ))}
    </div>
  );
}

function ResourceCard({ resource }: { resource: SupportResource }): ReactNode {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <a
            href={resource.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {resource.title}
            <span className="sr-only"> (ouvre dans un nouvel onglet)</span>
          </a>
          <ExternalLink aria-hidden className="size-4 text-muted-foreground" />
        </CardTitle>
        {resource.description !== undefined ? (
          <CardDescription>{resource.description}</CardDescription>
        ) : null}
      </CardHeader>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * "Alex Michelet" → "AM" ; "Alex" → "A" ; "  " → "?".
 * Garde au plus 2 lettres pour respecter le gabarit avatar.
 */
function getInitials(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  const first = parts[0].charAt(0).toUpperCase();
  const last = parts[parts.length - 1].charAt(0).toUpperCase();
  return `${first}${last}`;
}
