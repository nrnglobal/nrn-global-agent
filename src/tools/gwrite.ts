import { google } from "googleapis";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { db, getSetting, log } from "./db.js";
import { auth } from "./gmail.js";

// Write access to the clients sheet and client brief docs.
// Gated twice: settings.google_writes must be true (default false), and the refresh token must carry the
// full spreadsheets + documents scopes (the read-only token returns 403). Until both hold, the tools only report.
// Scope of what can be changed is deliberately narrow: one field on one client row, or an appended note on a brief.

const sheets = google.sheets({ version: "v4", auth });
const docs = google.docs({ version: "v1", auth });
const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

const EDITABLE_FIELDS = ["notes", "contacts", "associated_domains", "brief_url", "default_assignee"] as const;
const SHEET_ID = () => process.env.CLIENTS_SHEET_ID!;
const TAB = () => process.env.CLIENTS_SHEET_TAB ?? "Account list";

async function writesEnabled() {
  return (await getSetting<boolean>("google_writes")) === true;
}

export const gwriteTools = (runId: string, runType: string) => [
  tool("sheet_update_client_field",
    `Change one field on one client's row in the clients sheet. Only after Neil approved the exact change in #agent. Fields: ${EDITABLE_FIELDS.join(", ")}. Disabled while settings.google_writes is false.`,
    { asana_project_gid: z.string(), field: z.enum(EDITABLE_FIELDS), value: z.string(), approved_by_message_ts: z.string().describe("Slack ts of Neil's approval") },
    async ({ asana_project_gid, field, value, approved_by_message_ts }) => {
      if (!(await writesEnabled())) return text(JSON.stringify({ ok: false, reason: "google_writes is off; propose the change to Neil instead" }));
      const { data } = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID(), range: `'${TAB()}'`, valueRenderOption: "UNFORMATTED_VALUE" });
      const [hdr, ...rows] = data.values ?? [];
      const gidCol = hdr.indexOf("asana_project_gid"), fieldCol = hdr.indexOf(field);
      if (gidCol < 0 || fieldCol < 0) return text(JSON.stringify({ ok: false, reason: `sheet has no '${fieldCol < 0 ? field : "asana_project_gid"}' column` }));
      const i = rows.findIndex((r) => String(r[gidCol] ?? "").replace(/\D/g, "") === asana_project_gid);
      if (i < 0) return text(JSON.stringify({ ok: false, reason: "no row with that asana_project_gid" }));
      const rowNum = i + 2, before = rows[i][fieldCol] ?? "";
      const colLetter = String.fromCharCode(65 + fieldCol);
      await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID(), range: `'${TAB()}'!${colLetter}${rowNum}`, valueInputOption: "RAW", requestBody: { values: [[value]] } });
      await log(runId, runType, "sheet_updated", { asana_project_gid, field, before, after: value, approved_by_message_ts });
      return text(JSON.stringify({ ok: true, row: rowNum, field, before, after: value, note: "run /run/sync-clients or wait for the next sync for the agent to see it" }));
    }),

  tool("brief_append_note",
    "Append a dated note to the end of a client's brief doc (the doc linked from the client's brief_url). Only after Neil approved the exact text in #agent. Disabled while settings.google_writes is false.",
    { asana_project_gid: z.string(), note: z.string().max(2000), approved_by_message_ts: z.string().describe("Slack ts of Neil's approval") },
    async ({ asana_project_gid, note, approved_by_message_ts }) => {
      if (!(await writesEnabled())) return text(JSON.stringify({ ok: false, reason: "google_writes is off; propose the note to Neil instead" }));
      const { data } = await db.from("agent_clients").select("client_name,brief_url").eq("asana_project_gid", asana_project_gid).maybeSingle();
      const id = data?.brief_url?.match(/\/document\/d\/([\w-]+)/)?.[1];
      if (!id) return text(JSON.stringify({ ok: false, reason: "client has no Google Doc brief_url" }));
      const { data: doc } = await docs.documents.get({ documentId: id });
      const end = (doc.body?.content ?? []).reduce((m: number, el: any) => Math.max(m, el.endIndex ?? 0), 1);
      const stamp = new Date().toISOString().slice(0, 10);
      await docs.documents.batchUpdate({ documentId: id, requestBody: { requests: [{ insertText: { location: { index: end - 1 }, text: `\n[${stamp}, agent, approved by Neil] ${note}\n` } }] } });
      await log(runId, runType, "brief_note_appended", { asana_project_gid, client: data?.client_name, chars: note.length, approved_by_message_ts });
      return text(JSON.stringify({ ok: true, client: data?.client_name, doc: doc.title }));
    }),
];
