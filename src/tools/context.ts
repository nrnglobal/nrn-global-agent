// Read-only context for the eWise report routine: open Asana tasks and eWise email threads for one client.
// Pure helpers live at the top so they can be unit-tested without network access.

export type AsanaTask = { gid: string; name: string; assignee?: { name: string } | null; due_on?: string | null; modified_at: string; permalink_url: string };
export type ContextTask = { name: string; assignee: string | null; due_on: string | null; modified_at: string; permalink: string };
export type ClientRef = { client_name: string; report_label?: string | null; domains: string[] };

const EWISE = /@ewisecommunications\.com\b/i;

export function isEwiseThread(participants: string[]): boolean {
  return participants.some((p) => EWISE.test(p));
}

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export function mentionsClient(text: string, client: ClientRef): boolean {
  const t = text.toLowerCase();
  if (t.includes(client.client_name.toLowerCase())) return true;
  if (client.domains.some((d) => t.includes(d.toLowerCase()))) return true;
  if (client.report_label) return new RegExp(`\\b${escapeRe(client.report_label.toLowerCase())}\\b`).test(t);
  return false;
}

export function parseSince(s: string | undefined, now = new Date()): { ok: true; date: Date } | { ok: false; reason: string } {
  if (!s) return { ok: false, reason: "since is required (ISO date)" };
  if (!/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(s)) return { ok: false, reason: "since must be an ISO date like 2026-10-06" };
  const date = new Date(s);
  if (Number.isNaN(date.getTime())) return { ok: false, reason: "since is not a valid date" };
  if (date.getTime() > now.getTime()) return { ok: false, reason: "since is in the future" };
  return { ok: true, date };
}

export function shapeTask(t: AsanaTask): ContextTask {
  return { name: t.name, assignee: t.assignee?.name ?? null, due_on: t.due_on ?? null, modified_at: t.modified_at, permalink: t.permalink_url };
}

// Rows for the "Context (auto)" tab on the report sheet: one per client, tasks and threads flattened to one cell each.
export type ContextThreadLite = { subject: string; from: string; date: string };
export type ClientContextLite = { client_name: string; report_label?: string | null; asana_project_gid: string; open_tasks: ContextTask[]; ewise_threads: ContextThreadLite[] };

function shortDate(rfc: string) {
  const d = new Date(rfc);
  return Number.isNaN(d.getTime()) ? rfc.slice(0, 11) : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
}
function fromName(from: string) { return (from.split("<")[0].trim().replace(/"/g, "") || from).trim(); }

export function contextRows(clients: ClientContextLite[], since: string, generatedAt: string): string[][] {
  const header = ["report_label", "client_name", "asana_project_gid", "since", "generated_at", "open_tasks", "ewise_threads"];
  return [header, ...clients.map((c) => [
    c.report_label ?? "", c.client_name, c.asana_project_gid, since, generatedAt,
    c.open_tasks.map((t) => `${t.name} (${t.assignee ?? "unassigned"}, due ${t.due_on ?? "none"})`).join("\n"),
    c.ewise_threads.map((t) => `email ${shortDate(t.date)} ${t.subject} (${fromName(t.from)})`).join("\n"),
  ])];
}
