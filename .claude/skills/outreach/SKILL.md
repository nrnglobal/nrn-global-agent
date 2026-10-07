---
name: outreach
description: Classify mail from non-clients and bin cold outreach. Used by capture for any sender with no client match and no prior correspondence.
---

# Outreach

Given one message from an unknown sender:

1. `gmail_sent_to(domain)` and `gmail_thread_history`. Any prior contact → treat as `unknown-known` in capture, not here.
2. Classify: `{category: cold_outreach|vendor_notification|personal|prospect|newsletter|other, confidence, reason}`.
   Weight these signals for cold_outreach: sender domain differs from the company named in the body; single-letter or random local part; no List-Unsubscribe header; "reply <word>" CTA; follow-up-sequence language ("quick follow-up", "bumping this"); generic reference to the agency ("I saw NRN Global is a…"); offer of a free trial or call with no prior relationship.
3. Act:
   - `cold_outreach` ≥ `outreach_threshold` → `gmail_label(Agent/Cold Outreach, archive=true)`; if `report_spam` is true and confidence ≥ 0.95, `gmail_report_spam` instead. `log_action("outreach_archived")`.
   - `cold_outreach` below threshold → `gmail_label(Agent/Cold Outreach, archive=false)`, `pending_upsert(kind=outreach_maybe, code=next E-code, summary="<sender> — <subject>")`. It shows in the brief for Neil to confirm.
   - `prospect` (wants Google Ads help, mentions budget, referral, or a specific site) → never bin. `asana_create_task` in Agent Inbox assigned to Neil, `pending_upsert(kind=lead, code=next D-code)`, `slack_post(tag_neil=true)` one line. Tier 2 draft is allowed.
   - `newsletter` → `gmail_label(Agent/Skipped, archive=true)`.
   - `vendor_notification`, `personal`, `other` → `gmail_label(Agent/Skipped)` without archiving; leave in inbox.
4. Always `log_action` with the category, confidence and reason.
