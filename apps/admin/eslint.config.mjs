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
      // erreur par défaut. 4 cas restants à refactor (cf. PR sup pour suivi).
      // Remis en `error` après refactor — les warnings restent visibles.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
