/**
 * PWA-S2 (#450) — `sw` module API.
 *
 * The hand-written service worker (`public/sw.js`) mirrors the algorithm of
 * these two pure decisions. Re-exported here so any future RSC / route that
 * needs to predict the SW behavior (e.g. a TS handler that builds the same
 * showNotification args server-side for a PUSH preview) shares one source
 * of truth.
 */
export {
  decideNotificationClickAction,
  deriveNotificationOptions,
  type NotificationClickAction,
  type NotificationClickInput,
  type OpenClientHandle,
  type PushPayload,
  type ShowNotificationArgs,
} from "./decide-sw-handlers";
