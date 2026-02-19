// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import effectPlugin from "@effect/eslint-plugin";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  // Global ignores
  {
    ignores: ["dist/", "node_modules/", "**/*.d.ts", "vitest.config.ts"],
  },

  // Base ESLint recommended rules
  eslint.configs.recommended,

  // TypeScript recommended rules with type-checking
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Effect plugin rules
  {
    plugins: {
      "@effect": effectPlugin,
    },
  },

  // Project-specific rule overrides
  {
    rules: {
      // Allow type assertions used extensively for branded types (Chips, SeatIndex)
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      // Allow unused vars prefixed with _
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Allow empty object types in tagged errors (e.g., TableFull, HandInProgress)
      "@typescript-eslint/no-empty-object-type": "off",
      // Allow non-null assertions where array bounds are checked manually
      "@typescript-eslint/no-non-null-assertion": "warn",
    },
  },

  // Prettier — must be last to disable conflicting formatting rules
  prettierConfig,
);
