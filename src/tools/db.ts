import { createClient } from "@supabase/supabase-js";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

export const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const { data } = await db.from("agent_settings").select("value").eq("key", key).single();
  return (data?.value as T) ?? null;
}
export async function setSetting(key: string, value: unknown) {
  await db.from("agent_settings").upsert({ key, value, updated_at: new Date().toISOString() });
}
export async function log(run_id: string, run_type: string, action: string, detail?: unknown, gmail_msg_id?: string) {
  await db.from("agent_run_log").insert({ run_id, run_type, action, detail, gmail_msg_id });
}

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

export const dbTools = (runId: string, runType: string) => [
  tool("config_get", "Read all agent config: clients (each with its domains and contacts), sender_overrides, and settings.", {}, async () => {
    const [clients, overrides, settings] = await Promise.all([
      db.from("agent_clients").select("*").eq("active", true),
      db.from("agent_sender_overrides").select("*"),
      db.from("agent_settings").select("key,value"),
    ]);
    return text(JSON.stringify({
      clients: clients.data, sender_overrides: overrides.data,
      settings: Object.fromEntries((settings.data ?? []).map((r) => [r.key, r.value])),
    }));
  }),

  tool("config_add_sender_override", "Map an exact sender email to an Asana project. Use after Neil answers a project pick.",
    { email: z.string(), asana_project_gid: z.string(), note: z.string().optional() },
    async (a) => { await db.from("agent_sender_overrides").upsert(a); return text("ok"); }),

  tool("config_add_client", "Add a client domain → Asana project row (bootstrap or Neil's instruction). Adds the domain to the client if the project is already there.",
    { domain: z.string(), client_name: z.string(), asana_project_gid: z.string(), default_assignee: z.string().optional() },
    async ({ domain, ...a }) => {
      const { data } = await db.from("agent_clients").select("domains").eq("asana_project_gid", a.asana_project_gid).maybeSingle();
      await db.from("agent_clients").upsert({ ...a, domains: [...new Set([...(data?.domains ?? []), domain.toLowerCase()])] });
      return text("ok");
    }),

  tool("config_set", "Set one settings key (e.g. last_message_id, allow_senders, tier_promotions).",
    { key: z.string(), value: z.any() },
    async ({ key, value }) => { await setSetting(key, value); return text("ok"); }),

  tool("log_action", "Record an action you took. Call this for every write.",
    { action: z.string(), gmail_msg_id: z.string().optional(), detail: z.any().optional() },
    async ({ action, gmail_msg_id, detail }) => { await log(runId, runType, action, detail, gmail_msg_id); return text("logged"); }),

  tool("log_already_processed", "Check whether a Gmail message ID has already been actioned (idempotency).",
    { gmail_msg_id: z.string() },
    async ({ gmail_msg_id }) => {
      const { count } = await db.from("agent_run_log").select("id", { count: "exact", head: true })
        .eq("gmail_msg_id", gmail_msg_id).in("action", ["task_created", "task_commented", "outreach_archived", "skipped"]);
      return text(JSON.stringify({ processed: (count ?? 0) > 0 }));
    }),

  tool("pending_upsert", "Create or update a pending item for the brief (draft, nudge, project_pick, lead, outreach_maybe).",
    { code: z.string(), kind: z.string(), summary: z.string(), gmail_msg_id: z.string().optional(),
      gmail_thread_id: z.string().optional(), asana_task_gid: z.string().optional(), status: z.string().optional() },
    async (a) => { await db.from("agent_pending").upsert(a); return text("ok"); }),

  tool("pending_list", "List pending items, optionally by status (default open).",
    { status: z.string().optional() },
    async ({ status }) => {
      const { data } = await db.from("agent_pending").select("*").eq("status", status ?? "open").order("created_at");
      return text(JSON.stringify(data));
    }),

  tool("run_log_since", "Summarize run log actions since an ISO timestamp (for the brief's 'Done overnight').",
    { since: z.string() },
    async ({ since }) => {
      const { data } = await db.from("agent_run_log").select("action").gte("at", since);
      const counts: Record<string, number> = {};
      for (const r of data ?? []) counts[r.action] = (counts[r.action] ?? 0) + 1;
      return text(JSON.stringify(counts));
    }),
];
