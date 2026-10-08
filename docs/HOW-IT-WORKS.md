# The NRN Email Agent, in plain language

The agent is an assistant that watches the success@nrnglobal.ca inbox, works out which emails are real client requests, and turns them into Asana tasks so nothing gets lost. It briefs Neil in Slack every morning and takes instructions from Slack replies. It never sends email on its own.

## What it does, step by step

### Every ten minutes: read the inbox
1. It looks at any new email that arrived in success@ since the last check.
2. For each email, it asks: who is this from? It matches the sender against the client list, either by the company's email domain or by a known contact address, such as an agency person who writes on a client's behalf.
3. If the sender is a client, it reads the email and decides whether it contains an actual ask. A "thanks, looks good" is not an ask. "Can you update the landing page by Friday" is.
4. If there is an ask, it checks whether a task already exists for that email thread or that request. If so, it adds a comment to the existing task rather than creating a duplicate. If not, it creates a new task in the client's Asana project with the details and a link back to the email.
5. If the email mentions anything worrying, such as cancelling, refunds, legal language, or an unhappy tone, it flags it as an escalation, assigns the task to Neil, and posts a short alert in Slack straight away.
6. If the ask is something Neil would normally answer personally, it drafts a reply in Gmail for Neil to review. The draft is saved, not sent.
7. If the sender is not a client and has never corresponded with us, it treats the message as cold outreach and archives it with a label so it is out of the way but not deleted.
8. Everything it does, or decides not to do, is written to a log.

### Every weekday at 8:00 AM: the morning brief
It posts a summary to the #agent Slack channel: what it did overnight, anything it escalated, drafts waiting for approval, and questions it could not answer on its own, such as which client an email belongs to when the sender works with several.

### Whenever Neil replies in #agent
Short replies steer it. Examples: approve or skip a draft, tell it which client an ambiguous email belongs to, block a sender, pause the agent, or resume it. It only listens to Neil's messages in that channel.

## Dry run: the current mode

Right now the agent is in **dry run**. It reads everything and decides what it would do, but it does not create tasks, write drafts, archive anything, or post to Slack. Each decision is recorded in the log as "would have done X". This lets us check its judgement for a week before letting it act. When the decisions look right, one Slack reply switches it to live.

## Where things live

| Piece | What it is | Why it matters |
|---|---|---|
| **Google Sheet "Account list"** | The master client list. One row per client with their Asana project, email domain, extra contacts, and an optional link to a brief document. | This is the only place the client list is maintained. Edit the sheet, and the agent picks it up on the next sync. |
| **Client brief docs** | Optional Google Docs linked from a client's row, describing goals, people and scope. | The agent reads them for context when classifying or drafting. They are confidential and never quoted to clients. |
| **Asana** | Where tasks are created, one project per client. An "Agent Inbox" project catches anything it cannot place. | This is where the work shows up. |
| **Slack #agent** | The control channel. Briefs, alerts and questions appear here, and Neil's replies are instructions. | The one place you need to watch. |
| **Gmail success@** | The inbox being watched. The agent can read, label, archive and draft. It cannot send. | The no-send rule is enforced by the permissions we granted, not just by instructions. |
| **Supabase** | The agent's memory: the client list copy, settings, the activity log, and items awaiting Neil. | Useful for reviewing every decision in detail. |
| **Railway** | The computer the agent runs on, in the cloud. | Nothing to do here day to day. |

## Settings you can change without code

These live in the agent's settings table and can be changed by asking:

- **Mode**: dry run or live.
- **Allowed senders**: addresses or domains always treated as legitimate, such as Upwork.
- **Blocked senders**: notification addresses to ignore.
- **Escalation words**: the terms that trigger an immediate alert.
- **Confidence threshold**: how sure the agent must be before acting rather than asking.

## Safety rails

- It cannot send email.
- It only acts on mail in success@, nothing else.
- It only takes instructions from Neil, in one Slack channel.
- Every action is logged with a link to the email it came from.
- When unsure which client an email belongs to, it asks instead of guessing.
- Archived outreach is labelled, never deleted, so anything mis-filed can be found.

## The weekly rhythm once live

- **Daily**: read the 8:00 AM brief. Approve or skip drafts. Answer any "which client?" questions.
- **As needed**: add new clients to the sheet. Add agency contacts to the contacts column so their mail resolves.
- **Occasionally**: review the archived outreach label to confirm nothing real slipped through.

## Dates to remember

- **November 1, 2026**: clocks change. The brief schedule needs a one-line adjustment to stay at 8:00 AM.
- **June 1, 2027**: the agent's AI access key expires and needs renewing. A reminder is built into the status page from a month before.

## Who to ask

Anything about how the agent behaves, what it decided, or changing a setting: ask Claude in the project folder, which has the full history and credentials, or check the #agent channel.
