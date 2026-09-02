// Does any "use server" module export something that is not an async
// function?
//
//   node --experimental-strip-types scripts/check-server-actions.mts
//
// A "use server" file may only export async functions. Next wraps every
// export of one as a server-action reference, so a plain object or a
// sync function is not merely disallowed — it breaks at runtime.
//
// WHY THIS SCRIPT EXISTS: `next build` catches it only SOMETIMES. On
// 2026-09-02 the same mistake was made twice in one session with two
// different outcomes:
//
//   lib/supabase/unloaded.ts   exported two consts, a client component
//                              imported them, the boundary check fired,
//                              and the BUILD FAILED loudly. Fixed in
//                              minutes.
//
//   lib/supabase/dashboard.ts  exported one const used only as a default
//                              argument inside its own module. Nothing
//                              crossed a client boundary, so the build
//                              PASSED — and production rendered "An
//                              error occurred in the Server Components
//                              render. The specific message is omitted
//                              in production builds", which is close to
//                              undiagnosable from the screen.
//
// The compiler's check depends on whether anything happens to import the
// bad export across a boundary. That is not a property of the mistake,
// so it is not a check worth relying on. This one looks at the files.
//
// Deliberately a regex over source rather than a parse: the rule is
// about the shape of a line at the top level of a module, the codebase
// writes exports plainly, and a dependency-free script is one that still
// runs in five years.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/** An export that is NOT an async function. Type-only exports are fine —
 *  they are erased before Next ever sees them — so interfaces, types and
 *  `export type { ... }` are excluded. */
const OFFENDERS: { pattern: RegExp; what: string }[] = [
  { pattern: /^export\s+(const|let|var)\s+/, what: "a value" },
  { pattern: /^export\s+class\s+/, what: "a class" },
  { pattern: /^export\s+function\s+/, what: "a SYNC function" },
  { pattern: /^export\s+default\s+(?!async\b)/, what: "a non-async default" },
];

let failures = 0;

for (const file of walk(ROOT)) {
  const source = readFileSync(file, "utf8");
  // The directive has to be the first statement to count.
  if (!/^\s*["']use server["']/.test(source)) continue;

  source.split("\n").forEach((line, i) => {
    for (const { pattern, what } of OFFENDERS) {
      if (!pattern.test(line)) continue;
      failures++;
      console.error(
        `  ${file}:${i + 1} exports ${what} from a "use server" module\n` +
          `    ${line.trim()}`
      );
    }
  });
}

console.log(
  failures === 0
    ? 'check-server-actions: every "use server" module exports only async functions'
    : `check-server-actions: ${failures} invalid export(s) — move them to a plain module`
);
process.exit(failures === 0 ? 0 : 1);
