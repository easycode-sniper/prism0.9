import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

// ESLint 9 reads flat config only, while `eslint-config-next` is still
// published in the old shareable-config shape — FlatCompat bridges the two.
// Until this file existed `npm run lint` exited before linting anything, so
// the script in package.json had never actually run.
//
// Scope note: this catches JS/TS/React correctness. It does *not* catch the
// hardcoded-colour class of bug (a `#e7e7f5` inside a style string is just a
// string to ESLint) — that needs a stylelint pass or a rendering test, and
// neither exists here yet.
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    ignores: [".next/**", "out/**", "build/**", "next-env.d.ts", "supabase/**"],
  },

  ...compat.extends("next/core-web-vitals", "next/typescript"),

  {
    rules: {
      // Pre-existing debt, deliberately a warning rather than an error: the
      // twelve current uses are all untyped external JSON at a boundary
      // (Wialon Remote API responses, Supabase rows). Typing those properly
      // is its own piece of work, and leaving the baseline red would mean
      // nobody runs this command — which is the state it was already in.
      // New violations still surface; they just don't gate the run.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];

export default config;
