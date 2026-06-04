import { SettingsScreen } from "@/lib/settings";

/**
 * #418 — Account / Settings tab (PRD 20 §10 « Settings complète »).
 *
 * The tab is the KB Orders Settings home: profile + change password +
 * notifications (DNT / sons / vibration) + compte rattaché (tenant +
 * Stripe + Uber) + imprimante cuisine entry + mode kiosque/téléphone
 * toggle + logout + version + support. The screen itself lives in the
 * `settings` lib module so it can be unit-tested with its own pure
 * decision matrix (cf. `decide-settings.test.ts`).
 */
export default function AccountTab() {
  return <SettingsScreen />;
}
