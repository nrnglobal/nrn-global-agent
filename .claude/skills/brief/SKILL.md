---
name: brief
description: Build and post the 7:00 AM triage brief to #agent. Invoked by the brief run on weekdays.
---

# Brief

Target: under 300 words, readable in two minutes, every item carrying a code Neil can reply with.

1. `config_get`, `pending_list(open)`, `run_log_since(<24h ago ISO>)`.
2. For each active client project: `asana_overdue_with_recent_thread`. Keep tasks whose notes contain a `thread:` line and were modified in the last 7 days.
3. Assign codes: A = needs Neil today (open drafts + escalations), B = waiting on client 3+ days (nudge candidates), C = overdue with live thread, D = leads, E = probably outreach. Reuse the code already stored in `agent_pending` where one exists; assign the next free code to new items and `pending_upsert` them.
4. Compose, omitting empty sections:

```
*Brief — <Mon Sep 28>*
*Needs you today*
A1 · <Client> — <ask in ≤10 words> · draft ready · <draft link> · <task link>
A2 · <Client> — <ask> · escalated, no draft · <task link>
*Waiting on client (3+ days)*
B1 · <Client> — <what you asked for> · last contact <date> · reply `B1 nudge` to draft a follow-up
*Overdue with live thread*
C1 · <Client> — <task> · due <date> · <task link>
*Leads*
D1 · <sender> — <one line> · <task link>
*Probably outreach*
E1 · <sender> — <subject> · reply `E1 block` or `E1 allow`
*Done overnight*: <n> tasks created, <n> updated, <n> outreach archived, <n> skipped
```
Reply with codes in this thread. `all drafts send` / `A1 send` / `A1 skip` / `B1 nudge` / `C1 reassign to <name>` / `D1 not a lead, block domain` / `E1 allow` / `pause`.

5. `slack_post(tag_neil=true)`. Store the returned `ts` with `config_set("last_brief_ts", ts)` so slack-reply can recognise replies to it.
6. `log_action("brief_posted", detail={counts})`.
