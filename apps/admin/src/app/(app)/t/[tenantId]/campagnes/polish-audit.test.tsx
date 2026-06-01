/**
 * F-CAMPAGNES [7/7] (#247) — Polish audit.
 *
 * Cette story est un passage de polish (« palette KB, responsive, cohérence
 * shell, supervision ») sur les surfaces déjà construites par les slices
 * [1/7] → [6/7]. L'enjeu n'est PAS un nouveau parcours fonctionnel — c'est
 * de figer les invariants visuels et garde-fous transverses pour que :
 *
 *   1. la palette KitchenBoost (`#1B7A3D` vert foncé pour le CTA primaire,
 *      `#E5A100` jaune/or pour les accents — CLAUDE.md DA) reste appliquée
 *      partout où elle l'est aujourd'hui ;
 *   2. les surfaces restent responsive (grid `grid-cols-1 sm:grid-cols-2
 *      lg:grid-cols-3` côté picker + stats ; form qui s'empile verticalement) ;
 *   3. les en-têtes restent alignés (`text-2xl font-bold`) sur la cohérence du
 *      reste du KB Admin (cf. `/t/[tenantId]/qr/page.tsx`,
 *      `/t/[tenantId]/commandes/page.tsx`) ;
 *   4. aucun éditeur libre / WYSIWYG / textarea n'est introduit (ADR 0006 —
 *      le set de templates KitchenBoost est strictement fermé : V1 closed
 *      template set, validation backend `templateBounds.ts`) ;
 *   5. aucune coordonnée brute / destinataire nominatif n'est exposé à un
 *      `kb_manager` (MOAT, ADR 0010 + PRD 90 §3-§5) — uniquement les agrégats
 *      retournés par `sendTenantCampaign` / `listTenantCampaignLaunches`.
 *
 * Pourquoi un fichier d'audit séparé plutôt que d'enrichir chaque test
 * existant : ces invariants traversent plusieurs composants (picker, card,
 * preview, dialog, stats, history list), un seul fichier les nomme comme un
 * groupe de polish et un seul test échoue (loud) si l'un d'entre eux régresse.
 *
 * Cette suite lit les fichiers source en BRUT (Node `fs`) plutôt qu'en rendant
 * un arbre React : elle vérifie qu'un className spécifique reste présent dans
 * le code, indépendamment de l'état runtime (le code source est la source de
 * vérité du polish — un test runtime aurait à monter chaque branche pour
 * vérifier la palette d'un bouton qui n'apparaît que dans une seule branche).
 *
 * Scope (#247 hard constraint) : fichier sous
 * `apps/admin/src/app/(app)/t/[tenantId]/campagnes/`. Aucun touch à
 * `apps/web`, `apps/native`, `packages/backend/convex/`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Helpers — list every .tsx/.ts file under the campagnes/ folder (excluding
// tests themselves, generated artifacts, and the audit file).
// ---------------------------------------------------------------------------
const CAMPAGNES_ROOT = __dirname;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Source files under campagnes/, excluding test files + this audit file. */
function sourceFiles(): Array<{ path: string; content: string }> {
  return walk(CAMPAGNES_ROOT)
    .filter((p) => !p.endsWith(".test.ts") && !p.endsWith(".test.tsx"))
    .filter((p) => !p.endsWith("polish-audit.test.tsx"))
    .map((p) => ({ path: p, content: readFileSync(p, "utf-8") }));
}

// ---------------------------------------------------------------------------
// 1. Palette KB — pinned where the slices already apply it.
// ---------------------------------------------------------------------------
describe("F-CAMPAGNES [7/7] #247 — Palette KB (#1B7A3D vert + #E5A100 jaune/or)", () => {
  it("le bouton « Envoyer maintenant » utilise le vert KB primaire (CTA principal)", () => {
    const preview = readFileSync(
      join(
        CAMPAGNES_ROOT,
        "[templateId]",
        "_components",
        "CampaignPreview.tsx",
      ),
      "utf-8",
    );
    // CTA primaire de toute la slice — DOIT rester vert foncé KB.
    expect(preview).toMatch(/bg-\[#1B7A3D\]/);
  });

  it("le bouton « Compris » du dialog d'anomalie utilise le vert KB primaire", () => {
    const dialog = readFileSync(
      join(
        CAMPAGNES_ROOT,
        "[templateId]",
        "_components",
        "CampaignAnomalyDialog.tsx",
      ),
      "utf-8",
    );
    expect(dialog).toMatch(/bg-\[#1B7A3D\]/);
  });

  it("le badge canal « Push » du picker utilise le vert KB", () => {
    const card = readFileSync(
      join(CAMPAGNES_ROOT, "_components", "TemplateCard.tsx"),
      "utf-8",
    );
    // Push badge — channel marker vert.
    expect(card).toMatch(
      /data-slot="template-card-channel-push"[^>]*bg-\[#1B7A3D\]/s,
    );
  });

  it("le badge canal « E-mail » du picker utilise le jaune/or KB", () => {
    const card = readFileSync(
      join(CAMPAGNES_ROOT, "_components", "TemplateCard.tsx"),
      "utf-8",
    );
    expect(card).toMatch(
      /data-slot="template-card-channel-email"[^>]*bg-\[#E5A100\]/s,
    );
  });

  it("les liens « Historique » / « Retour » utilisent le vert KB", () => {
    const view = readFileSync(
      join(CAMPAGNES_ROOT, "campagnes-view.tsx"),
      "utf-8",
    );
    expect(view).toMatch(/text-\[#1B7A3D\]/);
  });

  it("le slider de discount utilise l'accent vert KB", () => {
    const form = readFileSync(
      join(CAMPAGNES_ROOT, "[templateId]", "_components", "VariablesForm.tsx"),
      "utf-8",
    );
    expect(form).toMatch(/accent-\[#1B7A3D\]/);
  });
});

// ---------------------------------------------------------------------------
// 2. Responsive grids — pinned where they live.
// ---------------------------------------------------------------------------
describe("F-CAMPAGNES [7/7] #247 — Responsive (grid mobile → desktop)", () => {
  it("le picker des templates passe en 1 colonne mobile, 2 tablet, 3 desktop", () => {
    const picker = readFileSync(
      join(CAMPAGNES_ROOT, "_components", "TemplatePicker.tsx"),
      "utf-8",
    );
    // Deux occurrences attendues : la grille loading + la grille populated.
    const matches = picker.match(
      /grid-cols-1[^\"]*sm:grid-cols-2[^\"]*lg:grid-cols-3/g,
    );
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("la grille des 6 stats (CampaignResultStats) reste responsive 1/2/3", () => {
    const stats = readFileSync(
      join(
        CAMPAGNES_ROOT,
        "[templateId]",
        "_components",
        "CampaignResultStats.tsx",
      ),
      "utf-8",
    );
    expect(stats).toMatch(
      /grid-cols-1[^\"]*sm:grid-cols-2[^\"]*lg:grid-cols-3/,
    );
  });

  it("la preview push + email reste responsive 1 colonne mobile, 2 colonnes desktop", () => {
    const preview = readFileSync(
      join(
        CAMPAGNES_ROOT,
        "[templateId]",
        "_components",
        "CampaignPreview.tsx",
      ),
      "utf-8",
    );
    expect(preview).toMatch(/grid-cols-1[^\"]*md:grid-cols-2/);
  });

  it("le form de variables s'empile verticalement (flex-col, pas de grid horizontale)", () => {
    const form = readFileSync(
      join(CAMPAGNES_ROOT, "[templateId]", "_components", "VariablesForm.tsx"),
      "utf-8",
    );
    // La balise `<form>` racine utilise `flex flex-col` — chaque champ
    // (label + input) s'empile, JAMAIS de grid horizontale (pas lisible
    // sur mobile pour des inputs textuels).
    expect(form).toMatch(/<form[^>]*className=\"[^\"]*flex flex-col/);
  });
});

// ---------------------------------------------------------------------------
// 3. Cohérence shell — h1 alignée avec le reste du KB Admin (text-2xl font-bold).
// ---------------------------------------------------------------------------
describe("F-CAMPAGNES [7/7] #247 — Cohérence shell (titres alignés KB Admin)", () => {
  it("le titre « Campagnes » utilise le pattern h1 standard text-2xl font-bold", () => {
    const view = readFileSync(
      join(CAMPAGNES_ROOT, "campagnes-view.tsx"),
      "utf-8",
    );
    expect(view).toMatch(/<h1 className=\"text-2xl font-bold\"/);
  });

  it("le titre du template loaded utilise le pattern h1 standard", () => {
    const view = readFileSync(
      join(CAMPAGNES_ROOT, "[templateId]", "template-view.tsx"),
      "utf-8",
    );
    expect(view).toMatch(/<h1 className=\"text-2xl font-bold\"/);
  });

  it("le titre « Historique des campagnes » utilise le pattern h1 standard", () => {
    const page = readFileSync(
      join(CAMPAGNES_ROOT, "historique", "page.tsx"),
      "utf-8",
    );
    expect(page).toMatch(/<h1 className=\"text-2xl font-bold\"/);
  });

  it("le titre du détail de lancement utilise le pattern h1 standard", () => {
    const view = readFileSync(
      join(
        CAMPAGNES_ROOT,
        "historique",
        "[launchId]",
        "launch-detail-view.tsx",
      ),
      "utf-8",
    );
    // « mt-1 » accepté en plus du pattern standard (le détail surface un
    // back-link au-dessus du titre, donc une marge top pour respirer).
    expect(view).toMatch(/<h1 className=\"[^\"]*text-2xl font-bold/);
  });
});

// ---------------------------------------------------------------------------
// 4. Garde-fou ADR 0006 — aucun éditeur libre / WYSIWYG / textarea.
// ---------------------------------------------------------------------------
describe("F-CAMPAGNES [7/7] #247 — Garde-fou ADR 0006 (templates fermés, pas d'éditeur libre)", () => {
  it("aucun fichier source ne contient de balise <textarea>", () => {
    const offenders = sourceFiles().filter(({ content }) =>
      /<textarea\b/i.test(content),
    );
    expect(offenders.map((o) => o.path)).toEqual([]);
  });

  it("aucun fichier source n'importe un éditeur WYSIWYG (tiptap, lexical, slate, draft, quill, ckeditor, tinymce)", () => {
    const offenders = sourceFiles().filter(({ content }) =>
      /(tiptap|lexical|slate|draft-js|@?quill|ckeditor|tinymce|prosemirror)/i.test(
        content,
      ),
    );
    expect(offenders.map((o) => o.path)).toEqual([]);
  });

  it("aucun fichier source n'utilise contentEditable / dangerouslySetInnerHTML", () => {
    const offenders = sourceFiles().filter(({ content }) =>
      /(contentEditable|dangerouslySetInnerHTML)/.test(content),
    );
    expect(offenders.map((o) => o.path)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. Garde-fou MOAT ADR 0010 — aucune coordonnée brute / destinataire nominatif.
// ---------------------------------------------------------------------------
describe("F-CAMPAGNES [7/7] #247 — Garde-fou MOAT ADR 0010 (aucun destinataire nominatif)", () => {
  it("aucun fichier source ne référence un champ « email » / « phone » / « firstName » / « lastName » d'un destinataire", () => {
    // On cherche des PROPRIÉTÉS d'objet, pas les mentions techniques
    // (« E-mail » comme label de canal, « phone » comme nom de paramètre).
    // Les patterns ciblent les shapes « .email », « .phone » sur un identifiant
    // qui sentirait un destinataire (customer, recipient, client).
    const offenders = sourceFiles().filter(({ content }) =>
      /\b(customer|recipient|client)\.(email|phone|firstName|lastName|fullName)\b/i.test(
        content,
      ),
    );
    expect(offenders.map((o) => o.path)).toEqual([]);
  });

  it("aucun composant ne rend une liste de destinataires (pattern .map sur customers/recipients)", () => {
    const offenders = sourceFiles().filter(({ content }) =>
      /\b(customers|recipients|clients)\s*\.\s*map\s*\(/.test(content),
    );
    expect(offenders.map((o) => o.path)).toEqual([]);
  });

  it("aucun fichier source ne fetch une query « listCustomers » / « listRecipients » côté campagnes", () => {
    const offenders = sourceFiles().filter(({ content }) =>
      /api\.[^\s]*\.(listCustomers|listRecipients|getRecipient|getCustomer)\b/.test(
        content,
      ),
    );
    expect(offenders.map((o) => o.path)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. FR-only — pas de fallback anglais sur les surfaces polishées.
// ---------------------------------------------------------------------------
describe("F-CAMPAGNES [7/7] #247 — FR uniquement (pas de fallback anglais visible)", () => {
  // On lit les fichiers et on cherche des strings JSX (`>Text<`) qui ressemblent
  // à de l'anglais évident. Volontairement restrictif : on ne lex pas la langue,
  // on chasse les mots-typés-anglais les plus courants en copie-coller.
  const FORBIDDEN_EN_TOKENS = [
    /\bLoading\.\.\./,
    /\bNo templates? available\b/i,
    /\bSend now\b/i,
    /\bRetry\b/,
    /\bGot it\b/i,
    /\bRecipients\b/,
    /\bTargeted customers\b/i,
  ];

  /** Strip JS/TS comments — block (`/* … *​/`) and line (`// …`) — so
   *  technical commentary in JSDoc headers (which legitimately describes
   *  branches in English like « no template available for this tenant »)
   *  doesn't trigger the FR-only audit. Only user-visible strings (JSX
   *  text, attribute values, string literals) remain. */
  function stripComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  it("aucun fichier source ne contient de copie anglaise évidente (hors commentaires)", () => {
    const offenders: Array<{ path: string; match: string }> = [];
    for (const { path, content } of sourceFiles()) {
      const code = stripComments(content);
      for (const pattern of FORBIDDEN_EN_TOKENS) {
        const m = code.match(pattern);
        if (m) offenders.push({ path, match: m[0] });
      }
    }
    expect(offenders).toEqual([]);
  });
});
