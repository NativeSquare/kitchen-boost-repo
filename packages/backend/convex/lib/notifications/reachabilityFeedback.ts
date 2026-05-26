import { v } from "convex/values";
import {
  type PushEnrollmentPatch,
  type TenantRole,
  markTenantNotificationEventInactive,
  patchCustomerPushEnrollment,
  tenantMutation,
} from "../tenancy";

/**
 * 2.7-E — MAJ joignabilité : le RETOUR du statut de joignabilité vers 2.1 (#16),
 * la source de vérité (ADR 0012, PRD 80 §7, notifications CONTEXT "Push
 * subscription : marqué inactive si endpoint expire (410 Gone)").
 *
 * 2.7 ne POSSÈDE pas la joignabilité — il ne fait QUE l'envoi. Mais c'est lui qui
 * DÉCOUVRE quand un canal meurt : le dispatch (slice C / transport web-push #54)
 * reçoit un `410 Gone` sur un endpoint expiré. Cette slice ferme la boucle en
 * ÉCRIVANT le statut côté 2.1 — 2.7 ne garde AUCUNE copie locale (pas de table
 * `pushSubscriptions` côté 2.7, ADR 0012). La règle d'une phrase : « 2.1 = qui est
 * joignable et par quel id ; 2.7 = on envoie le message ».
 *
 *  - `pushStatusPatchForDeadChannel` — PURE : un canal push mort → le patch
 *    d'enrôlement 2.1 qui le passe `revoked` (le marqueur « inactive endpoint »
 *    côté 2.1). Unit-testable sans ctx ; AUCUN stockage — on calcule le patch 2.1.
 *  - `recordChannelInactive` — `tenantMutation` OPÉRATIONNEL (le dispatch tourne
 *    pour le compte du tenant ; la ligne `notificationEvents` porte `tenantId`) :
 *    sur un 410, écrit `revoked` côté 2.1 via la SEAM PUBLIQUE 2.1
 *    (`patchCustomerPushEnrollment`, qui référence le customer PAR ID et MERGE pour
 *    ne pas écraser les autres canaux, US #16) — JAMAIS en touchant les tables 2.1
 *    directement (ADR 0010) — et marque la ligne d'origine `inactive_endpoint`.
 *
 * La CASCADE bascule alors AUTOMATIQUEMENT sur le canal suivant : le moteur
 * (`channelAvailabilityFrom` / `pickMarketingChannel`) RELIT la joignabilité côté
 * 2.1 (désormais `revoked` ⇒ canal indisponible) à chaque envoi — rien à
 * « basculer » manuellement, la source de vérité 2.1 fait foi (ADR 0012).
 *
 * Isolation (ADR 0010) : `tenantMutation` keyée sur `ctx.tenantId` ; la ligne
 * journal est résolue via la seam tenant-scoped (`markTenantNotificationEventInactive`,
 * NOT_FOUND pour un id absent OU étranger — pas d'oracle cross-tenant) ; identité
 * via `getCurrentActor` (dans le wrapper). Le customer est référencé PAR ID
 * uniquement, aucune coordonnée nominative ne transite (le MOAT, PRD 90 §3).
 *
 * L'opt-out marketing propage déjà la joignabilité vers 2.1 dans la slice D
 * (`unsubscribe` → `marketingOptOutDate` via `patchCustomerConsent`) ; cette slice
 * couvre le pendant push-endpoint (410) du même principe « 2.1 source de vérité ».
 */

/**
 * The push channels a 410 Gone / expired-subscription can kill — the two lock-screen
 * push canaux of the cascade. (Email/SMS have no "endpoint expired" semantics; the
 * silent Wallet update rides the same Wallet enrolment as `wallet_push`.)
 */
export type DeadPushChannel = "web_push" | "wallet_push";

/**
 * PURE — the 2.1 push-enrollment patch that marks a dead push channel `revoked`
 * (the « inactive endpoint » status, ADR 0012). Returns a SINGLE-field patch so the
 * 2.1 seam's MERGE never clobbers the other channels' ids/statuses (US #16). No
 * Convex ctx, no I/O, no local storage — it only computes the 2.1 patch shape.
 */
export function pushStatusPatchForDeadChannel(
  channel: DeadPushChannel,
): PushEnrollmentPatch {
  return channel === "web_push"
    ? { webPushStatus: "revoked" }
    : { walletStatus: "revoked" };
}

/** Emitting the 410 feedback is an operational action (the KB dispatcher / resto). */
const OPERATIONAL_ALLOW: { allow: TenantRole[] } = {
  allow: ["kb_manager", "staff"],
};

/** The push channels accepted as args (mirrors `DeadPushChannel`). */
const deadPushChannel = v.union(
  v.literal("web_push"),
  v.literal("wallet_push"),
);

/**
 * Record that a push channel is dead for a customer (410 Gone on a web-push send,
 * or an expired Wallet enrolment): write `revoked` to the customer's reachability
 * SIDE 2.1 (the source of truth) via 2.1's sanctioned by-id seam, and — when the
 * originating journaled send is known — mark its `notificationEvents` row
 * `inactive_endpoint`. Returns nothing; the cascade re-derives the next channel
 * from 2.1 on its own at the next send. A foreign `eventId` throws NOT_FOUND.
 */
export const recordChannelInactive = tenantMutation(OPERATIONAL_ALLOW)({
  args: {
    customerId: v.id("customers"),
    channel: deadPushChannel,
    /** The journaled send the 410 came from (optional — a 410 may be unattributed). */
    eventId: v.optional(v.id("notificationEvents")),
  },
  handler: async (ctx, args): Promise<void> => {
    // 1. Write the reachability status SIDE 2.1 (#16), referencing the customer BY
    //    ID through 2.1's public seam — never 2.7-local, never raw 2.1 tables.
    //    The seam MERGES, so the other channels stay intact (US #16).
    await patchCustomerPushEnrollment(
      ctx,
      args.customerId,
      pushStatusPatchForDeadChannel(args.channel),
    );

    // 2. Close the loop on the originating send (tenant-scoped, ownership re-checked).
    if (args.eventId !== undefined) {
      await markTenantNotificationEventInactive(
        ctx,
        ctx.tenantId,
        args.eventId,
      );
    }
  },
});
