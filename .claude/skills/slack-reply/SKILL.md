---
name: slack-reply
description: Act on a reply from Neil in #agent — approve or skip drafts, answer project picks, nudge, block or allow senders, pause, or load the bootstrap map.
---

# Slack reply

Input: `thread_ts`, `message_ts`, `text` from Neil. Only Neil's messages reach this skill in v1.

1. `config_get`, `pending_list(open)`.
2. Parse the text as one or more instructions, separated by newlines or commas. Recognised forms (case-insensitive):
   - `<code> send` / `all drafts send` — you cannot send. Reply in thread: "Draft is in Gmail (<link>). Sending is yours in v1." Mark pending done, `log_action("draft_approved")`.
   - `<code> skip` — `pending_upsert(status=skipped)`, `gmail_label(Agent/Skipped)` on the draft's message, comment on the task.
   - `<code> nudge` — draft a short follow-up in the thread (tier 2 rules), post the draft link in thread.
   - `<code> reassign to <name>` — resolve the name via the project's tasks/assignees if possible; else ask in thread.
   - `<code> not a lead, block domain` — `config_set("deny_senders", existing + domain)`, archive the message, mark pending done.
   - `<code> allow` / `allow sender` — `config_set("allow_senders", existing + address)`; reply that future mail will pass.
   - `<code> block` — `gmail_label(Agent/Cold Outreach, archive=true)` and add the domain to `deny_senders`.
   - A project name alone, in a project-pick thread — match to `asana_list_projects`, create the task in the right project, comment on the Agent Inbox task and rename it with prefix "[moved]", `config_add_sender_override(email, gid, note="Neil pick")`. Skip the override when the sender is already in the contacts of any client or the pick listed several candidates: that sender works on more than one client, and an override would pin them to one.
   - `pause` — `config_set("mode","paused")`. `resume` — `config_set("mode","live")`.
   - `ok` / `ok all` in the bootstrap thread — `config_add_client` for confirmed rows (or all); reply with the count.
   - `<domain> → <project name>` — `config_add_client` for that row.
3. Anything unparsed → reply in thread with what you understood and what you didn't. Never guess.
4. Reply in the same thread (`slack_post(thread_ts=...)`) with one line per instruction handled. `log_action` each.

## Sheet and brief changes
A pending item of kind `sheet_change` holds a proposed edit (client, field or doc, before, after). `ok <code>` → call `sheet_update_client_field` or `brief_append_note` with `approved_by_message_ts` = this message's ts, mark the pending item done, reply in thread with before/after. `skip <code>` → mark skipped. If `settings.google_writes` is false the tool refuses; tell Neil the switch is off (`config_set google_writes true` turns it on).
