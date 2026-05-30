/**
 * F-QR.2 — `QrPdfDocument` : composant `@react-pdf/renderer` qui rend les
 * 3 formats imprimables V1 du QR code restaurateur (PRD §4.7).
 *
 * Pourquoi ce composant existe
 * ----------------------------
 * Le PRD KB Admin §4.7 acte que la génération QR + PDF est **100 % front**,
 * zéro dépendance backend : la PWA URL existe déjà (`qr.pwaUrl` retourné par
 * `provisionTenant`), le QR est un `data:image/png;base64,...` produit par
 * `generateQrDataUrl` (#167), et le PDF imprimable est calculé dans le
 * navigateur via `@react-pdf/renderer` (déjà au stack admin).
 *
 * Ce composant est le 2e tracer-bullet de la chaîne F-QR (après #167 = deps
 * + helpers purs). Il prend en entrée :
 *   - `pwaUrl`       — URL en clair affichée en fallback texte (A6/A4).
 *   - `qrDataUrl`    — pré-généré par le caller (séparation des concerns).
 *   - `restoName`    — nom du resto pour personnaliser l'accroche.
 *   - `logoUrl?`     — logo tenant ; rendu si fourni (A6/A4), ignoré sur
 *                       sticker (trop petit).
 *   - `primaryColor?`— couleur de marque ; utilisée en accents (bandeau A4,
 *                       trait/encadré A6). Optionnelle : sans, on retombe
 *                       sur un noir neutre.
 *   - `format`       — `'sticker-50mm' | 'a6-card' | 'a4-poster'`.
 *
 * Le composant est PUR : pas d'I/O, pas d'effet de bord, pas de hook. Il
 * retourne un arbre `<Document>` que le caller passe à `<PDFDownloadLink>` /
 * `<PDFViewer>` / `pdf(...).toBlob()`.
 *
 * Layouts V1 (figés par snapshot dans `QrPdfDocument.test.tsx`)
 * -------------------------------------------------------------
 * - **sticker-50mm** : planche A4 portrait, 12 stickers ronds 50 mm en grille
 *   3 × 4. Pas d'accroche, pas d'URL en clair, pas de logo : un sticker rond
 *   de 50 mm n'a pas assez de surface pour être lisible si on charge plus.
 * - **a6-card** : page A6 portrait (cartonnette à glisser dans le sac). QR
 *   central + URL en clair en pied + accroche « Scannez pour commander direct
 *   chez <restoName> » + logo en haut si fourni + accent couleur (filet).
 * - **a4-poster** : page A4 portrait (affiche caisse / vitrine). QR grand
 *   format + URL en clair + accroche + logo + bandeau coloré en tête.
 *
 * Toutes les tailles sont en points (1 pt = 1/72 inch) car c'est l'unité
 * native de PDF / @react-pdf — pas de surprise d'arrondi liée à la conversion
 * px → mm → pt qu'on aurait avec des chaînes "10mm".
 *
 * Note ESLint : `jsx-a11y/alt-text` est désactivé pour le fichier. Le `<Image>`
 * importé ici vient de `@react-pdf/renderer` et ne représente PAS un `<img>`
 * DOM — c'est une primitive PDF (cf. `@react-pdf/primitives` → `'IMAGE'`) et
 * la prop `alt` n'existe même pas sur son type. Les a11y de l'image
 * imprimée se gèrent côté contenu PDF (texte adjacent = URL en clair +
 * accroche), pas via une prop HTML.
 */
/* eslint-disable jsx-a11y/alt-text */
"use client";

import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

// ---------------------------------------------------------------------------
// Props publiques
// ---------------------------------------------------------------------------
/**
 * Contrat d'entrée du composant. Volontairement étroit : tout ce qui dépasse
 * (taille du QR, marges, fonte) est figé dans le composant — V1 = 3 layouts
 * canoniques, pas de personnalisation fine au niveau caller (cf. PRD §4.7).
 */
export type QrPdfFormat = "sticker-50mm" | "a6-card" | "a4-poster";

export type QrPdfDocumentProps = {
  /** URL publique de la PWA tenant, en clair (fallback texte sur A6/A4). */
  pwaUrl: string;
  /** Data URL PNG du QR (pré-généré via `generateQrDataUrl` de #167). */
  qrDataUrl: string;
  /** Nom commercial du resto, utilisé dans l'accroche A6/A4. */
  restoName: string;
  /** Logo tenant (URL absolue). Rendu sur A6/A4 si fourni, ignoré sticker. */
  logoUrl?: string;
  /** Hex `#RRGGBB`. Accent visuel (bandeau A4, filet A6). Optionnel. */
  primaryColor?: string;
  /** Layout choisi (cf. doc fichier). */
  format: QrPdfFormat;
};

// ---------------------------------------------------------------------------
// Constantes de design
// ---------------------------------------------------------------------------
// Couleur neutre quand le tenant n'a pas (encore) défini de couleur primaire.
// Noir KitchenBoost (#111111) par charte projet (cf. CLAUDE.md > Direction
// artistique).
const DEFAULT_INK = "#111111";

// 50 mm en points (1 mm = 2.834 pt). Le sticker rond est un cercle inscrit
// dans un carré de 50 mm de côté, soit ~141.7 pt.
const STICKER_SIDE_PT = 141.73;

// Marges A4 / A6 en pt (~10 mm). Donne de l'air sans gâcher de surface QR.
const PAGE_MARGIN_PT = 28.35;

// Accroche commerciale V1 figée (PRD §4.7). Le `restoName` est injecté.
// Si on veut un jour personnaliser l'accroche par tenant, on ajoutera une
// prop `accroche?: string` — pas en V1.
function accrocheFor(restoName: string): string {
  return `Scannez pour commander direct chez ${restoName}`;
}

// ---------------------------------------------------------------------------
// Styles (séparés par layout pour rester lisible)
// ---------------------------------------------------------------------------
const stickerStyles = StyleSheet.create({
  page: {
    paddingTop: PAGE_MARGIN_PT,
    paddingBottom: PAGE_MARGIN_PT,
    paddingLeft: PAGE_MARGIN_PT,
    paddingRight: PAGE_MARGIN_PT,
    backgroundColor: "#FFFFFF",
  },
  grid: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-around",
    alignContent: "flex-start",
  },
  cell: {
    width: STICKER_SIDE_PT,
    height: STICKER_SIDE_PT,
    marginBottom: 14,
    // Bord rond pour visualiser le contour de découpe (50 mm = 141.73 pt,
    // borderRadius égal à la moitié = cercle parfait). L'impression utilise
    // ce contour comme guide de découpe sticker.
    borderRadius: STICKER_SIDE_PT / 2,
    borderWidth: 0.5,
    borderColor: "#CCCCCC",
    borderStyle: "dashed",
    padding: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  qr: {
    width: STICKER_SIDE_PT - 24,
    height: STICKER_SIDE_PT - 24,
  },
});

const a6Styles = StyleSheet.create({
  page: {
    paddingTop: PAGE_MARGIN_PT,
    paddingBottom: PAGE_MARGIN_PT,
    paddingLeft: PAGE_MARGIN_PT,
    paddingRight: PAGE_MARGIN_PT,
    backgroundColor: "#FFFFFF",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  accentBar: {
    width: "100%",
    height: 4,
    marginBottom: 12,
  },
  logo: {
    height: 36,
    marginBottom: 8,
  },
  accroche: {
    fontSize: 12,
    textAlign: "center",
    marginBottom: 12,
    fontWeight: 700,
  },
  qr: {
    width: 180,
    height: 180,
    marginBottom: 12,
  },
  url: {
    fontSize: 9,
    textAlign: "center",
  },
});

const a4Styles = StyleSheet.create({
  page: {
    paddingTop: 0,
    paddingBottom: PAGE_MARGIN_PT * 2,
    paddingLeft: PAGE_MARGIN_PT * 2,
    paddingRight: PAGE_MARGIN_PT * 2,
    backgroundColor: "#FFFFFF",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  bandeau: {
    width: "100%",
    height: 80,
    marginBottom: 24,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  logo: {
    height: 56,
    marginBottom: 16,
  },
  accroche: {
    fontSize: 24,
    textAlign: "center",
    marginBottom: 24,
    fontWeight: 700,
  },
  qr: {
    width: 360,
    height: 360,
    marginBottom: 24,
  },
  url: {
    fontSize: 14,
    textAlign: "center",
  },
});

// ---------------------------------------------------------------------------
// Layouts (un par format — gardés simples & inlinés pour rester lisibles)
// ---------------------------------------------------------------------------
function StickerSheet(props: Required<Pick<QrPdfDocumentProps, "qrDataUrl">>) {
  // 12 cellules identiques, grille 3×4 sur une page A4 portrait.
  const cells = Array.from({ length: 12 }, (_, i) => (
    <View key={i} style={stickerStyles.cell}>
      <Image src={props.qrDataUrl} style={stickerStyles.qr} />
    </View>
  ));
  return (
    <Page size="A4" orientation="portrait" style={stickerStyles.page}>
      <View style={stickerStyles.grid}>{cells}</View>
    </Page>
  );
}

function A6Card(props: QrPdfDocumentProps) {
  const accentColor = props.primaryColor ?? DEFAULT_INK;
  return (
    <Page size="A6" orientation="portrait" style={a6Styles.page}>
      <View style={[a6Styles.accentBar, { backgroundColor: accentColor }]} />
      {props.logoUrl ? (
        <Image src={props.logoUrl} style={a6Styles.logo} />
      ) : null}
      <Text style={[a6Styles.accroche, { color: accentColor }]}>
        {accrocheFor(props.restoName)}
      </Text>
      <Image src={props.qrDataUrl} style={a6Styles.qr} />
      <Text style={a6Styles.url}>{props.pwaUrl}</Text>
    </Page>
  );
}

function A4Poster(props: QrPdfDocumentProps) {
  const accentColor = props.primaryColor ?? DEFAULT_INK;
  return (
    <Page size="A4" orientation="portrait" style={a4Styles.page}>
      <View style={[a4Styles.bandeau, { backgroundColor: accentColor }]}>
        {props.logoUrl ? (
          <Image src={props.logoUrl} style={a4Styles.logo} />
        ) : null}
      </View>
      <Text style={[a4Styles.accroche, { color: accentColor }]}>
        {accrocheFor(props.restoName)}
      </Text>
      <Image src={props.qrDataUrl} style={a4Styles.qr} />
      <Text style={a4Styles.url}>{props.pwaUrl}</Text>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Composant racine — switch sur `format`
// ---------------------------------------------------------------------------
/**
 * Document PDF imprimable pour le QR code d'un restaurateur. Voir la doc en
 * tête de fichier pour le contrat complet et les 3 layouts V1.
 */
export function QrPdfDocument(props: QrPdfDocumentProps) {
  return (
    <Document
      title={`QR ${props.restoName} (${props.format})`}
      author="KitchenBoost"
      creator="KitchenBoost Admin"
      producer="KitchenBoost Admin"
    >
      {props.format === "sticker-50mm" ? (
        <StickerSheet qrDataUrl={props.qrDataUrl} />
      ) : props.format === "a6-card" ? (
        <A6Card {...props} />
      ) : (
        <A4Poster {...props} />
      )}
    </Document>
  );
}
