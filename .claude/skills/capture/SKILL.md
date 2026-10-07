---
name: capture
description: Process new inbox mail in success@ and turn client asks into Asana tasks. Invoked every 10 minutes by the capture run.
---

# Capture

1. `config_get`. Note `mode`, `last_message_id`, `confidence_floor`, `escalate_terms`, `deny_senders`.
2. `gmail_list_new(after_message_id=last_message_id)`. Process oldest first. For each message:
   1. `log_already_processed`. If processed, skip.
   2. If sender matches `deny_senders` → `gmail_label(Agent/Skipped, archive=true)`, `log_action("skipped")`, next.
   3. `gmail_get`. Resolve the client per the system prompt. Not a client and no history → apply the **outreach** skill's rules for this one message, then next.
   4. Classify. Produce JSON for yourself: `{actionable, asks:[{summary, owner, due_hint, confidence}], sentiment, tier}`.
      - Not actionable → `gmail_label(Agent/Skipped)` (do not archive client mail), `log_action("skipped")`, next.
      - Any `escalate_terms` hit, sentiment `unhappy`, or a new contact at a known client → tier 3.
   5. Dedupe: `asana_find_task_by_thread`. None → `asana_search_tasks` with 3–5 key words from the ask. Same ask → comment path; else create path.
   6. Create path: `asana_create_task` per the task format. Second distinct ask → `asana_create_task` with `parent_gid`.
      Comment path: `asana_add_comment` with permalink + what's new; `asana_update_task` if the due date moved.
   7. `asana_add_comment` audit line: "Agent: captured from <permalink>. Confidence 0.xx. <one-line reason>."
   8. Tier 3 → assign Neil, `slack_post(tag_neil=true)` 3-line summary, `log_action("escalated")`, no draft.
      Tier 2 with an ask owned by Neil → `gmail_recent_sent_to(sender, 3)`, `gmail_create_draft`, `gmail_label(Agent/Draft Ready)`, `slack_post(tag_neil=true)` with client / gist / draft link / task link, `pending_upsert(kind=draft, code=next free A-code)`.
   9. `gmail_label(Agent/Captured)`, `log_action("task_created"|"task_commented", gmail_msg_id, {task_gid})`.
3. After the batch: `config_set("last_message_id", <newest processed id>)`. Only advance past messages you fully handled.
4. If you hit the run limits, stop and `slack_post` one line: "Capture stopped at limit; N messages left for next run."

In `dry_run` mode: do steps 1–2.5 for real (reads only), then `log_action("dry_run:<what you would do>", gmail_msg_id, {plan})` instead of any write, and still advance `last_message_id`.
