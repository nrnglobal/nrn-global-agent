import crypto from "node:crypto";
import { google } from "googleapis";
import { db, log } from "./db.js";
import { auth } from "./gmail.js";
import { asana, WS } from "./asana_slack.js";

// Clients sheet → agent_clients. The sheet is the source of truth; the agent keeps reading agent_clients.
// Needs spreadsheets.readonly on the Gmail refresh token and the sheet shared with that account.

export type ClientRow = { asana_project_gid: string; client_name: string; domains: string[]; contacts: string[]; default_assignee: string | null; brief_url: string | null; active: boolean };
type AsanaUser = { gid: string; name: string };
type Skipped = { row: number; client_name: string; reason: string };

const REQUIRED = ["client_name", "asana_project_gid", "active"];
const TRUE = ["true", "yes", "y", "1"], FALSE = ["false", "no", "n", "0"];
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const EMAIL = /^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

// Accepts the bare gid or a pasted Asana project URL (old /0/<gid>/ and new /project/<gid>/ forms).
function projectGid(v: string) {
  if (/^\d+$/.test(v)) return v;
  return v.match(/app\.asana\.com\/.*\/project\/(\d+)/)?.[1] ?? v.match(/app\.asana\.com\/0\/(\d+)/)?.[1] ?? null;
}
// Accepts the bare gid, a full Asana name, or a first name when only one user has it.
function assigneeGid(v: string, users: AsanaUser[]) {
  if (/^\d+$/.test(v)) return v;
  const n = v.toLowerCase();
  const hits = users.filter((u) => u.name.toLowerCase() === n || u.name.toLowerCase().split(/\s+/)[0] === n);
  return hits.length === 1 ? hits[0].gid : null;
}
const list = (v: string) => [...new Set(v.toLowerCase().split(/[\s,;]+/).filter(Boolean))];

export function parseClientRows(values: unknown[][], users: AsanaUser[]) {
  const head = (values[0] ?? []).map((h) => String(h ?? "").trim().toLowerCase());
  const missing = REQUIRED.filter((c) => !head.includes(c));
  if (missing.length) throw new Error(`Clients sheet row 1 is missing header(s): ${missing.join(", ")}`);

  const rows: ClientRow[] = [], skipped: Skipped[] = [], warnings: string[] = [];
  const seen = new Set<string>();
  values.slice(1).forEach((r, i) => {
    const cell = (name: string) => (head.includes(name) ? String(r[head.indexOf(name)] ?? "").trim() : "");
    if (!r.some((c) => String(c ?? "").trim())) return;
    const row = i + 2, client_name = cell("client_name");
    const skip = (reason: string) => { skipped.push({ row, client_name, reason }); };

    if (!client_name) return skip("no client_name");
    const active = cell("active").toLowerCase();
    if (!TRUE.includes(active) && !FALSE.includes(active)) return skip(`active must be TRUE or FALSE, got "${cell("active")}"`);
    const asana_project_gid = projectGid(cell("asana_project_gid"));
    if (!asana_project_gid) return skip("no asana_project_gid");
    if (seen.has(asana_project_gid)) return skip(`Asana project ${asana_project_gid} is already used on an earlier row`);
    // domain is what the client mails from; when it is blank the website domain is the best guess.
    const domains = list(cell("domain") || cell("website_domain")).map((d) => d.replace(/^@/, ""));
    const badDomain = domains.find((d) => !DOMAIN.test(d));
    if (badDomain) return skip(`"${badDomain}" is not a domain`);
    const contacts = list(cell("contacts"));
    const badContact = contacts.find((c) => !EMAIL.test(c));
    if (badContact) return skip(`"${badContact}" is not an email address`);
    if (!domains.length && !contacts.length) warnings.push(`row ${row}: no domain or contacts; mail can only be matched by client name or an existing thread`);

    let default_assignee: string | null = null;
    if (cell("default_assignee")) {
      default_assignee = assigneeGid(cell("default_assignee"), users);
      if (!default_assignee) warnings.push(`row ${row}: assignee "${cell("default_assignee")}" did not match one Asana user; left unassigned`);
    }
    let brief_url: string | null = cell("brief_url") || null;
    if (brief_url && !/^https?:\/\//.test(brief_url)) { warnings.push(`row ${row}: brief_url is not a link; ignored`); brief_url = null; }

    seen.add(asana_project_gid);
    rows.push({ asana_project_gid, client_name, domains, contacts, default_assignee, brief_url, active: TRUE.includes(active) });
  });

  // Domains and contacts on more than one active client: allowed, but the agent must disambiguate each email.
  const owners: Record<string, string[]> = {};
  for (const r of rows) if (r.active) for (const k of [...r.domains, ...r.contacts]) (owners[k] ??= []).push(r.client_name);
  const shared = Object.entries(owners).filter(([, c]) => c.length > 1).map(([match, clients]) => ({ match, clients }));
  return { rows, skipped, warnings, shared };
}

export async function syncClients(dryRun: boolean) {
  // UNFORMATTED_VALUE: Sheets displays 16-digit project gids as 1.20643E+15; the stored number is exact.
  const { data } = await google.sheets({ version: "v4", auth }).spreadsheets.values.get({
    spreadsheetId: process.env.CLIENTS_SHEET_ID!, range: `'${process.env.CLIENTS_SHEET_TAB ?? "Account list"}'`, valueRenderOption: "UNFORMATTED_VALUE",
  });
  const users: AsanaUser[] = await asana(`/users?workspace=${WS}&opt_fields=gid,name`);
  const { rows, skipped, warnings, shared } = parseClientRows(data.values ?? [], users);
  // An empty parse means a broken sheet, not "no clients". Never deactivate everything on that.
  if (!rows.length) return { dry_run: dryRun, error: "No valid rows in the sheet; nothing written.", synced: 0, deactivated: [], skipped, warnings, shared };

  const { data: existing, error: readErr } = await db.from("agent_clients").select("asana_project_gid,client_name").eq("active", true);
  if (readErr) throw new Error(`agent_clients read: ${readErr.message}`);
  const keep = new Set(rows.map((r) => r.asana_project_gid));
  const gone = (existing ?? []).filter((r) => !keep.has(r.asana_project_gid));

  if (!dryRun) {
    const { error } = await db.from("agent_clients").upsert(rows);
    if (error) throw new Error(`agent_clients upsert: ${error.message}`);
    if (gone.length) {
      const { error: offErr } = await db.from("agent_clients").update({ active: false }).in("asana_project_gid", gone.map((r) => r.asana_project_gid));
      if (offErr) throw new Error(`agent_clients deactivate: ${offErr.message}`);
    }
    await log(crypto.randomUUID(), "sync_clients", "clients_synced", { synced: rows.length, deactivated: gone.length, skipped: skipped.length });
  }
  return { dry_run: dryRun, synced: rows.length, deactivated: gone.map((r) => r.client_name), skipped, warnings, shared };
}
