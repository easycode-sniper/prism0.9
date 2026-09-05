"use client";

import { useState } from "react";
import { saveServiceBaseline, type ServiceBaseline } from "@/lib/supabase/serviceBaselines";
import { useTranslation } from "@/lib/i18n/I18nProvider";

/**
 * The service-baseline editor, as a row that opens under its truck.
 *
 * IT IS A ROW AND NOT A COLUMN ON PURPOSE, and the reason is arithmetic
 * rather than taste. The fleet table is table-layout:fixed inside one
 * half of a 1fr/1fr grid, so its width is (viewport - 64) / 2, and five
 * of its six columns are fixed at 514px total — the widths a previous
 * session measured against worst-case French data after truck ids
 * started truncating at 1366. Driver absorbs the remainder, which is
 * 78px at 1280. Measured: adding a 76px column takes Driver to 0px at
 * 1280 and 43px at 1366 — the same collapse that pass was fixing. A row
 * spanning every column costs no width at all, and gives the four fields
 * more room than a column ever could.
 */
export default function ServiceBaselineRow({
  truckId,
  baseline,
  colSpan,
  onSaved,
}: {
  truckId: string;
  baseline: ServiceBaseline | undefined;
  colSpan: number;
  onSaved: (next: ServiceBaseline) => void;
}) {
  const { t } = useTranslation();
  const [oilOn, setOilOn] = useState(baseline?.oilChangedOn ?? "");
  const [oilKm, setOilKm] = useState(baseline?.oilChangedKm != null ? String(baseline.oilChangedKm) : "");
  const [tyreOn, setTyreOn] = useState(baseline?.tyresFittedOn ?? "");
  const [tyreKm, setTyreKm] = useState(baseline?.tyresFittedKm != null ? String(baseline.tyresFittedKm) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // An empty box means "still unknown", which is a real and common answer
  // here — not zero. Number("") is 0, so it has to be caught before the
  // cast or every blank field would claim the truck was serviced at 0 km.
  const num = (v: string): number | null => {
    const trimmed = v.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  };

  async function handleSave() {
    setSaving(true);
    setError(null);
    const { data, error: saveError } = await saveServiceBaseline(truckId, {
      oilChangedOn: oilOn || null,
      oilChangedKm: num(oilKm),
      tyresFittedOn: tyreOn || null,
      tyresFittedKm: num(tyreKm),
    });
    setSaving(false);
    if (saveError) {
      setError(saveError);
      return;
    }
    if (data) {
      onSaved(data);
      setSaved(true);
    }
  }

  return (
    <tr className="sbl-row">
      <td colSpan={colSpan} className="sbl-cell">
        <div className="sbl-grid">
          <fieldset className="sbl-set" disabled={saving}>
            <legend className="sbl-legend">{t("Last oil change")}</legend>
            <div className="sbl-pair">
              <label className="sbl-field">
                <span className="sbl-label">{t("Date")}</span>
                <input type="date" className="sbl-input" value={oilOn}
                       onChange={(e) => { setOilOn(e.target.value); setSaved(false); }} />
              </label>
              <label className="sbl-field">
                <span className="sbl-label">{t("Odometer (km)")}</span>
                <input type="number" inputMode="numeric" min="0" className="sbl-input" value={oilKm}
                       placeholder={t("unknown")}
                       onChange={(e) => { setOilKm(e.target.value); setSaved(false); }} />
              </label>
            </div>
          </fieldset>

          <fieldset className="sbl-set" disabled={saving}>
            <legend className="sbl-legend">{t("Current tyres fitted")}</legend>
            <div className="sbl-pair">
              <label className="sbl-field">
                <span className="sbl-label">{t("Date")}</span>
                <input type="date" className="sbl-input" value={tyreOn}
                       onChange={(e) => { setTyreOn(e.target.value); setSaved(false); }} />
              </label>
              <label className="sbl-field">
                <span className="sbl-label">{t("Odometer (km)")}</span>
                <input type="number" inputMode="numeric" min="0" className="sbl-input" value={tyreKm}
                       placeholder={t("unknown")}
                       onChange={(e) => { setTyreKm(e.target.value); setSaved(false); }} />
              </label>
            </div>
          </fieldset>

          <div className="sbl-actions">
            <button type="button" className="btn-sm" onClick={handleSave} disabled={saving}>
              {saving ? t("Saving…") : t("Save")}
            </button>
            {/* Live region: focus never moves on save, so without this a
                screen-reader user is told nothing either way. */}
            <div role="status" aria-live="polite" className="sbl-status">
              <SaveState saved={saved} error={error} t={t} />
            </div>
          </div>
        </div>

        <p className="sbl-hint">{t("Leave a field blank if it is still unknown — half an answer is worth saving.")}</p>
      </td>
    </tr>
  );
}

/* A component rather than a chain of && inside the row: a bare
   conditional text node beside its siblings is what broke every page for
   the French Chrome user in September, and this sits in a live region
   that re-renders on every save. */
function SaveState({ saved, error, t }: { saved: boolean; error: string | null; t: (k: string) => string }) {
  if (error) return <span className="sbl-error">{t(error)}</span>;
  if (saved) return <span className="sbl-ok">{t("Saved")}</span>;
  return null;
}
