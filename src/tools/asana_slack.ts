import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

// ---------- Asana (REST with PAT) ----------
const A = "https://app.asana.com/api/1.0";
export async function asana(path: string, init: RequestInit = {}) {
  const r = await fetch(A + path, { ...init, headers: { Authorization: `Bearer ${process.env.ASANA_PAT}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const j = await r.json();
  if (!r.ok) throw new Error(`Asana ${r.status}: ${JSON.stringify(j.errors ?? j)}`);
  return j.data;
}
export const WS = process.env.ASANA_WORKSPACE_GID!;

export const asanaTools = [
  tool("asana_list_projects", "List active projects in the workspace (gid, name). Used by bootstrap and project picks.", {}, async () => {
    const data = await asana(`/projects?workspace=${WS}&archived=false&opt_fields=gid,name&limit=100`);
    return text(JSON.stringify(data));
  }),

  tool("asana_find_task_by_thread", "Find a task in a project whose notes contain this Gmail thread ID (dedupe check).",
    { project_gid: z.string(), gmail_thread_id: z.string() },
    async ({ project_gid, gmail_thread_id }) => {
      const data = await asana(`/workspaces/${WS}/tasks/search?projects.any=${project_gid}&text=${encodeURIComponent(gmail_thread_id)}&opt_fields=gid,name,completed,due_on,permalink_url&limit=5`);
      return text(JSON.stringify(data));
    }),

  tool("asana_search_tasks", "Search recent open tasks in a project by text (for 'is this the same ask' checks). Returns gid, name, due_on, notes excerpt.",
    { project_gid: z.string(), query: z.string(), days: z.number().default(60) },
    async ({ project_gid, query, days }) => {
      const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
      const data = await asana(`/workspaces/${WS}/tasks/search?projects.any=${project_gid}&text=${encodeURIComponent(query)}&completed=false&created_on.after=${since}&opt_fields=gid,name,due_on,notes,permalink_url&limit=10`);
      return text(JSON.stringify((data as any[]).map((t) => ({ ...t, notes: (t.notes ?? "").slice(0, 300) }))));
    }),

  tool("asana_create_task", "Create a task. Notes must start with the Gmail permalink line. Sets start_on = today.",
    { project_gid: z.string(), name: z.string(), notes: z.string(), assignee_gid: z.string().optional(),
      due_on: z.string().optional(), section_name: z.string().default("Agent – New"), parent_gid: z.string().optional() },
    async ({ project_gid, name, notes, assignee_gid, due_on, section_name, parent_gid }) => {
      const body: any = { name, notes, projects: [project_gid], start_on: new Date().toISOString().slice(0, 10) };
      if (assignee_gid) body.assignee = assignee_gid;
      if (due_on) body.due_on = due_on;
      if (parent_gid) { body.parent = parent_gid; delete body.projects; }
      const task = await asana(`/tasks`, { method: "POST", body: JSON.stringify({ data: body }) });
      if (!parent_gid && section_name) {
        const sections: any[] = await asana(`/projects/${project_gid}/sections?opt_fields=gid,name`);
        let sec = sections.find((s) => s.name === section_name);
        if (!sec) sec = await asana(`/projects/${project_gid}/sections`, { method: "POST", body: JSON.stringify({ data: { name: section_name } }) });
        await asana(`/sections/${sec.gid}/addTask`, { method: "POST", body: JSON.stringify({ data: { task: task.gid } }) });
      }
      return text(JSON.stringify({ gid: task.gid, permalink_url: task.permalink_url }));
    }),

  tool("asana_add_comment", "Add a comment (story) to a task. Use for updates and for your audit trail.",
    { task_gid: z.string(), text: z.string() },
    async ({ task_gid, text: t }) => { await asana(`/tasks/${task_gid}/stories`, { method: "POST", body: JSON.stringify({ data: { text: t } }) }); return text("ok"); }),

  tool("asana_update_task", "Update due date, assignee, or name on a task.",
    { task_gid: z.string(), due_on: z.string().optional(), assignee_gid: z.string().optional(), name: z.string().optional() },
    async ({ task_gid, ...rest }) => {
      const data: any = {}; if (rest.due_on) data.due_on = rest.due_on; if (rest.assignee_gid) data.assignee = rest.assignee_gid; if (rest.name) data.name = rest.name;
      await asana(`/tasks/${task_gid}`, { method: "PUT", body: JSON.stringify({ data }) }); return text("ok");
    }),

  tool("asana_overdue_with_recent_thread", "Open tasks past due in a project, with notes (so you can extract the thread link).",
    { project_gid: z.string() },
    async ({ project_gid }) => {
      const today = new Date().toISOString().slice(0, 10);
      const data = await asana(`/workspaces/${WS}/tasks/search?projects.any=${project_gid}&completed=false&due_on.before=${today}&opt_fields=gid,name,due_on,notes,permalink_url,modified_at&limit=20`);
      return text(JSON.stringify(data));
    }),
];

// ---------- Slack (Web API with bot token) ----------
async function slack(method: string, body: unknown) {
  const r = await fetch(`https://slack.com/api/${method}`, { method: "POST", headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json(); if (!j.ok) throw new Error(`Slack ${method}: ${j.error}`); return j;
}
const CH = process.env.SLACK_AGENT_CHANNEL_ID!;
const NEIL = process.env.SLACK_NEIL_USER_ID!;

export const slackTools = [
  tool("slack_post", "Post to #agent. Set tag_neil=true for anything needing his action (draft ready, project pick, escalation). Returns the message ts for threading.",
    { text: z.string(), tag_neil: z.boolean().default(false), thread_ts: z.string().optional() },
    async ({ text: t, tag_neil, thread_ts }) => {
      const j = await slack("chat.postMessage", { channel: CH, text: tag_neil ? `<@${NEIL}> ${t}` : t, thread_ts, unfurl_links: false });
      return text(JSON.stringify({ ts: j.ts }));
    }),
];
