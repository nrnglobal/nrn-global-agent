-- NRN Email + Asana Agent — Supabase schema
-- Run once in the SQL editor. Service role key is used by the agent.

-- Scheduling and outbound HTTP. Safe to rerun.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Upgrade from the first version (one row per domain): keep the old rows aside, then create the new shape.
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agent_clients' and column_name = 'domain') then
    alter table agent_clients rename to agent_clients_v1;
    alter index agent_clients_pkey rename to agent_clients_v1_pkey;
  end if;
end $$;

-- One row per client (= one Asana project). Loaded from the clients sheet by /run/sync-clients.
-- A domain or contact may appear on several clients (shared agency, sister teams); the agent then has to disambiguate.
create table if not exists agent_clients (
  asana_project_gid text primary key,
  client_name       text not null,
  domains           text[] not null default '{}',      -- e.g. {greensideupcontracting.com}
  contacts          text[] not null default '{}',      -- exact addresses: agency people, gmail accounts
  default_assignee  text,                              -- Asana user gid; null = unassigned
  brief_url         text,                              -- Google Doc: goals, contacts, scope
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

create table if not exists agent_sender_overrides (
  email             text primary key,                  -- exact sender address
  asana_project_gid text not null,
  note              text,                              -- why this override exists
  created_at        timestamptz not null default now()
);

-- One row per key. Seeded below.
create table if not exists agent_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Every action the agent takes, and every run boundary.
create table if not exists agent_run_log (
  id           bigserial primary key,
  run_id       uuid not null,
  run_type     text not null,                          -- capture | brief | slack_reply | bootstrap | sync_clients
  at           timestamptz not null default now(),
  gmail_msg_id text,
  action       text not null,                          -- task_created | task_commented | outreach_archived | draft_written | skipped | escalated | error | run_start | run_end
  detail       jsonb
);
create index if not exists agent_run_log_msg on agent_run_log (gmail_msg_id);
create index if not exists agent_run_log_at  on agent_run_log (at desc);

-- Drafts awaiting Neil; the brief reads this and Slack replies update it.
create table if not exists agent_pending (
  code            text primary key,                     -- A1, B2 … regenerated per brief
  kind            text not null,                        -- draft | nudge | project_pick | lead | outreach_maybe
  gmail_msg_id    text,
  gmail_thread_id text,
  asana_task_gid  text,
  summary         text not null,
  status          text not null default 'open',         -- open | done | skipped
  created_at      timestamptz not null default now()
);

-- Lock the tables down. The agent uses the service role key, which bypasses RLS; with RLS on and no
-- policies, the anon and authenticated Data API roles can read nothing even though the tables are exposed.
alter table agent_clients          enable row level security;
alter table agent_sender_overrides enable row level security;
alter table agent_settings         enable row level security;
alter table agent_run_log          enable row level security;
alter table agent_pending          enable row level security;

insert into agent_settings (key, value) values
  ('mode',              '"dry_run"'),                         -- dry_run | live
  ('last_message_id',   'null'),
  ('approvers',         '[]'),                                 -- Slack user IDs besides Neil
  ('allow_senders',     '["@upwork.com"]'),
  ('deny_senders',      '["noreply@google.com","no-reply@asana.com","notifications@","calendar-notification@google.com"]'),
  ('escalate_terms',    '["cancel","refund","terminate","lawyer","legal","invoice dispute","chargeback","unhappy","disappointed"]'),
  ('tier_promotions',   '[]'),                                 -- categories moved to tier 1
  ('report_spam',       'false'),                              -- flip after the 2-week review
  ('confidence_floor',  '0.7'),
  ('outreach_threshold','0.85'),
  ('google_writes',      'false')                              -- allow sheet_update_client_field / brief_append_note after Neil approves in #agent
on conflict (key) do nothing;

-- pg_cron: call the Railway service. Replace URL and token.
select cron.schedule('agent-capture', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://YOUR-APP.up.railway.app/run/capture',
    headers := '{"X-Run-Token":"REPLACE_ME"}'::jsonb,
    body := '{}'::jsonb
  );
$$);

-- 08:00 America/Toronto = 12:00 UTC (EDT) / 13:00 UTC (EST). Adjust twice a year or use two jobs.
select cron.schedule('agent-brief', '0 12 * * 1-5', $$
  select net.http_post(
    url := 'https://YOUR-APP.up.railway.app/run/brief',
    headers := '{"X-Run-Token":"REPLACE_ME"}'::jsonb,
    body := '{}'::jsonb
  );
$$);

-- eWise context tab for the report routine: Tue/Fri 08:45 America/Toronto = 12:45 UTC (EDT) / 13:45 UTC (EST).
select cron.schedule('agent-ewise-context', '45 12 * * 2,5', $$
  select net.http_post(
    url := 'https://YOUR-APP.up.railway.app/run/ewise-context',
    headers := '{"X-Run-Token":"REPLACE_ME"}'::jsonb,
    body := '{}'::jsonb
  );
$$);
