// One-time OAuth consent for the success@ mailbox. Prints the refresh token for .env.
// Usage: node scripts/gmail-consent.mjs ~/Downloads/client_secret_XXX.json
import { readFileSync } from "node:fs";
import http from "node:http";
import { exec } from "node:child_process";
import { google } from "googleapis";

const file = process.argv[2];
if (!file) { console.error("usage: node scripts/gmail-consent.mjs <client_secret.json>"); process.exit(1); }
const raw = JSON.parse(readFileSync(file, "utf8"));
const creds = raw.installed ?? raw.web;
if (!creds) { console.error("JSON has no 'installed' client; create a Desktop app client"); process.exit(1); }

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/documents.readonly",
];

const server = http.createServer();
server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  const redirect = `http://127.0.0.1:${port}`;
  const oauth = new google.auth.OAuth2(creds.client_id, creds.client_secret, redirect);
  const url = oauth.generateAuthUrl({
    access_type: "offline", prompt: "consent", scope: SCOPES, login_hint: "success@nrnglobal.ca",
  });
  console.log("\nOpening browser. Sign in as success@nrnglobal.ca and approve.\nIf it does not open, paste this URL:\n\n" + url + "\n");
  exec(`open "${url}"`);

  server.on("request", async (req, res) => {
    const code = new URL(req.url, redirect).searchParams.get("code");
    if (!code) { res.end("No code in callback."); return; }
    try {
      const { tokens } = await oauth.getToken(code);
      res.end("Done. You can close this tab and return to the terminal.");
      console.log("GMAIL_CLIENT_ID=" + creds.client_id);
      console.log("GMAIL_CLIENT_SECRET=" + creds.client_secret);
      console.log("GMAIL_REFRESH_TOKEN=" + tokens.refresh_token);
      if (!tokens.refresh_token) console.error("\nNo refresh token returned. Revoke the app at myaccount.google.com/permissions and rerun.");
      console.log("\nGranted scopes: " + tokens.scope);
    } catch (e) { res.end("Token exchange failed: " + e.message); console.error(e.message); }
    finally { server.close(); }
  });
});
