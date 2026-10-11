import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "drizzle/**", "node_modules/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // App code logs through src/logger.ts and reads env through src/config.ts.
    files: ["src/**/*.ts"],
    rules: {
      "no-console": "error",
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "Read environment variables through src/config.ts, which validates them at startup.",
        },
      ],
    },
  },
  {
    files: ["src/config.ts"],
    rules: { "no-restricted-properties": "off" },
  },
  {
    // Tests own their env fixtures (they drive config-dependent code by
    // mutating process.env behind a mocked config).
    files: ["src/**/*.test.ts"],
    rules: { "no-restricted-properties": "off" },
  },
  {
    files: ["src/logger.ts"],
    rules: { "no-console": "off" },
  },
  {
    // Type-aware gate: every promise in a statement position must be awaited,
    // void-ed, or handled with a rejection callback.
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
);
