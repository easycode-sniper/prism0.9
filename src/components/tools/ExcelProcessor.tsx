"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { CircleAlert, CircleCheck, Download, FileSpreadsheet, Upload } from "lucide-react";
import { useTranslation } from "@/lib/i18n/I18nProvider";
import {
  PROCESSED_HEADER,
  formatPreviewCell,
  processTransactionRows,
  type ProcessedRow,
} from "./excelProcess";

const PREVIEW_ROWS = 20;

/**
 * Excel transaction processor. Upload → the same six clean-up steps as
 * the standalone tool → 20-row preview → download. Parsing (SheetJS)
 * lives here; the transformation is pure (./excelProcess) so the check
 * script can pin it without a DOM.
 *
 * Nothing is uploaded anywhere: the file is read in the browser and the
 * cleaned workbook is written back in the browser. The page never sends
 * a byte to the server.
 */
export function ExcelProcessor() {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null);
  const [rows, setRows] = useState<ProcessedRow[] | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    setRows(null);
    setError(null);
    if (!file) return;
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setError(t("Please upload a valid .xlsx or .xls file"));
      setFileName(null);
      setFileBuffer(null);
      return;
    }
    setFileName(file.name);
    setFileBuffer(await file.arrayBuffer());
  }

  function process() {
    if (!fileBuffer) return;
    setProcessing(true);
    setError(null);
    // setTimeout so the disabled "processing" state paints before the
    // synchronous parse blocks the main thread on a large sheet.
    setTimeout(() => {
      try {
        const workbook = XLSX.read(fileBuffer, { cellDates: false, raw: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const sheetRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as unknown[][];
        setRows(processTransactionRows(sheetRows));
      } catch (err) {
        setError(`${t("Could not process that file")}: ${(err as Error).message}`);
        setRows(null);
      } finally {
        setProcessing(false);
      }
    }, 30);
  }

  function download() {
    if (!rows || !fileName) return;
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Processed");
    XLSX.writeFile(workbook, fileName.replace(/\.(xlsx|xls)$/i, "_processed.xlsx"));
  }

  const dataRows = rows ? rows.slice(1) : [];

  return (
    <section className="panel" style={{ padding: "18px" }}>
      <label
        htmlFor="tools-excel-input"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "6px",
          padding: "26px 16px",
          borderRadius: "var(--r-lg)",
          border: "1px dashed var(--line)",
          background: "var(--panel-2)",
          cursor: "pointer",
          textAlign: "center",
        }}
      >
        <Upload size={20} aria-hidden="true" style={{ color: "var(--text-dim)" }} />
        <span style={{ fontSize: ".8rem", fontWeight: 600 }}>
          {fileName ?? t("Click to upload an Excel file (.xlsx or .xls)")}
        </span>
        <input
          ref={inputRef}
          id="tools-excel-input"
          type="file"
          accept=".xlsx,.xls"
          style={{ display: "none" }}
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
      </label>

      <div style={{ marginTop: "10px" }}>
        <button
          type="button"
          className="btn-primary"
          disabled={!fileBuffer || processing}
          onClick={process}
          style={{ width: "100%", justifyContent: "center" }}
        >
          {processing ? t("Processing…") : t("Process file")}
        </button>
      </div>

      {error && (
        <p style={{ display: "flex", gap: "6px", fontSize: ".74rem", color: "var(--red)", lineHeight: 1.5, marginTop: "10px", marginBottom: 0 }}>
          <CircleAlert size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: "2px" }} />
          {error}
        </p>
      )}

      {rows && (
        <p style={{ display: "flex", gap: "6px", fontSize: ".74rem", color: "var(--green)", lineHeight: 1.5, marginTop: "10px", marginBottom: 0 }}>
          <CircleCheck size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: "2px" }} />
          {t("Done! {count} transactions processed.").replace("{count}", String(dataRows.length))}
        </p>
      )}

      {rows && (
        <div style={{ marginTop: "12px" }}>
          <span
            className="t-faint"
            style={{ display: "block", fontSize: ".64rem", marginBottom: "6px", textTransform: "uppercase", letterSpacing: ".06em" }}
          >
            {t("Preview · first 20 rows")}
          </span>
          <div className="table-wrap table-wrap--capped">
            <table>
              <thead>
                <tr>
                  {PROCESSED_HEADER.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows.slice(0, PREVIEW_ROWS).map((row, i) => (
                  // Row order IS the data (sorted oldest → newest); the
                  // index is stable for this render.
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} style={{ whiteSpace: "nowrap" }}>{formatPreviewCell(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {dataRows.length > PREVIEW_ROWS && (
            <p className="table-foot-note" style={{ textAlign: "center" }}>
              {t("Showing {shown} of {total} transactions")
                .replace("{shown}", String(PREVIEW_ROWS))
                .replace("{total}", String(dataRows.length))}
            </p>
          )}
          <div style={{ marginTop: "10px" }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={download}
              style={{ width: "100%", justifyContent: "center", borderColor: "var(--green)", color: "var(--green)" }}
            >
              <Download size={14} aria-hidden="true" />
              {t("Download processed file")}
            </button>
          </div>
        </div>
      )}

      <div className="panel-2" style={{ marginTop: "14px", borderRadius: "var(--r-lg)", padding: "14px" }}>
        <span
          className="t-faint"
          style={{ display: "block", fontSize: ".64rem", marginBottom: "8px", textTransform: "uppercase", letterSpacing: ".06em" }}
        >
          {t("Processing steps")}
        </span>
        <ol style={{ margin: 0, paddingLeft: "18px", display: "grid", gap: "4px", fontSize: ".74rem" }}>
          <li>{t("Removes the header row")}</li>
          <li>{t("Drops columns C, D, F, J, K — keeps A, B, E, G, H, I")}</li>
          <li>{t("Moves Date Transaction to column A")}</li>
          <li>{t("Puts N° Carte in column B, ahead of N° Transaction")}</li>
          <li>{t("Sorts oldest → newest on the transaction date")}</li>
          <li>{t("Appends the internal vehicle id from the card mapping")}</li>
        </ol>
        <p className="t-faint" style={{ fontSize: ".7rem", marginTop: "10px", marginBottom: 0 }}>
          {t("Final columns:")} <FileSpreadsheet size={12} aria-hidden="true" style={{ verticalAlign: "-2px" }} />{" "}
          {PROCESSED_HEADER.join(" · ")}
        </p>
      </div>
    </section>
  );
}
