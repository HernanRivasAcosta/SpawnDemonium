import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(js.configs.recommended, tseslint.configs.recommended, {
  files: ["js/**/*.ts"],
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    globals: { ...globals.browser },
  },
  rules: {
    // Parameters and variables prefixed with _ are intentionally unused
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      },
    ],
    // Stub private fields (not yet wired up) should not block the build
    "no-unused-private-class-members": "warn",
  },
});
