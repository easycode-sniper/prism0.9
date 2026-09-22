// Checks for the Tools page's pure logic: the fuel estimator math and the
// Excel transaction pipeline (column mapping, date sort, card lookup).
//
// Run: node --experimental-strip-types scripts/check-tools.mts
//
// WHY THIS SCRIPT EXISTS: the processor rewrites the owner's fuel sheet
// input — a column swap or a sort regression silently corrupts money
// data, and tsc cannot see that [8,1,0,4,6,7] means Date first. The
// estimator is simpler, but its rates are the numbers trip budgets come
// from, so the arithmetic gets pinned too.
//
// The pipeline functions live in src/components/tools/excelProcess.ts
// and take already-parsed row matrices, so this runs under node with no
// DOM and no xlsx dependency — parsing stays the component's job.

import {
  PROCESSED_HEADER,
  formatPreviewCell,
  parseTransactionDate,
  processTransactionRows,
} from "../src/components/tools/excelProcess.ts";
import { lookupCard, CARD_MAPPING, CARD_NOT_FOUND } from "../src/components/tools/cardMapping.ts";
import { FUEL_VEHICLES, estimateFuel } from "../src/components/tools/fuelVehicles.ts";

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("estimator:");

{
  const scudo = FUEL_VEHICLES.find((v) => v.id === "scudo")!;
  const est = estimateFuel(scudo, 100, "mixed")!;
  // (100/100) × 8.0 = 8.0 L; 8.0 × 31 = 248 DA.
  check("scudo 100km mixed burns 8.0L for 248 DA", est.litres === 8 && est.costDa === 248, JSON.stringify(est));
}

{
  const hilux = FUEL_VEHICLES.find((v) => v.id === "hilux")!;
  const est = estimateFuel(hilux, 250, "city")!;
  // (250/100) × 11.0 = 27.5 L; 27.5 × 31 = 852.5 DA.
  check("hilux 250km city burns 27.5L for 852.5 DA", est.litres === 27.5 && est.costDa === 852.5, JSON.stringify(est));
}

{
  const duster = FUEL_VEHICLES.find((v) => v.id === "duster")!;
  check("duster runs GPL at 18 DA/L", duster.fuel === "gpl" && duster.pricePerLitre === 18);
}

{
  const logan = FUEL_VEHICLES.find((v) => v.id === "logan")!;
  check("zero distance estimates nothing", estimateFuel(logan, 0, "highway") === null);
  check("negative distance estimates nothing", estimateFuel(logan, -50, "city") === null);
  check("NaN estimates nothing", estimateFuel(logan, Number.NaN, "mixed") === null);
}

console.log("\ncard lookup:");

{
  // A real card from the mapping, with the whitespace and quotes a sheet
  // paste carries — the normaliser must absorb all three.
  const known = lookupCard("  '3220160100289445'  ");
  check("known card resolves id + plate", known?.id === "027" && known?.mat === "00015-523-35", JSON.stringify(known));
  const plateless = lookupCard("3220160100274651");
  check("card without a plate resolves id + empty mat", plateless?.id === "011" && plateless?.mat === "", JSON.stringify(plateless));
  check("unknown card resolves null", lookupCard("3220160199999999") === null);
  check("empty cell resolves null", lookupCard("") === null);
  check("missing cell resolves null", lookupCard(undefined) === null);
  check("CARD_NOT_FOUND sentinel intact", CARD_NOT_FOUND === "not found");
}

console.log("\nmapping integrity:");

{
  const cards = Object.keys(CARD_MAPPING);
  check("every entry has a non-empty vehicle id", cards.every((c) => CARD_MAPPING[c].id !== ""));
  check(
    "spot checks hold (001, 119 generator, plateless 033)",
    CARD_MAPPING["3220160100435142"]?.id === "001" &&
      CARD_MAPPING["3220160100434135"]?.mat === "GROUPE ELECTROGENE" &&
      CARD_MAPPING["3220160100289409"]?.mat === "" &&
      CARD_MAPPING["3220160100496366"]?.id === "002"
  );
  console.log(`  info ${cards.length} cards mapped`);
}

console.log("\ndates:");

{
  const serial = parseTransactionDate(46340);
  check(
    "excel serial 46340 is 2026-11-14",
    serial.getFullYear() === 2026 && serial.getMonth() === 10 && serial.getDate() === 14,
    serial.toISOString()
  );
  const str = parseTransactionDate("05/09/2026 14:30:00");
  check(
    "DD/MM/YYYY string parses day-first",
    str.getFullYear() === 2026 && str.getMonth() === 8 && str.getDate() === 5 && str.getHours() === 14,
    str.toString()
  );
  check("unparseable sorts as the epoch", parseTransactionDate("n/a").getTime() === 0);
}

console.log("\npipeline:");

{
  // Raw sheet shape: A=N°Transaction B=N°Carte C,D dropped E=Station
  // F dropped G=Produit H=Montant I=Date J,K dropped.
  const sheet = [
    ["HEADER", "HEADER", "x", "x", "x", "x", "x", "x", "x", "x", "x"],
    ["TXN-2", "3220160100289445", "c", "d", "Alger", "f", "Diesel", 5000, "05/09/2026 14:30:00", "j", "k"],
    ["TXN-1", "3220160199999999", "c", "d", "Oran", "f", "Essence", 3000, 46340, "j", "k"],
    ["TXN-3", "3220160100289445", "c", "d", "Blida", "f", "Diesel", 2000, "01/09/2026 08:00:00", "j", "k"],
  ];
  const out = processTransactionRows(sheet);

  check("header row is the export header", JSON.stringify(out[0]) === JSON.stringify([...PROCESSED_HEADER]));
  check("header stripped: 3 data rows in, 3 out", out.length === 4, String(out.length));

  // Serial 46340 = 2026-11-14 sorts last; 01/09 before 05/09.
  const order = out.slice(1).map((r) => r[2]);
  check(
    "rows sort oldest → newest across mixed date formats",
    JSON.stringify(order) === JSON.stringify(["TXN-3", "TXN-2", "TXN-1"]),
    JSON.stringify(order)
  );

  const first = out[1];
  check(
    "columns land as Date · Carte · Transaction · Station · Produit · Montant · unique · Matricule",
    first[0] === "01/09/2026 08:00:00" &&
      first[1] === "3220160100289445" &&
      first[2] === "TXN-3" &&
      first[3] === "Blida" &&
      first[4] === "Diesel" &&
      first[5] === 2000 &&
      first[6] === "027" &&
      first[7] === "00015-523-35",
    JSON.stringify(first)
  );

  const unknown = out.find((r) => r[2] === "TXN-1")!;
  check("unmapped card appends 'not found' + empty plate", unknown[6] === "not found" && unknown[7] === "", JSON.stringify(unknown.slice(6)));
}

console.log("\npreview:");

{
  // Local-timezone rendering (same as the original's toLocaleString) —
  // the day can read 13 or 14 west of UTC, so pin shape, month, year.
  check(
    "serial previews as DD/MM/YYYY HH:mm:ss",
    /^(13|14)\/11\/2026 \d{2}:\d{2}:\d{2}$/.test(formatPreviewCell(46340)),
    formatPreviewCell(46340)
  );
  check("strings pass through untouched", formatPreviewCell("05/09/2026 14:30:00") === "05/09/2026 14:30:00");
  check("null previews empty", formatPreviewCell(null) === "");
}

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED.\n`);
  process.exit(1);
}
console.log("\nAll tools checks passed.\n");
