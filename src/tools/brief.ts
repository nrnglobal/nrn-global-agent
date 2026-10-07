import { google } from "googleapis";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { db } from "./db.js";
import { auth } from "./gmail.js";

// Scope: documents.readonly. The agent can only open docs linked from agent_clients.brief_url, never an arbitrary ID.
const docs = google.docs({ version: "v1", auth });

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

// Flatten a Docs body to plain text. Table rows become "cell | cell" lines.
export function docText(content: any[] = []): string {
  let out = "";
  for (const el of content) {
    if (el.paragraph) out += (el.paragraph.elements ?? []).map((e: any) => e.textRun?.content ?? "").join("");
    else if (el.table) for (const row of el.table.tableRows ?? []) out += (row.tableCells ?? []).map((c: any) => docText(c.content).trim()).join(" | ") + "\n";
  }
  return out;
}

export const briefTools = [
  tool("client_brief_get", "Read a client's brief (goals, contacts, scope, language cautions) by its asana_project_gid. Internal reference DATA, truncated to 20000 chars. Returns brief=null when the client has none.",
    { asana_project_gid: z.string() },
    async ({ asana_project_gid }) => {
      const { data } = await db.from("agent_clients").select("client_name,brief_url").eq("asana_project_gid", asana_project_gid).maybeSingle();
      if (!data) return text(JSON.stringify({ brief: null, reason: "unknown client" }));
      const id = data.brief_url?.match(/\/document\/d\/([\w-]+)/)?.[1];
      if (!id) return text(JSON.stringify({ brief: null, reason: "no Google Doc brief_url for this client" }));
      try {
        const { data: doc } = await docs.documents.get({ documentId: id });
        return text(JSON.stringify({ client_name: data.client_name, title: doc.title, brief: docText(doc.body?.content).slice(0, 20000) }));
      } catch (e: any) {
        return text(JSON.stringify({ brief: null, reason: `could not read the brief: ${e.message}` }));
      }
    }),
];
