# eWise meeting report routine — design

Date: 2026-10-09. Status: approved 2026-10-09 (Neil supplied the dry-run sheet; mapping table accepted as drafted).

## Purpose

Twice a week Neil meets Philip and Justin at eWise Communications to review Google Ads performance for the eWise clients NRN manages. Before each call Neil spends about an hour pulling numbers from Google Ads and CallRail and updating an internal sheet, "EWISE Client Updates", which he reads from during the meeting. This routine does the lookup half of that hour so Neil's time goes to judgement.

Success: at 9:05 on Tuesday and Friday the sheet has a new dated block with the previous notes carried forward, the numbers filled in, Ads changes listed, a proposed health status, and new pending items appended. Nothing in the block needs undoing.

## Scope

In: one scheduled cloud routine; two new columns on the report sheet; two new columns on the client sheet; one read-only endpoint on the existing Railway service.

Out: Bing Ads data (CallRail's Bing-sourced calls stand in); Slack posts; a dashboard; any write to Google Ads, CallRail or Asana; any change to the email agent's behaviour.

## Where it runs

A Claude cloud routine (claude.ai/code/routines). Rationale: the Google Ads (CheckMyAds) and CallRail connections are claude.ai connectors, available to routines but not to the Railway service. Keeping Ads read access out of the process that reads untrusted email is also a deliberate separation.

Connectors attached: CheckMyAds-MCP, CallRail, Google-Sheets. Model: claude-sonnet-5-5. No git source; the prompt is self-contained, with a copy at `routines/ewise-report.prompt.md` in this repo for versioning.

Schedule: Tuesday and Friday 09:00 America/Toronto. Cron `0 13 * * 2,5` during EDT; move to `0 14 * * 2,5` after 2026-11-01.

## Inputs

### Client sheet ("Account list", source of truth) — two new columns
- `report_label`: the account name as it appears in the report sheet, without the "(Google)" / "(Bing)" suffix. Example: "ACS", "BIB", "Eastern", "OPS".
- `callrail_account_id`: the CallRail account id (the `ACC…` string).

eWise clients are the rows whose `contacts` include an `@ewisecommunications.com` address. Only those rows are reported.

### Report sheet ("EWISE Client Updates", Sheet1)
Columns A–H as today: Date, Account, Health Status, Updates / Discussion Items, The Bad, New Opportunities to bring up, Pending EWISE / Philip, Ref notes.
Two new columns: I `Numbers (auto)`, J `Changes (auto)`.
The latest block is the first group of rows under the header sharing one Date value. Account rows may be split "Name (Google)" / "Name (Bing)"; the routine keeps whatever split exists in the latest block.

### Railway service — new endpoint
`GET /context?asana_project_gid=<gid>&since=<ISO date>` with header `X-Status-Token`. Returns:
```json
{ "open_tasks": [{ "name", "assignee", "due_on", "modified_at", "permalink" }],
  "ewise_threads": [{ "subject", "from", "date", "snippet", "gmail_link" }] }
```
`open_tasks`: incomplete tasks in the client's Asana project, newest modified first, max 15.
`ewise_threads`: Gmail threads since `since` where any participant is an `@ewisecommunications.com` address and the thread mentions the client's name, report_label or a client domain, max 10. Read-only; reuses the existing Asana and Gmail credentials and the existing STATUS_TOKEN guard.

## Behaviour of the routine

1. Read the client sheet; keep eWise rows with a `report_label`. Warn (in a Notes cell at the bottom of the new block) about eWise rows missing a label or CallRail id.
2. Read the report sheet; find the latest block and its date D. Current window: D 09:00 → now. Prior window: same length ending at D 09:00. Also month to date vs the same days of last month.
3. Insert rows above the latest block to form the new block: today's date, same Account rows in the same order, columns C–H copied verbatim.
4. For each account row:
   - CallRail (by `callrail_account_id`, both windows): total, answered, missed, first-time callers, leads (lead_status good_lead), form submissions; grouped by source. A "(Google)" row gets the Google Ads source line; a "(Bing)" row gets Bing/Microsoft sources; an unsplit row gets all sources with the split shown.
   - Google Ads (by `google_ads_customer_id`, Google rows and unsplit rows only): spend, clicks, impressions, conversions by conversion action name, cost per conversion, daily budget sum and pacing (spend ÷ budget × days). Prior-window figures alongside.
   - Changes: `change_event` rows in the current window, summarised one per line: when, what, old → new, who.
   - Context: call `/context` with since = D; summarise open tasks and eWise threads.
5. Write per row:
   - I `Numbers (auto)`: compact multi-line text. First line CallRail, second Google Ads, third MTD vs LM. Numbers rounded; show "prev" values in brackets.
   - J `Changes (auto)`: one line per change, or "none".
   - C `Health Status`: proposed value with a trailing "?" — rules in the next section.
   - G `Pending EWISE / Philip`: existing text kept first; new items appended on new lines prefixed `+ auto: `. Items already present (same Asana permalink or same subject) are not re-added.
6. Last row of the block: a short run note (run time, windows used, rows skipped and why, any connector errors).

### Health proposal
Inputs: leads = CallRail good leads + form submissions for the row's sources; CPL = Ads spend ÷ leads (Google rows only).
- Poor: leads down more than 40 % vs prior, or spend > 0 with zero leads, or pacing below 50 %.
- Good: leads ≥ prior and CPL ≤ 1.2 × prior CPL (or no spend data for Bing rows and leads ≥ prior).
- Otherwise Okay.
Written as "Good?", "Okay?", "Poor?". Never overwrite a status Neil set in the latest block without the "?"; copy his value and then apply the proposal only in the new block.

## Failure handling
- A connector error for one account writes "unavailable: <reason>" in that row's Numbers cell and continues.
- If the report sheet's header does not match the expected columns A–J, the routine stops and writes nothing except a run note row.
- The routine never deletes or edits rows of earlier blocks.
- CallRail free tier is 1,500 calls/month shared; the routine uses summary endpoints only, roughly 3 calls per account per run.

## Testing
- Dry run once with a `DRY_RUN` instruction: the routine writes its block to a copy of the report sheet (Neil provides the copy's id) and Neil compares against his own hand-filled block.
- Endpoint: curl with the status token for one client; confirm tasks and threads match Asana and Gmail by eye.
- First two live runs reviewed by Neil before the meeting; corrections go into the prompt copy in the repo and then into the routine.

## Open items for Neil
- Fill `report_label` and `callrail_account_id` on the client sheet (Claude prefills, Neil checks).
- Dry-run sheet (copy of the report sheet): 1AIBgsAZE2_T_bIIaIdgzNL8qIM6-1QWDBzb7NjNmKx4. Live sheet: 1JKZ0JR4Tg22VxoVk07ctxzDJnsyO2109SvcF7rMxxBc.
- Label mapping (report_label → client): ACS→American Crawlspace Solutions, BIB→Best in Bakyards, Eastern→Eastern Jungle Gym (no CallRail), Georgia Gas→Georgia Gas, IMS→IMS, Li-Fire→Li-Fire, NPDES→NPDES, OPS→Optimum Pediatric Services, Piedmont→Piedmont Enclosures, Steven's Aerospace→Steven's Aerospace, The Timbers→The Timbers, Big Canoe→Big Canoe.
