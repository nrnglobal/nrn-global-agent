# eWise Meeting Report Routine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Twice a week, a scheduled Claude cloud routine adds a new dated block to Neil's "EWISE Client Updates" sheet with notes carried forward, CallRail and Google Ads numbers, Ads change history, a proposed health status, and pending items from Asana and eWise email.

**Architecture:** The routine runs in Claude's cloud with the CheckMyAds, CallRail and Google Sheets connectors and a self-contained prompt. The existing Railway service gains one read-only endpoint, `GET /context`, that returns open Asana tasks and eWise email threads for a client, guarded by the existing STATUS_TOKEN. The client sheet gains two mapping columns.

**Tech Stack:** TypeScript (Node 22, Express, googleapis) for the endpoint; vitest for its unit tests; Claude cloud routine (RemoteTrigger API) for the schedule; Google Sheets for I/O.

**Spec:** `docs/superpowers/specs/2026-10-09-ewise-report-routine-design.md`

## Global Constraints

- Endpoint is read-only: no Asana, Gmail, Sheets or Supabase writes. Reuses `auth` from `src/tools/gmail.ts` and `asana()` from `src/tools/asana_slack.ts`.
- Endpoint guard: header `X-Status-Token` equal to `process.env.STATUS_TOKEN`, same `statusGuard` as `/status`.
- Routine never edits rows of earlier blocks; never writes to Google Ads, CallRail or Asana.
- Routine attaches exactly: CheckMyAds-MCP, CallRail, Google-Sheets. Model `claude-sonnet-5-5`. No git source.
- Schedule `0 13 * * 2,5` UTC (09:00 Toronto, EDT). Note in README: change to `0 14` after 2026-11-01.
- Report sheet columns: A Date, B Account, C Health Status, D Updates / Discussion Items, E The Bad, F New Opportunities to bring up, G Pending EWISE / Philip, H Ref notes, I Numbers (auto), J Changes (auto).
- Dry-run sheet id `1AIBgsAZE2_T_bIIaIdgzNL8qIM6-1QWDBzb7NjNmKx4`; live sheet id `1JKZ0JR4Tg22VxoVk07ctxzDJnsyO2109SvcF7rMxxBc`; client sheet id `1hF8_DzfAInRd-C4Pac74fS2cOOdpkpzlFxZs1mcfQsM`, tab `Account list`.
- Health labels written as `Good?`, `Okay?`, `Poor?`.

## Review Focus

- A report-sheet row whose Account label has no matching `report_label` on the client sheet: expected the row is still carried forward, its Numbers cell says `no client mapping for "<label>"`, and the run continues. Tested in Task 4 (dry run check 3).
- A `(Bing)` row for a client whose CallRail has no Bing-sourced calls in the window: expected `0 calls` rather than an error or a Google figure. Tested in Task 4 (dry run check 4).
- Gmail threads where eWise staff are only in Cc, not From: expected they count as eWise threads. Tested in Task 2 (`isEwiseThread` test).
- `/context` called with a `since` date in the future or malformed: expected HTTP 400 with a reason, not a Gmail query error. Tested in Task 2.
- The latest block spans two Date values because Neil edited a date by hand: expected the routine uses the first Date value under the header and only rows contiguous with it. Tested in Task 4 (dry run check 2).

---

### Task 1: Client sheet mapping columns

**Files:**
- Modify: Google Sheet `Account list` (columns M and N), via the Google Sheets connector.
- Modify: `README.md` (Clients sheet section).

**Interfaces:**
- Produces: `report_label` and `callrail_account_id` columns the routine reads by header name.

- [ ] **Step 1: Read the header row to confirm columns M and N are free**

Use `mcp__claude_ai_Google_Sheets__get_values` with range `'Account list'!A1:P1`. Expected: 12 headers ending in `contacts`, `associated_domains`? Note the actual order; the sync is header-based so position does not matter, but the two new headers must not collide.

- [ ] **Step 2: Write the headers and values**

Use `mcp__claude_ai_Google_Sheets__update_values` on `'Account list'!M1:N26` with these rows (row order from the current sheet; empty strings for non-eWise rows):

| Row | client_name | report_label | callrail_account_id |
|---|---|---|---|
| 1 | header | report_label | callrail_account_id |
| 2 | SS&C Black Diamond, Mineralware | | |
| 3 | SS&C AMALT | | |
| 4 | American Crawlspace Solutions | ACS | ACC774957f843be46579ab0a1916a5b60c7 |
| 5 | Green Side Contracting | | ACCbf550f94863e473ab438023a025edab2 |
| 6 | The Timbers | The Timbers | ACCd663d966d7814f54ae5bc407f3c1fc2a |
| 7 | Delos Psychiatry | | ACC019ec816f08377a3906142782a22fb38 |
| 8 | Georgia Gas | Georgia Gas | ACCf67cbd2d9eb846fab12288f330d7f1e8 |
| 9 | Piedmont Enclosures | Piedmont | ACC01988b46c40d74d4afb6a08d9d2835af |
| 10 | Steven's Aerospace | Steven's Aerospace | ACCcd75753e7f154e389651a8e049c730a6 |
| 11 | Ultimate Print Finishings | Ultimate Print | |
| 12 | NPDES | NPDES | ACC01988b5a0f41745d9031b5592a113138 |
| 13 | Optimum Pediatric Services | OPS | ACC019eb80433d073019fb339fd72392cab |
| 14 | Big Canoe | Big Canoe | ACC01a034298bd870dd88d7efff75aeee41 |
| 15 | Best in Bakyards | BIB | ACC3505c439668b443da6b9fc0cffa67f28 |
| 16 | Eastern Jungle Gym | Eastern | |
| 17 | Glasshouse Media | | |
| 18 | Palmview | | |
| 19 | Unilux CRFC | | |
| 20 | Unilux Suite Solutions | | |
| 21 | Carvolth dentistry | | ACC01983e7320ca73d3af0942f2849d4496 |
| 22 | Holland Nameplate | | |
| 23 | IMS | IMS | ACC0198ae588d7c7a58a6015efae2950ba8 |
| 24 | Modern Nun | | |
| 25 | Li-Fire | Li-Fire | ACC01988b0212707ec4881f94835b221bb3 |
| 26 | Silverlake Bike | | |

Before writing, re-read `'Account list'!A2:A26` and confirm the client names are in this order; if Neil has reordered rows, build the two columns by matching on client_name instead of position.

- [ ] **Step 3: Verify the sync still passes**

Run:
```bash
RT="$(grep '^RUN_TOKEN=' .env | cut -d= -f2-)"; curl -s -X POST -H "X-Run-Token: $RT" "https://nrn-global-agent-production.up.railway.app/run/sync-clients?dry_run=1" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["synced"], d["skipped"], d["warnings"])'
```
Expected: `25 [] []`.

- [ ] **Step 4: Document the columns in README**

In `README.md`, Clients sheet section, after the `website_domain` / `associated_domains` bullet add:
```
- `report_label`: the short account name used in the eWise report sheet (e.g. `ACS`, `OPS`). `callrail_account_id`: the CallRail account id (`ACC…`). Both are read only by the eWise report routine (see `routines/`), not by the email agent.
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: report_label and callrail_account_id columns"
```

---

### Task 2: Pure helpers for the context endpoint, with tests

**Files:**
- Create: `src/tools/context.ts`
- Create: `test/context.test.ts`
- Modify: `package.json` (add vitest, `test` script)

**Interfaces:**
- Produces:
  - `isEwiseThread(participants: string[]): boolean`
  - `mentionsClient(text: string, client: { client_name: string; report_label?: string | null; domains: string[] }): boolean`
  - `parseSince(s: string | undefined, now?: Date): { ok: true; date: Date } | { ok: false; reason: string }`
  - `shapeTask(t: AsanaTask): ContextTask` where `AsanaTask = { gid: string; name: string; assignee?: { name: string } | null; due_on?: string | null; modified_at: string; permalink_url: string }` and `ContextTask = { name: string; assignee: string | null; due_on: string | null; modified_at: string; permalink: string }`

- [ ] **Step 1: Install vitest and add the script**

```bash
npm i -D vitest@^2
```
In `package.json` scripts add `"test": "vitest run"`. Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
```

- [ ] **Step 2: Write the failing tests**

`test/context.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isEwiseThread, mentionsClient, parseSince, shapeTask } from "../src/tools/context.js";

describe("isEwiseThread", () => {
  it("is true when any participant is at ewisecommunications.com, including Cc", () => {
    expect(isEwiseThread(["neil@nrnglobal.ca", "lnye@ewisecommunications.com"])).toBe(true);
    expect(isEwiseThread(["Neil <success@nrnglobal.ca>", "Philip <PSanders@EwiseCommunications.com>"])).toBe(true);
  });
  it("is false otherwise", () => {
    expect(isEwiseThread(["neil@nrnglobal.ca", "dave@glasshousemedia.com"])).toBe(false);
  });
});

describe("mentionsClient", () => {
  const client = { client_name: "Optimum Pediatric Services", report_label: "OPS", domains: ["optimumpediatrics.com"] };
  it("matches the client name, label as a word, or a domain, case-insensitively", () => {
    expect(mentionsClient("Re: optimum pediatric services night nurse", client)).toBe(true);
    expect(mentionsClient("OPS: new LP", client)).toBe(true);
    expect(mentionsClient("see https://optimumpediatrics.com/night-nurse", client)).toBe(true);
  });
  it("does not match the label inside another word", () => {
    expect(mentionsClient("Loops and hoops", client)).toBe(false);
  });
});

describe("parseSince", () => {
  const now = new Date("2026-10-09T13:00:00Z");
  it("accepts an ISO date in the past", () => {
    const r = parseSince("2026-10-06", now);
    expect(r.ok && r.date.toISOString()).toBe("2026-10-06T00:00:00.000Z");
  });
  it("rejects missing, malformed, and future values", () => {
    expect(parseSince(undefined, now).ok).toBe(false);
    expect(parseSince("yesterday", now).ok).toBe(false);
    expect(parseSince("2026-10-10", now).ok).toBe(false);
  });
});

describe("shapeTask", () => {
  it("flattens an Asana task to the context shape", () => {
    expect(shapeTask({ gid: "1", name: "Fix LP", assignee: { name: "Neil" }, due_on: "2026-10-14", modified_at: "2026-10-08T12:00:00Z", permalink_url: "https://app.asana.com/0/1/1" }))
      .toEqual({ name: "Fix LP", assignee: "Neil", due_on: "2026-10-14", modified_at: "2026-10-08T12:00:00Z", permalink: "https://app.asana.com/0/1/1" });
    expect(shapeTask({ gid: "2", name: "x", modified_at: "2026-10-08T12:00:00Z", permalink_url: "u" }).assignee).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, "Cannot find module '../src/tools/context.js'".

- [ ] **Step 4: Write the helpers**

`src/tools/context.ts` (helpers only; the endpoint handler is added in Task 3):
```ts
// Read-only context for the eWise report routine: open Asana tasks and eWise email threads for one client.
// Pure helpers live at the top so they can be unit-tested without network access.

export type AsanaTask = { gid: string; name: string; assignee?: { name: string } | null; due_on?: string | null; modified_at: string; permalink_url: string };
export type ContextTask = { name: string; assignee: string | null; due_on: string | null; modified_at: string; permalink: string };
export type ClientRef = { client_name: string; report_label?: string | null; domains: string[] };

const EWISE = /@ewisecommunications\.com\b/i;

export function isEwiseThread(participants: string[]): boolean {
  return participants.some((p) => EWISE.test(p));
}

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export function mentionsClient(text: string, client: ClientRef): boolean {
  const t = text.toLowerCase();
  if (t.includes(client.client_name.toLowerCase())) return true;
  if (client.domains.some((d) => t.includes(d.toLowerCase()))) return true;
  if (client.report_label) return new RegExp(`\\b${escapeRe(client.report_label.toLowerCase())}\\b`).test(t);
  return false;
}

export function parseSince(s: string | undefined, now = new Date()): { ok: true; date: Date } | { ok: false; reason: string } {
  if (!s) return { ok: false, reason: "since is required (ISO date)" };
  if (!/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(s)) return { ok: false, reason: "since must be an ISO date like 2026-10-06" };
  const date = new Date(s);
  if (Number.isNaN(date.getTime())) return { ok: false, reason: "since is not a valid date" };
  if (date.getTime() > now.getTime()) return { ok: false, reason: "since is in the future" };
  return { ok: true, date };
}

export function shapeTask(t: AsanaTask): ContextTask {
  return { name: t.name, assignee: t.assignee?.name ?? null, due_on: t.due_on ?? null, modified_at: t.modified_at, permalink: t.permalink_url };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: 8 passed.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts test/context.test.ts src/tools/context.ts
git commit -m "feat: context helpers with tests"
```

---

### Task 3: `GET /context` endpoint

**Files:**
- Modify: `src/tools/context.ts` (append `clientContext`)
- Modify: `src/index.ts` (route, next to `/status`)
- Modify: `README.md` (Status endpoint section)

**Interfaces:**
- Consumes: helpers from Task 2; `auth` from `src/tools/gmail.ts`; `asana(path)` from `src/tools/asana_slack.ts` (returns parsed JSON `{ data: ... }`); `db` from `src/tools/db.ts`.
- Produces: `clientContext(asana_project_gid: string, since: Date): Promise<{ client: ClientRef & { asana_project_gid: string }; open_tasks: ContextTask[]; ewise_threads: ContextThread[] }>` where `ContextThread = { subject: string; from: string; date: string; snippet: string; gmail_link: string }`.

- [ ] **Step 1: Append the loader to `src/tools/context.ts`**

```ts
import { google } from "googleapis";
import { db } from "./db.js";
import { auth } from "./gmail.js";
import { asana } from "./asana_slack.js";

export type ContextThread = { subject: string; from: string; date: string; snippet: string; gmail_link: string };
const gmail = google.gmail({ version: "v1", auth });
const USER = process.env.GMAIL_USER ?? "me";

export async function clientContext(asana_project_gid: string, since: Date) {
  const { data: row } = await db.from("agent_clients").select("client_name,domains").eq("asana_project_gid", asana_project_gid).maybeSingle();
  if (!row) throw Object.assign(new Error("unknown client"), { status: 404 });
  // report_label is a sheet-only column; read it from the sheet so the endpoint has no new DB dependency.
  const sheets = google.sheets({ version: "v4", auth });
  const { data: sh } = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.CLIENTS_SHEET_ID!, range: `'${process.env.CLIENTS_SHEET_TAB ?? "Account list"}'`, valueRenderOption: "UNFORMATTED_VALUE" });
  const [hdr, ...rows] = sh.values ?? [];
  const gidCol = hdr.indexOf("asana_project_gid"), labelCol = hdr.indexOf("report_label");
  const sheetRow = rows.find((r) => String(r[gidCol] ?? "").replace(/\D/g, "") === asana_project_gid);
  const client: ClientRef & { asana_project_gid: string } = { asana_project_gid, client_name: row.client_name, domains: row.domains ?? [], report_label: labelCol >= 0 ? (sheetRow?.[labelCol] ? String(sheetRow[labelCol]) : null) : null };

  const tasks = await asana(`/tasks?project=${asana_project_gid}&completed_since=now&opt_fields=name,assignee.name,due_on,modified_at,permalink_url&limit=50`);
  const open_tasks: ContextTask[] = ((tasks.data ?? []) as AsanaTask[])
    .sort((a, b) => b.modified_at.localeCompare(a.modified_at)).slice(0, 15).map(shapeTask);

  const after = Math.floor(since.getTime() / 1000);
  const { data: list } = await gmail.users.messages.list({ userId: USER, q: `after:${after} ewisecommunications.com`, maxResults: 60 });
  const seen = new Set<string>(); const ewise_threads: ContextThread[] = [];
  for (const m of list.messages ?? []) {
    const { data: full } = await gmail.users.messages.get({ userId: USER, id: m.id!, format: "metadata", metadataHeaders: ["From", "To", "Cc", "Subject", "Date"] });
    if (seen.has(full.threadId!)) continue;
    const h = Object.fromEntries((full.payload?.headers ?? []).map((x) => [x.name!.toLowerCase(), x.value ?? ""]));
    const participants = `${h.from},${h.to ?? ""},${h.cc ?? ""}`.split(",");
    if (!isEwiseThread(participants)) continue;
    if (!mentionsClient(`${h.subject} ${full.snippet ?? ""}`, client)) continue;
    seen.add(full.threadId!);
    ewise_threads.push({ subject: h.subject ?? "", from: h.from ?? "", date: h.date ?? "", snippet: (full.snippet ?? "").slice(0, 200), gmail_link: `https://mail.google.com/mail/u/0/#all/${full.threadId}` });
    if (ewise_threads.length >= 10) break;
  }
  return { client, open_tasks, ewise_threads };
}
```

- [ ] **Step 2: Add the route in `src/index.ts`**

After the `/status` route:
```ts
// Read-only context for the eWise report routine: open Asana tasks + eWise email threads for one client since a date.
app.get("/context", statusGuard, async (req, res) => {
  const since = parseSince(typeof req.query.since === "string" ? req.query.since : undefined);
  if (!since.ok) return res.status(400).json({ error: since.reason });
  const gid = String(req.query.asana_project_gid ?? "").replace(/\D/g, "");
  if (!gid) return res.status(400).json({ error: "asana_project_gid is required" });
  try { res.json(await clientContext(gid, since.date)); }
  catch (e: any) { res.status(e.status ?? 500).json({ error: e.message }); }
});
```
Add the import: `import { clientContext, parseSince } from "./tools/context.js";`

- [ ] **Step 3: Typecheck, build, run tests**

Run: `npx tsc --noEmit && npm run build && npm test`
Expected: no type errors; 8 passed.

- [ ] **Step 4: Deploy and verify by hand**

```bash
git add -A && git commit -m "feat: GET /context for the report routine" && git push
~/.npm-global/bin/railway up --detach
```
Wait for the deployment to be SUCCESS (`~/.npm-global/bin/railway deployment list`). Then:
```bash
ST="$(grep '^STATUS_TOKEN=' .env | cut -d= -f2-)"
curl -s -H "X-Status-Token: $ST" "https://nrn-global-agent-production.up.railway.app/context?asana_project_gid=1214730271812063&since=2026-10-02" | python3 -m json.tool | head -60
curl -s -o /dev/null -w '%{http_code}\n' -H "X-Status-Token: $ST" "https://nrn-global-agent-production.up.railway.app/context?asana_project_gid=1214730271812063&since=tomorrow"
curl -s -o /dev/null -w '%{http_code}\n' "https://nrn-global-agent-production.up.railway.app/context?asana_project_gid=1214730271812063&since=2026-10-02"
```
Expected: IMS context JSON with `open_tasks` and `ewise_threads` arrays; `400`; `401`.

- [ ] **Step 5: Document in README**

Under "Status endpoint" add:
```
`GET /context?asana_project_gid=<gid>&since=<YYYY-MM-DD>` (same `X-Status-Token`) returns a client's open Asana tasks (max 15) and eWise email threads since the date that mention the client (max 10). Read-only; used by the eWise report routine.
```
Commit: `git add README.md && git commit -m "docs: /context endpoint" && git push`.

---

### Task 4: Routine prompt, report sheet columns, and dry run

**Files:**
- Create: `routines/ewise-report.prompt.md`
- Modify: dry-run sheet and live sheet header row (columns I and J), via Google Sheets connector.

**Interfaces:**
- Consumes: `/context` from Task 3; mapping columns from Task 1.
- Produces: the prompt text used verbatim in Task 5.

- [ ] **Step 1: Add the two auto columns to both report sheets**

`mcp__claude_ai_Google_Sheets__update_values` on `Sheet1!I1:J1` with `[["Numbers (auto)", "Changes (auto)"]]`, first on the dry-run sheet `1AIBgsAZE2_T_bIIaIdgzNL8qIM6-1QWDBzb7NjNmKx4`, then on the live sheet `1JKZ0JR4Tg22VxoVk07ctxzDJnsyO2109SvcF7rMxxBc`.

- [ ] **Step 2: Write the prompt file**

`routines/ewise-report.prompt.md`, used verbatim as the routine's message. The two placeholders `{{REPORT_SHEET_ID}}` and `{{STATUS_TOKEN}}` are substituted when creating the routine (Task 5); nothing else changes between dry run and live.

````markdown
You are preparing Neil's internal notes sheet for his twice-weekly meeting with Philip and Justin at eWise Communications. Neil manages Google Ads for eWise's clients. You add one new dated block to the sheet; Neil edits it before the call. Work carefully, write nothing outside the new block, and never change Google Ads, CallRail or Asana.

## Sheets
- Report sheet: spreadsheet id {{REPORT_SHEET_ID}}, tab Sheet1. Columns: A Date, B Account, C Health Status, D Updates / Discussion Items, E The Bad, F New Opportunities to bring up, G Pending EWISE / Philip, H Ref notes, I Numbers (auto), J Changes (auto). Row 1 is the header. If the header row does not match these ten names, stop and write one row after the header: A today's date, B "ROUTINE STOPPED", D the mismatch.
- Client sheet: spreadsheet id 1hF8_DzfAInRd-C4Pac74fS2cOOdpkpzlFxZs1mcfQsM, tab "Account list". Read every column. Keep only rows where `active` is Yes/TRUE, `contacts` contains an @ewisecommunications.com address, and `report_label` is not blank. Each row gives `report_label`, `google_ads_customer_id` (may list two ids comma-separated; use the first), `callrail_account_id`, `asana_project_gid`, `client_name`, `website_domain`.

## Find the latest block and the windows
1. Read Sheet1!A2:J60. The latest block starts at row 2 and continues while column A equals the row-2 Date value (contiguous rows only). Call that date D and the rows R.
2. Now = the current time in America/Toronto. Current window: D 09:00 America/Toronto → now. Prior window: the same length ending at D 09:00. Month-to-date window: 1st of the current month → now; last-month comparison: 1st of last month → the same day and time last month.
3. Format dates for CallRail and Google Ads as YYYY-MM-DD; both tools work on whole days, so use D as the start date of the current window and the prior window's start/end dates likewise. Say in the run note that windows are whole days.

## Insert the new block
4. Insert len(R)+1 empty rows at row 2 (use the Sheets insert-dimension tool, ROWS, startIndex 1). Rows 2..(2+len(R)-1) become the new block; the extra row is the run note.
5. For each row of R, write into the new block at the same offset: A = today's date formatted like "October 9 2026"; B..H copied exactly from R; I and J blank for now.

## Per account row
For each new-block row, let label = column B with any trailing " (Google)" or " (Bing)" removed, and kind = Google, Bing, or All.
6. Find the client row whose `report_label` equals label (case-insensitive). If none: I = `no client mapping for "<label>"`, leave C as copied, continue.
7. CallRail (skip if `callrail_account_id` blank; then I's first line is "CallRail: none"): call get_calls_summary with account_id, start_date/end_date for the current window, direction inbound, fields total_calls,missed_calls,answered_calls,first_time_callers,leads, group_by source, time_zone America/New_York. Repeat for the prior window. Also get_forms_summary for both windows if available. Sources: a Google row uses the "Google Ads" (and "Google Ads Extension"/"Google Paid") groups; a Bing row uses groups whose key contains "Bing" or "Microsoft"; an All row uses the totals and lists the top sources. Compute leads = leads + form submissions for the chosen sources.
8. Google Ads (Google and All rows only; skip for Bing rows): run_gaql_query with customer_id = google_ads_customer_id, login_customer_id 7100247186:
   - `SELECT campaign.name, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, campaign_budget.amount_micros FROM campaign WHERE segments.date BETWEEN '<start>' AND '<end>' AND campaign.status = 'ENABLED'` for current, prior, MTD and last-month windows.
   - `SELECT segments.conversion_action_name, metrics.conversions FROM campaign WHERE segments.date BETWEEN '<start>' AND '<end>' AND metrics.conversions > 0` for the current window.
   - `SELECT change_event.change_date_time, change_event.change_resource_type, change_event.resource_change_operation, change_event.changed_fields, change_event.user_email, change_event.old_resource, change_event.new_resource FROM change_event WHERE change_event.change_date_time >= '<start> 00:00:00' AND change_event.change_date_time <= '<end> 23:59:59' ORDER BY change_event.change_date_time DESC LIMIT 100`.
   Spend = cost_micros/1e6. Pacing = spend ÷ (sum of daily budgets × days in window). Conversions that are not calls or forms (e.g. "Time on Site") are listed but not counted as leads.
9. Context: GET https://nrn-global-agent-production.up.railway.app/context?asana_project_gid=<gid>&since=<D as YYYY-MM-DD> with header X-Status-Token: {{STATUS_TOKEN}}. If the request fails, note it in I and continue.

## Write the row
10. I (Numbers (auto)), three lines, prior-window values in brackets:
    `CallRail: 7 calls (5) · 5 answered · 2 missed · 3 first-time · 2 leads (1) · 1 form (0)`
    `Ads: $578 (535) · 18 clicks (21) · conv 8 (11) = Time on Site 8 · CPL $289 · pacing 92%`
    `MTD: $1,920 vs LM-to-date $1,760 · leads 6 vs 5`
    Use "Ads: n/a" on Bing rows and "CallRail: none" when there is no account. Round money to whole dollars.
11. J (Changes (auto)): one line per change event, newest first: `Oct 6 13:05 Residential: bidding Manual CPC → Max conversions tCPA $44 (neil@nrnglobal.ca)`; or `none`.
12. C (Health Status): propose from leads and CPL of the current vs prior window. Poor? when leads fell more than 40%, or spend > 0 with zero leads, or pacing < 50%. Good? when leads ≥ prior and CPL ≤ 1.2 × prior CPL (Bing rows: leads ≥ prior). Otherwise Okay?. Always end with "?".
13. G (Pending EWISE / Philip): keep the copied text, then append on new lines `+ auto: <task name> (<assignee>, due <due_on>)` for each open task and `+ auto: email <date> <subject>` for each eWise thread. Do not append an item whose task name or subject already appears in the cell.

## Finish
14. Run-note row (the last row of the new block): A today's date, B "run note", D: run time, the windows used, rows skipped and why, any tool errors. Nothing else.
15. Do not touch rows below the new block. Do not write to any other sheet or tab.
````

- [ ] **Step 3: Commit the prompt**

```bash
git add routines/ewise-report.prompt.md
git commit -m "feat: eWise report routine prompt"
git push
```

- [ ] **Step 4: Dry run in this session**

Before creating the cloud routine, execute the prompt once here against the dry-run sheet using the same connectors (`mcp__claude_ai_Google_Sheets__*`, `mcp__claude_ai_CallRail__*`, `mcp__claude_ai_CheckMyAds_MCP__run_gaql_query`) and curl for `/context`. Substitute `{{REPORT_SHEET_ID}}` = `1AIBgsAZE2_T_bIIaIdgzNL8qIM6-1QWDBzb7NjNmKx4` and the real STATUS_TOKEN.

Then check, reading the dry-run sheet back:
1. A new block exists at row 2 with today's date, the same accounts in the same order as the block below, and columns C–H copied verbatim except C's "?" suffix and G's appended lines.
2. The block below (October 6) is byte-identical to before the run (compare `A..J` of the old rows against a copy taken before the run).
3. Temporarily add a row "Zzz Test" to the October 6 block of the dry-run sheet before the run: its new-block I cell reads `no client mapping for "Zzz Test"`. Remove the test row afterwards.
4. A `(Bing)` row for a client with no Bing calls shows `0 calls` in I, not an error.
5. Neil compares the IMS row to his own October 6 hand-filled row and to the numbers from the October 9 session summary (5 calls, $578, 8 conversions all Time on Site).

Record what needed correcting in the prompt, fix the prompt file, and commit.

---

### Task 5: Create the cloud routine, verify one real run, enable the schedule

**Files:**
- Modify: `routines/ewise-report.prompt.md` (only if the dry run found corrections)
- Modify: `README.md` (new "eWise report routine" section)
- Modify: memory file `agent-deployment-state.md`

**Interfaces:**
- Consumes: prompt from Task 4; connector uuids from the schedule skill listing: CheckMyAds-MCP `edfb45c6-1c55-4d11-8495-c0877491937e`, CallRail `5175fa9c-0ea0-4738-aabf-212e1cb1161c`, Google-Sheets `abb09bd0-b9cd-4440-9131-722aadefe593`; environment `env_012iqNMBXjhi29j5cZxM6kUJ`.

- [ ] **Step 1: Create the routine disabled, pointed at the dry-run sheet**

Load `RemoteTrigger` (`ToolSearch select:RemoteTrigger`). Create with `enabled: false`, `cron_expression: "0 13 * * 2,5"`, model `claude-sonnet-5-5`, `allowed_tools: ["Bash","Read"]` plus the three `mcp_connections`, no `sources`, and the prompt from Task 4 with `{{REPORT_SHEET_ID}}` = dry-run id and `{{STATUS_TOKEN}}` = the real token. Generate a fresh lowercase v4 uuid for the event.

- [ ] **Step 2: Run it once now and inspect**

`RemoteTrigger {action: "run"}`, then `list_runs` and `get_run_log`. Expected: the run completes; the dry-run sheet gains a second new block at row 2 (above the one from Task 4). Read it back and compare I and J for IMS against Task 4's block: same numbers.

If the run log shows a connector or permission denial, fix (connector not attached, token wrong) and re-run before continuing.

- [ ] **Step 3: Switch to the live sheet and enable**

`RemoteTrigger {action: "update"}` with the prompt re-substituted for the live sheet id `1JKZ0JR4Tg22VxoVk07ctxzDJnsyO2109SvcF7rMxxBc` and `enabled: true`. Confirm with `get` that `cron_expression` is `0 13 * * 2,5` and enabled is true. Output the link `https://claude.ai/code/routines/<id>`.

- [ ] **Step 4: Document**

README, new section:
```
## eWise report routine
A Claude cloud routine (claude.ai/code/routines) runs Tuesday and Friday 09:00 America/Toronto (cron `0 13 * * 2,5` UTC in EDT; change to `0 14` after 2026-11-01). It reads the client sheet, CallRail and Google Ads through claude.ai connectors and `/context` on this service, and adds a dated block to the "EWISE Client Updates" sheet. Prompt: `routines/ewise-report.prompt.md` (edit there, then paste into the routine). It never writes to Ads, CallRail or Asana.
```
Memory: add to `agent-deployment-state.md` the routine id, the two sheet ids, and the November cron change.

- [ ] **Step 5: Commit**

```bash
git add README.md routines/
git commit -m "docs: eWise report routine"
git push
```

- [ ] **Step 6: First live run review**

After the first scheduled run (next Tuesday or Friday), Neil reviews the block before the meeting. Corrections go into `routines/ewise-report.prompt.md`, then into the routine via `RemoteTrigger update`.
