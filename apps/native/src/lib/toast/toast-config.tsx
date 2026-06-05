import { Text } from "@/components/ui/text";
import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import type { BaseToastProps, ToastConfig } from "react-native-toast-message";
import type { ToastKind } from "./decide-toast";

/**
 * Custom render config for `<Toast />` (KB cuisine action confirmation).
 *
 * Two variants only — `positive` (KB green) and `destructive` (rouge) —
 * matching the closed `ToastKind` set produced by `decideToastVariant`. Body
 * text + icon are passed via the lib's `props` channel so the same render
 * handles both variants without code duplication.
 *
 * Layout :
 *   - top-center, rounded pill, compact ~52 px height
 *   - icon left + label right, both white on the variant color
 *   - max ~80% screen width via mx-auto + px constraints
 */
type ToastProps = BaseToastProps & {
  props: { icon: keyof typeof Ionicons.glyphMap };
};

function VariantToast({
  text1,
  text2,
  variant,
  iconName,
}: {
  text1?: string;
  text2?: string;
  variant: ToastKind;
  iconName: keyof typeof Ionicons.glyphMap;
}) {
  // `bg-primary` / `bg-destructive` are wired by `tailwind.config.ts` to
  // the CSS vars defined in `app/global.css` (KB green = #1B7A3D).
  const containerClass =
    variant === "positive" ? "bg-primary" : "bg-destructive";
  return (
    <View
      // mx-auto keeps the pill centered relative to the screen edges; max-w
      // caps the width so a long label wraps rather than touching the edges.
      // py / px tuned for a compact ~52 px tablet pill.
      className={`mx-auto max-w-[90%] flex-row items-center gap-3 rounded-2xl px-5 py-3 shadow-lg ${containerClass}`}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Ionicons name={iconName} size={20} color="white" />
      <View className="flex-shrink">
        {text1 !== undefined ? (
          <Text className="text-base font-semibold text-white">{text1}</Text>
        ) : null}
        {text2 !== undefined && text2 !== "" ? (
          <Text className="text-xs text-white opacity-90">{text2}</Text>
        ) : null}
      </View>
    </View>
  );
}

export const TOAST_CONFIG: ToastConfig = {
  positive: ({ text1, text2, props }) => {
    const typed = props as ToastProps["props"];
    return (
      <VariantToast
        text1={text1}
        text2={text2}
        variant="positive"
        iconName={typed.icon}
      />
    );
  },
  destructive: ({ text1, text2, props }) => {
    const typed = props as ToastProps["props"];
    return (
      <VariantToast
        text1={text1}
        text2={text2}
        variant="destructive"
        iconName={typed.icon}
      />
    );
  },
};
