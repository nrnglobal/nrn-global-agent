import { db } from "./db.js";

// Read-only snapshot for the status dashboard. No writes; guarded by STATUS_TOKEN in index.ts.
// Kept separate from RUN_TOKEN so a page that only needs to read can never trigger a run.

const RUN_TYPES = ["capture", "brief", "slack_reply", "bootstrap", "sync_clients"] as const;

// Credential expiry reminders. Set e.g. ANTHROPIC_KEY_EXPIRES=2027-06-01; warns from 30 days out.
function credentialWarnings(now: number) {
  const out: string[] = [];
  for (const [name, env] of [["Anthropic API key", "ANTHROPIC_KEY_EXPIRES"]] as const) {
    const raw = process.env[env];
    if (!raw) continue;
    const days = Math.floor((Date.parse(raw) - now) / 86400000);
    if (Number.isNaN(days)) out.push(`${env} is not a valid date: ${raw}`);
    else if (days < 0) out.push(`${name} expired ${-days} day(s) ago (${raw})`);
    else if (days <= 30) out.push(`${name} expires in ${days} day(s) (${raw})`);
  }
  return out;
}

export async function statusSnapshot(running: boolean) {
  const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [runs, recent, last24h, pending, settings, clients] = await Promise.all([
    db.from("agent_run_log").select("run_id,run_type,action,at,detail")
      .in("action", ["run_start", "run_end", "error"]).order("at", { ascending: false }).limit(200),
    db.from("agent_run_log").select("id,run_id,run_type,action,at,gmail_msg_id,detail")
      .order("at", { ascending: false }).limit(50),
    db.from("agent_run_log").select("action,run_type").gte("at", since24h),
    db.from("agent_pending").select("*").eq("status", "open").order("created_at"),
    db.from("agent_settings").select("key,value,updated_at"),
    db.from("agent_clients").select("asana_project_gid,client_name,domains,contacts,active,brief_url"),
  ]);

  // Last start, end and error per run type.
  const byType: Record<string, { last_start?: string; last_end?: string; last_error?: { at: string; message?: string } }> = {};
  for (const t of RUN_TYPES) byType[t] = {};
  for (const r of runs.data ?? []) {
    const slot = (byType[r.run_type] ??= {});
    if (r.action === "run_start" && !slot.last_start) slot.last_start = r.at;
    if (r.action === "run_end" && !slot.last_end) slot.last_end = r.at;
    if (r.action === "error" && !slot.last_error) slot.last_error = { at: r.at, message: (r.detail as any)?.message };
  }

  const counts24h: Record<string, number> = {};
  for (const r of last24h.data ?? []) counts24h[r.action] = (counts24h[r.action] ?? 0) + 1;

  // Domains or contacts that sit on more than one active client; the agent must disambiguate these.
  const seen: Record<string, string[]> = {};
  const active = (clients.data ?? []).filter((c) => c.active);
  for (const c of active) for (const k of [...(c.domains ?? []), ...(c.contacts ?? [])]) (seen[k] ??= []).push(c.client_name);
  const shared = Object.fromEntries(Object.entries(seen).filter(([, names]) => names.length > 1));

  const now = Date.now();
  return {
    now: new Date(now).toISOString(),
    health: { ok: true, running },
    warnings: credentialWarnings(now),
    runs: byType,
    actions_24h: counts24h,
    recent_actions: recent.data ?? [],
    pending: (pending.data ?? []).map((p) => ({ ...p, age_hours: Math.round((now - Date.parse(p.created_at)) / 36000) / 100 })),
    settings: Object.fromEntries((settings.data ?? []).map((r) => [r.key, { value: r.value, updated_at: r.updated_at }])),
    clients: {
      active: active.length,
      inactive: (clients.data ?? []).length - active.length,
      with_brief: active.filter((c) => c.brief_url).length,
      shared,
    },
    errors: {
      db: [runs, recent, last24h, pending, settings, clients].map((q) => q.error?.message).filter(Boolean),
    },
  };
}
