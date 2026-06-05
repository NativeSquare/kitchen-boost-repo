import type { Config } from "tailwindcss";
const { hairlineWidth } = require("nativewind/theme");

/**
 * NativeWind v4 + React Native does NOT resolve `hsl(var(--xxx))` at runtime
 * (CSS vars are not a native concept; the parser cannot concatenate `hsl(` +
 * a dynamic var + `)` on Hermes/iOS/Android). Result: classes like
 * `text-foreground`, `bg-primary` rendered as transparent → invisible labels
 * (visible bug on the kiosque toggle screen, #393).
 *
 * Fix: hard-code the resolved HSL light-theme values directly. Dark mode in V1
 * is out of scope (PRD §10 §13). When V2 reintroduces it, switch to the
 * `vars()` runtime API or a ThemeProvider that swaps the config.
 */
const lightColors = {
  border: "hsl(0 0% 89.8%)",
  input: "hsl(0 0% 89.8%)",
  ring: "hsl(0 0% 63%)",
  background: "hsl(0 0% 100%)",
  foreground: "hsl(0 0% 3.9%)",
  primary: {
    DEFAULT: "hsl(0 0% 9%)",
    foreground: "hsl(0 0% 98%)",
  },
  secondary: {
    DEFAULT: "hsl(0 0% 96.1%)",
    foreground: "hsl(0 0% 9%)",
  },
  destructive: {
    DEFAULT: "hsl(0 84.2% 60.2%)",
    foreground: "hsl(0 0% 98%)",
  },
  muted: {
    DEFAULT: "hsl(0 0% 96.1%)",
    foreground: "hsl(0 0% 45.1%)",
  },
  accent: {
    DEFAULT: "hsl(0 0% 96.1%)",
    foreground: "hsl(0 0% 9%)",
  },
  popover: {
    DEFAULT: "hsl(0 0% 100%)",
    foreground: "hsl(0 0% 3.9%)",
  },
  card: {
    DEFAULT: "hsl(0 0% 100%)",
    foreground: "hsl(0 0% 3.9%)",
  },
};

export default {
  content: ["./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: lightColors,
      borderRadius: {
        lg: "0.625rem",
        md: "calc(0.625rem - 2px)",
        sm: "calc(0.625rem - 4px)",
      },
      borderWidth: {
        hairline: hairlineWidth(),
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  future: {
    hoverOnlyWhenSupported: true,
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
