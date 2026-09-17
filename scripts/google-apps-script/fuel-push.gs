/**
 * Fuel sheet → Prism push trigger.
 *
 * Fires on any change to this spreadsheet (a pasted batch of rows is
 * usually ONE change event; several quick manual rows are several) and
 * asks Prism to run its fuel sync — an idempotent full refresh that
 * reads the sheet as it stands at that moment, so nothing is ever lost
 * by coalescing.
 *
 * SETUP — see the project README under "Real-time fuel sync":
 *   1. Extensions → Apps Script, paste this file.
 *   2. Project Settings → Script Properties, add:
 *        FUEL_SYNC_URL     the deployment's /api/fuel-sync URL
 *        FUEL_SYNC_SECRET  the value of FUEL_SYNC_SECRET in the
 *                          project's .env / Vercel environment
 *   3. Triggers → Add Trigger → onFuelSheetChange,
 *      event source "From spreadsheet", event type "On change".
 *      It must be an installable trigger (this one) — a simple trigger
 *      cannot call UrlFetchApp.
 *
 * Credentials are read from Script Properties, never written here: this
 * file's text is copy-pasted between browsers and revisions, and a
 * secret pasted into code outlives the memory of having pasted it.
 */

// Quick successive edits (typing a row cell by cell) each queue an
// execution. Skipping the ones inside this window keeps the noise down;
// nothing is lost by it — the server coalesces too, and its trailing
// run reads the sheet as it stands when it fires.
var DEBOUNCE_SECONDS = 20;

function onFuelSheetChange(changeEvent) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("FUEL_SYNC_URL");
  var secret = props.getProperty("FUEL_SYNC_SECRET");
  if (!url || !secret) {
    console.error(
      "fuel-push is not configured: set FUEL_SYNC_URL and FUEL_SYNC_SECRET " +
      "in Project Settings → Script Properties, then retry."
    );
    return;
  }

  var cache = CacheService.getScriptCache();
  if (cache.get("lastPush")) return;
  cache.put("lastPush", "1", DEBOUNCE_SECONDS);

  var response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { "x-fuel-sync-secret": secret },
    payload: JSON.stringify({
      trigger: "apps-script",
      changeType: changeEvent && changeEvent.changeType ? changeEvent.changeType : "unknown",
    }),
    muteHttpExceptions: true,
  });

  // The Executions log (clock icon in the Apps Script sidebar) is the
  // only place this can be seen, so it says what happened in words.
  var code = response.getResponseCode();
  var body = response.getContentText();
  if (code === 200) {
    console.log("Prism accepted the push: " + body.slice(0, 200));
  } else {
    console.error("Prism rejected the push (HTTP " + code + "): " + body.slice(0, 200));
  }
}
