import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable } from "react-native";
import {
  type RevealableFieldState,
  decideTapAction,
  revealableFieldReducer,
} from "./decide-revealable-field";

/**
 * #401 + extension dénormalisation téléphone — tap-to-reveal field for PII the
 * cuisinier needs ONLY when actively handling the order (adresse livraison,
 * téléphone client). PRD 20 §4 + AC9 + ADR 0010 (MOAT preserved — l'info reste
 * cachée par défaut, le manager ne « scanne » pas la liste des clients).
 *
 * Behaviour (cf. `decide-revealable-field.ts` truth table) :
 *
 *  - hidden : « Toucher pour afficher » + œil ouvert. Tap → revealed.
 *  - revealed + no `onPress` : value visible, second tap is a no-op (adresse).
 *  - revealed + `onPress` wired : value visible + chevron call-out, second
 *    tap fires `onPress` (téléphone → `Linking.openURL("tel:" + phone)`).
 *
 * No reverse edge (no « masquer » CTA) : once revealed the value stays
 * visible until the screen unmounts. Matches the historical `addressRevealed`
 * flag the detail screen carried inline before this refactor.
 *
 * Wrapped in a `<Card>` so the call sites stay symmetrical with the existing
 * « Adresse livraison » card the detail screen used to inline — the refactor
 * is a strict layout-preserving extract.
 */
export type RevealableFieldProps = {
  /** Visible label of the card (« Adresse livraison », « Téléphone client »). */
  label: string;
  /** The PII to reveal. */
  value: string;
  /** Lead icon shown next to « Toucher pour afficher » when hidden. */
  icon: keyof typeof Ionicons.glyphMap;
  /**
   * Optional action fired on the SECOND tap (after reveal). For the phone
   * field, the caller wires `() => Linking.openURL("tel:" + value)`. For the
   * address field, no `onPress` is wired — second tap is a no-op (PRD 20 Q4.2).
   */
  onPress?: () => void;
  /**
   * Optional FR label for the revealed-state action (announced to a11y, also
   * used to render a discrete call-to-action under the value). Required iff
   * `onPress` is wired; ignored otherwise.
   */
  actionLabel?: string;
  /**
   * Optional Ionicon to render next to `actionLabel` when revealed + action
   * wired (e.g. `"call-outline"` for the phone field).
   */
  actionIcon?: keyof typeof Ionicons.glyphMap;
  /**
   * Optional testID forwarded to the card so e2e/unit suites can target a
   * specific instance (e.g. `"revealable-phone"` vs `"revealable-address"`).
   */
  testID?: string;
};

export function RevealableField({
  label,
  value,
  icon,
  onPress,
  actionLabel,
  actionIcon,
  testID,
}: RevealableFieldProps): React.ReactElement {
  const [state, setState] = useState<RevealableFieldState>("hidden");
  const hasAction = onPress !== undefined;

  const handleTap = () => {
    const next = decideTapAction(state, hasAction);
    if (next === "reveal") {
      setState((s) => revealableFieldReducer(s, { type: "tap" }));
      return;
    }
    if (next === "fire-action" && onPress !== undefined) {
      onPress();
    }
    // "none" → no-op (revealed + no action wired, e.g. adresse).
  };

  return (
    <Card className="mb-3" testID={testID}>
      <CardHeader>
        <Text className="text-foreground text-base font-semibold">{label}</Text>
      </CardHeader>
      <CardContent>
        {state === "revealed" ? (
          <Pressable
            accessibilityRole={hasAction ? "button" : "text"}
            accessibilityLabel={
              hasAction && actionLabel !== undefined
                ? actionLabel
                : `${label} affiché`
            }
            onPress={handleTap}
            disabled={!hasAction}
          >
            <Text className="text-foreground text-sm">{value}</Text>
            {hasAction && actionLabel !== undefined ? (
              <Text className="text-muted-foreground mt-1 flex-row items-center text-xs">
                {actionIcon !== undefined ? (
                  <Ionicons
                    name={actionIcon}
                    size={12}
                    className="text-muted-foreground"
                  />
                ) : null}
                {"  "}
                {actionLabel}
              </Text>
            ) : null}
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Afficher : ${label}`}
            onPress={handleTap}
            className="flex-row items-center gap-2"
          >
            <Ionicons name={icon} size={16} className="text-muted-foreground" />
            <Text className="text-muted-foreground text-sm underline">
              Toucher pour afficher
            </Text>
          </Pressable>
        )}
      </CardContent>
    </Card>
  );
}
