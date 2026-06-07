import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unused-vars": "off",
      // TODO(post-V1) — react-hooks 6.x flag setState dans useEffect comme
      // erreur par défaut. Cas légitimes restants à refactor :
      //   - components/ui/carousel.tsx + hooks/use-mobile.ts (shadcn stock)
      //   - components/address-first/address-first-form.tsx:201 (init env error)
      //   - components/checkout/checkout-form.tsx:115 (Convex sub flip)
      // Remis en `error` après refactor — ne pas accepter de nouveau cas en
      // attendant (les warnings restent visibles).
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
