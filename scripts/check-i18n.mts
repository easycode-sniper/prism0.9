/**
 * Every string the UI shows must have a French translation.
 *
 *   node --experimental-strip-types scripts/check-i18n.mts
 *
 * WHY THIS EXISTS. translate() falls back — French, then English, then
 * the key itself — so a string nobody translated does not crash, it just
 * silently stays English. That is exactly the bug this project was asked
 * to fix, and it is invisible to anyone reading the diff: the code looks
 * translated because the call is there. Only counting the keys catches it.
 *
 * ARABIC IS DELIBERATELY NOT CHECKED. The owner asked on 2026-09-03 for a
 * complete French UI and for Arabic to be left exactly as it was. Arabic
 * keeps its original chrome-level keys and falls back to English for
 * everything else, which is the pre-existing behaviour, so holding it to
 * the French standard here would report hundreds of failures for a
 * language nobody asked to finish.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { translations, SAME_IN_FRENCH, RUNTIME_KEYS } from "../src/lib/i18n/translations.ts";

const files = execSync("find src -name '*.tsx' -o -name '*.ts'", { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((f) => !f.includes("/i18n/"));

// t("…") and t('…'). Template literals are deliberately NOT matched: a
// key built at runtime cannot be checked here, so the convention is that
// every key is a literal. If you need interpolation, translate the
// surrounding sentence and substitute into the result.
const CALL = /\bt\(\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1\s*[,)]/g;

const used = new Map<string, string[]>();
const sources = new Map<string, string>();
for (const file of files) {
  const src = readFileSync(file, "utf8");
  sources.set(file, src);
  for (const m of src.matchAll(CALL)) {
    const key = m[2].replace(/\\(["'\\])/g, "$1");
    if (!used.has(key)) used.set(key, []);
    used.get(key)!.push(file);
  }
}

// A key can reach t() without being written at the call site: TopbarNav
// keeps `key: "nav.dashboard"` in a data array and passes it through. So
// "is this key still referenced" asks whether the literal appears
// anywhere in the source, not whether it sits inside a t() call.
const referenced = (key: string) => {
  const needle = JSON.stringify(key).slice(1, -1);
  for (const src of sources.values()) {
    if (src.includes(`"${needle}"`) || src.includes(`'${needle}'`)) return true;
  }
  return false;
};

const en = translations.en;
const fr = translations.fr;

const missingFr = [...used.keys()].filter((k) => !fr[k]).sort();
const missingEn = [...used.keys()].filter((k) => !en[k]).sort();
// A key present in French but used nowhere is dead weight that will drift
// out of step with the copy it was written for.
const unused = Object.keys(fr)
  .filter((k) => !used.has(k) && !referenced(k) && !RUNTIME_KEYS.has(k))
  .sort();
// The point of the exercise: French that is merely a copy of the English.
const untranslated = [...used.keys()]
  .filter((k) => fr[k] && en[k] && fr[k] === en[k] && /[A-Za-z]{4}/.test(fr[k]))
  .filter((k) => !SAME_IN_FRENCH.has(k))
  .sort();

console.log(`${used.size} keys used across ${files.length} files`);

if (missingEn.length) {
  console.error(`\n${missingEn.length} key(s) with no English entry:`);
  for (const k of missingEn) console.error(`  ${JSON.stringify(k)}  — ${used.get(k)![0]}`);
}
if (missingFr.length) {
  console.error(`\n${missingFr.length} key(s) with no FRENCH translation:`);
  for (const k of missingFr) console.error(`  ${JSON.stringify(k)}  — ${used.get(k)![0]}`);
}
if (untranslated.length) {
  console.error(`\n${untranslated.length} key(s) whose French is identical to the English:`);
  for (const k of untranslated) console.error(`  ${JSON.stringify(k)}`);
  console.error("  (if the French really is the same word, add it to SAME_IN_FRENCH)");
}
if (unused.length) {
  console.warn(`\n${unused.length} translated key(s) no longer used (safe to delete):`);
  for (const k of unused) console.warn(`  ${JSON.stringify(k)}`);
}

// Unused keys are untidy, not broken, so they warn rather than fail.
if (missingEn.length || missingFr.length || untranslated.length) {
  console.error("\nFAIL — the French UI is incomplete.");
  process.exit(1);
}
console.log("OK — every key used in the UI has a French translation.");
