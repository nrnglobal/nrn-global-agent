# NRN Email + Asana Agent

Claude Agent SDK service that reads the success@ Gmail inbox, files client asks into Asana, bins cold outreach, and briefs Neil in Slack #agent. Spec: see the "Email + Asana Agent Spec" doc.

## Layout
```
src/index.ts            Express: /run/capture, /run/brief, /run/bootstrap (pg_cron), /slack/events
src/prompt.ts           System prompt (the spec's rules)
src/tools/gmail.ts      Gmail read/label/archive/draft — no send scope
src/tools/asana_slack.ts Asana REST + Slack post
src/tools/db.ts         Supabase config, pending items, run log
src/tools/sheet.ts      Clients sheet → agent_clients sync (/run/sync-clients)
src/tools/brief.ts      Read a client's brief (Google Doc) from its brief_url
src/tools/status.ts     Read-only JSON snapshot for GET /status (dashboard feed)
.claude/skills/*        One SKILL.md per workflow: capture, outreach, brief, bootstrap, slack-reply
supabase/schema.sql     Tables, seed settings, pg_cron jobs
```

## Setup
1. **Supabase**: run `supabase/schema.sql`. Enable `pg_cron` and `pg_net`. Put the Railway URL and `RUN_TOKEN` into the two cron jobs.
2. **Gmail**: create an OAuth client (Desktop type) in Google Cloud, scopes `https://www.googleapis.com/auth/gmail.modify`, `https://www.googleapis.com/auth/spreadsheets` and `https://www.googleapis.com/auth/documents` (`scripts/gmail-consent.mjs` requests them), run a one-time consent as success@ to get a refresh token. Do not grant `gmail.send`. Enable the Google Sheets API and Google Docs API in the same Cloud project.
3. **Asana**: personal access token; note the workspace GID and create an `Agent Inbox` project.
4. **Slack**: create an app with bot scopes `chat:write`, `channels:history`, `channels:read`. Subscribe to `message.channels`, event URL `https://<railway>/slack/events`. Invite the bot to #agent.
5. **Railway**: new project from this repo, set every variable in `.env.example`. Deploy.
6. `curl -X POST -H "X-Run-Token: …" https://<railway>/run/bootstrap` → confirm the map in #agent.
7. Leave `mode = dry_run` for week 1. Review `agent_run_log`. Then `config_set mode live` (or reply `resume` in #agent).

## Clients sheet
The Google Sheet is the source of truth for clients; the agent reads the copy in `agent_clients`. Share the sheet with success@ (viewer), set `CLIENTS_SHEET_ID`, then after any edit:
```
curl -X POST -H "X-Run-Token: …" "https://<railway>/run/sync-clients?dry_run=1"   # report only
curl -X POST -H "X-Run-Token: …" "https://<railway>/run/sync-clients"             # write
```
- One row per client, and one Asana project per row. Row 1 headers, any order: `client_name`, `asana_project_gid`, `active` (required); `website_domain`, `associated_domains`, `contacts`, `default_assignee`, `brief_url`, `notes` (optional).
- `website_domain`: the client's site. `associated_domains`: any other domains their staff mail from, comma-separated (e.g. holland1916.com for Holland Nameplate). Both are matched; the union is the client's domain list.
- `report_label`: the short account name used in the eWise report sheet (e.g. `ACS`, `OPS`). `callrail_account_id`: the CallRail account id (`ACC…`). Both are read only by the eWise report routine (see `routines/`), not by the email agent. `contacts`: exact addresses of anyone else who writes about this client (agency staff, personal accounts), comma-separated.
- A domain or contact may sit on several rows (an agency person on three clients, two teams under one parent). The response lists these under `shared`. For such mail the agent picks a client only on hard evidence in the email or thread, and otherwise asks in #agent.
- `asana_project_gid` takes the number or the project URL. `default_assignee` takes an Asana user gid or name. `active` takes TRUE/FALSE or Yes/No.
- Rows that fail a check are skipped and listed in the response.
- A client missing from the sheet is set inactive, including rows loaded through bootstrap or `config_add_client`. If the sheet yields no valid rows, nothing is written.

## Writing back to the sheet and briefs
Two tools can edit Google data: `sheet_update_client_field` (one field on one client row: notes, contacts, associated_domains, brief_url, default_assignee) and `brief_append_note` (dated note at the end of a brief doc). Both refuse unless `agent_settings.google_writes` is `true` (seeded `false`) and both require Neil's approval of the exact change in #agent first (`ok <code>` on a `sheet_change` pending item). Every edit is logged with before/after. Flip the gate with `config_set google_writes true` or by reply in #agent.

## Client briefs
`brief_url` on a client row links a Google Doc. The agent reads it with `client_brief_get(asana_project_gid)` (`src/tools/brief.ts`) for context before it classifies or drafts. Share each brief with success@ (viewer). The tool only opens docs linked from `agent_clients`, and the system prompt bars brief contents from client-facing text.

## Status endpoint
`GET /status` with header `X-Status-Token: $STATUS_TOKEN` returns a read-only JSON snapshot: last start/end/error per run type, action counts for the last 24 h, the 50 most recent log rows, open pending items with age, all settings, and client counts plus any domain or contact shared across clients. It never writes and uses its own token so a dashboard can read without being able to trigger runs.
```
curl -H "X-Status-Token: …" https://<railway>/status | jq .runs
```

## Notes
- Agent SDK option names (`systemPrompt`, `mcpServers`, `allowedTools`, `settingSources`, `permissionMode`) are current as of the SDK docs at build time; check `npm view @anthropic-ai/claude-agent-sdk` and the MCP page of the Agent SDK docs if a field is rejected.
- `permissionMode: dontAsk` plus `canUseTool` means any tool outside `ALLOWED_TOOLS` is denied without a prompt. `bypassPermissions` is not used: the bundled CLI refuses it when the process runs as root, which Railway containers do.
- Escalation and report-spam behaviour is controlled by `agent_settings`, not code.
