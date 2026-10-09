// Network half of /context. Kept apart from context.ts so the pure helpers import nothing that needs env at load time.
import { google } from "googleapis";
import { db } from "./db.js";
import { auth } from "./gmail.js";
import { asana } from "./asana_slack.js";
import { isEwiseThread, mentionsClient, shapeTask, type AsanaTask, type ClientRef, type ContextTask } from "./context.js";


export type ContextThread = { subject: string; from: string; date: string; snippet: string; gmail_link: string };
const gmail = google.gmail({ version: "v1", auth });
const USER = process.env.GMAIL_USER ?? "me";

export async function clientContext(asana_project_gid: string, since: Date) {
  const { data: row } = await db.from("agent_clients").select("client_name,domains").eq("asana_project_gid", asana_project_gid).maybeSingle();
  if (!row) throw Object.assign(new Error("unknown client"), { status: 404 });
  // report_label is a sheet-only column; read it from the sheet so the endpoint has no new DB dependency.
  const sheets = google.sheets({ version: "v4", auth });
  const { data: sh } = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.CLIENTS_SHEET_ID!, range: `'${process.env.CLIENTS_SHEET_TAB ?? "Account list"}'`, valueRenderOption: "UNFORMATTED_VALUE" });
  const [hdr, ...rows] = sh.values ?? [];
  const gidCol = hdr.indexOf("asana_project_gid"), labelCol = hdr.indexOf("report_label");
  const sheetRow = rows.find((r) => String(r[gidCol] ?? "").replace(/\D/g, "") === asana_project_gid);
  const client: ClientRef & { asana_project_gid: string } = { asana_project_gid, client_name: row.client_name, domains: row.domains ?? [], report_label: labelCol >= 0 ? (sheetRow?.[labelCol] ? String(sheetRow[labelCol]) : null) : null };

  const tasks = await asana(`/tasks?project=${asana_project_gid}&completed_since=now&opt_fields=name,assignee.name,due_on,modified_at,permalink_url&limit=50`);
  const open_tasks: ContextTask[] = ((tasks ?? []) as AsanaTask[])
    .sort((a, b) => b.modified_at.localeCompare(a.modified_at)).slice(0, 15).map(shapeTask);

  const after = Math.floor(since.getTime() / 1000);
  const { data: list } = await gmail.users.messages.list({ userId: USER, q: `after:${after} ewisecommunications.com`, maxResults: 60 });
  const seen = new Set<string>(); const ewise_threads: ContextThread[] = [];
  for (const m of list.messages ?? []) {
    const { data: full } = await gmail.users.messages.get({ userId: USER, id: m.id!, format: "metadata", metadataHeaders: ["From", "To", "Cc", "Subject", "Date"] });
    if (seen.has(full.threadId!)) continue;
    const h = Object.fromEntries((full.payload?.headers ?? []).map((x) => [x.name!.toLowerCase(), x.value ?? ""]));
    const participants = `${h.from},${h.to ?? ""},${h.cc ?? ""}`.split(",");
    if (!isEwiseThread(participants)) continue;
    if (!mentionsClient(`${h.subject} ${full.snippet ?? ""}`, client)) continue;
    seen.add(full.threadId!);
    ewise_threads.push({ subject: h.subject ?? "", from: h.from ?? "", date: h.date ?? "", snippet: (full.snippet ?? "").slice(0, 200), gmail_link: `https://mail.google.com/mail/u/0/#all/${full.threadId}` });
    if (ewise_threads.length >= 10) break;
  }
  return { client, open_tasks, ewise_threads };
}

// Write the "Context (auto)" tab on a report sheet: one row per eWise client with a report_label.
// Runs from pg_cron shortly before the report routine, which reads the tab through the Sheets connector
// (the routine's sandbox cannot reach this service directly).
import { contextRows } from "./context.js";

export async function writeContextTab(spreadsheetId: string, since: Date, log?: (action: string, detail: unknown) => Promise<void>) {
  const sheets = google.sheets({ version: "v4", auth });
  const { data: sh } = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.CLIENTS_SHEET_ID!, range: `'${process.env.CLIENTS_SHEET_TAB ?? "Account list"}'`, valueRenderOption: "UNFORMATTED_VALUE" });
  const [hdr, ...rows] = sh.values ?? [];
  const col = (n: string) => hdr.indexOf(n);
  const targets = rows
    .filter((r) => String(r[col("report_label")] ?? "").trim() && /ewisecommunications\.com/i.test(String(r[col("contacts")] ?? "")) && /^(yes|true|y|1)$/i.test(String(r[col("active")] ?? "")))
    .map((r) => ({ gid: String(r[col("asana_project_gid")] ?? "").replace(/\D/g, ""), label: String(r[col("report_label")]) }));

  const results = []; const errors: string[] = [];
  for (const t of targets) {
    try {
      const c = await clientContext(t.gid, since);
      results.push({ client_name: c.client.client_name, report_label: t.label, asana_project_gid: t.gid, open_tasks: c.open_tasks, ewise_threads: c.ewise_threads });
    } catch (e: any) { errors.push(`${t.label}: ${e.message}`); }
  }
  const sinceStr = since.toISOString().slice(0, 10), generatedAt = new Date().toISOString();
  const values = contextRows(results, sinceStr, generatedAt);
  if (errors.length) values.push(["", "errors", "", sinceStr, generatedAt, errors.join("\n"), ""]);

  const TAB = "Context (auto)";
  const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  if (!meta.sheets?.some((s) => s.properties?.title === TAB))
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] } });
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${TAB}'!A:G` });
  await sheets.spreadsheets.values.update({ spreadsheetId, range: `'${TAB}'!A1`, valueInputOption: "RAW", requestBody: { values } });
  await log?.("context_tab_written", { spreadsheetId, clients: results.length, errors });
  return { tab: TAB, clients: results.length, errors, since: sinceStr, generated_at: generatedAt };
}
