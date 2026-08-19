// Read-only Google Sheets access via a service account.
//
// No googleapis dependency: the whole exchange is a JWT signed with the
// key Google already gives you, traded for an access token, then one
// plain fetch to the Sheets REST API — the same shape the rest of this
// app talks to Wialon in, and one fewer dependency to keep patched.
//
// Not a "use server" module: every export of one becomes a public HTTP
// endpoint, and this handles a private key that must never leave the
// server, let alone be reachable from the browser.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signedAssertion(clientEmail: string, privateKeyPem: string): Promise<string> {
  const { createSign } = await import("node:crypto");

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    // Google caps this at one hour; the sync only needs the token for
    // one request, so there is no reason to push closer to that limit.
    exp: now + 300,
  };

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = base64url(signer.sign(privateKeyPem));

  return `${unsigned}.${signature}`;
}

async function getAccessToken(): Promise<string> {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  // Vercel stores the value as entered; a private key pasted with real
  // newlines survives, but if it round-tripped through anything that
  // escapes them (\n as two characters) this restores the real thing —
  // the RSA signer rejects a key with literal backslash-n in it.
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    throw new Error("GOOGLE_SHEETS_CLIENT_EMAIL / GOOGLE_SHEETS_PRIVATE_KEY not set");
  }

  const assertion = await signedAssertion(clientEmail, privateKey);

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const data = await resp.json();
  if (!resp.ok || !data.access_token) {
    throw new Error(`Google token exchange failed: ${data.error_description || data.error || resp.status}`);
  }
  return data.access_token as string;
}

/** Raw cell values for a range, one array per row, in sheet order.
 *  Google trims trailing empty cells from a row, so short rows are
 *  normal — callers must index defensively, not assume every row is
 *  the same length as the header. */
export async function fetchSheetRows(spreadsheetId: string, range: string): Promise<string[][]> {
  const token = await getAccessToken();

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;

  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(`Sheets read failed: ${data.error?.message || resp.status}`);
  }
  return (data.values as string[][]) ?? [];
}
