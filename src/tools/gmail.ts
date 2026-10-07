import { google } from "googleapis";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// Scopes: gmail.modify covers read, label, archive, draft. Deliberately NOT gmail.send.
// spreadsheets.readonly is for the clients sheet sync (tools/sheet.ts).
export const auth =new google.auth.OAuth2(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET);
auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
const gmail = google.gmail({ version: "v1", auth });
const USER = process.env.GMAIL_USER ?? "me";

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

const LABELS = ["Agent/Captured", "Agent/Cold Outreach", "Agent/Draft Ready", "Agent/Skipped"];
let labelCache: Record<string, string> | null = null;
async function labelId(name: string) {
  if (!labelCache) {
    const { data } = await gmail.users.labels.list({ userId: USER });
    labelCache = Object.fromEntries((data.labels ?? []).map((l) => [l.name!, l.id!]));
    for (const n of LABELS) if (!labelCache[n]) {
      const { data: l } = await gmail.users.labels.create({ userId: USER, requestBody: { name: n, labelListVisibility: "labelShow", messageListVisibility: "show" } });
      labelCache[n] = l.id!;
    }
  }
  return labelCache[name];
}

function header(h: { name?: string | null; value?: string | null }[] | undefined, name: string) {
  return h?.find((x) => x.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}
function bodyText(payload: any): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) return Buffer.from(payload.body.data, "base64").toString("utf8");
  for (const p of payload.parts ?? []) { const t = bodyText(p); if (t) return t; }
  if (payload.mimeType === "text/html" && payload.body?.data)
    return Buffer.from(payload.body.data, "base64").toString("utf8").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  return "";
}

export const gmailTools = [
  tool("gmail_list_new", "List inbox messages newer than a message ID (or the last 48h if none). Returns id, threadId, from, subject, date.",
    { after_message_id: z.string().nullable().optional(), max: z.number().default(50) },
    async ({ after_message_id, max }) => {
      let q = "in:inbox";
      if (after_message_id) {
        const { data } = await gmail.users.messages.get({ userId: USER, id: after_message_id, format: "minimal" });
        q += ` after:${Math.floor(Number(data.internalDate) / 1000)}`;
      } else q += " newer_than:2d";
      const { data } = await gmail.users.messages.list({ userId: USER, q, maxResults: max });
      const out = [];
      for (const m of data.messages ?? []) {
        if (m.id === after_message_id) continue;
        const { data: full } = await gmail.users.messages.get({ userId: USER, id: m.id!, format: "metadata", metadataHeaders: ["From", "Subject", "Date", "Cc"] });
        const h = full.payload?.headers;
        out.push({ id: m.id, threadId: full.threadId, from: header(h, "From"), cc: header(h, "Cc"), subject: header(h, "Subject"), date: header(h, "Date"), internalDate: full.internalDate });
      }
      out.sort((a, b) => Number(a.internalDate) - Number(b.internalDate));
      return text(JSON.stringify(out));
    }),

  tool("gmail_get", "Get one message: headers, plain-text body (truncated to 6000 chars), attachments list, and a permalink.",
    { message_id: z.string() },
    async ({ message_id }) => {
      const { data } = await gmail.users.messages.get({ userId: USER, id: message_id, format: "full" });
      const h = data.payload?.headers;
      const attachments = (data.payload?.parts ?? []).filter((p: any) => p.filename).map((p: any) => ({ filename: p.filename, size: p.body?.size }));
      return text(JSON.stringify({
        id: data.id, threadId: data.threadId, from: header(h, "From"), to: header(h, "To"), cc: header(h, "Cc"),
        subject: header(h, "Subject"), date: header(h, "Date"),
        unsubscribe: !!header(h, "List-Unsubscribe"),
        body: bodyText(data.payload).slice(0, 6000), attachments,
        permalink: `https://mail.google.com/mail/u/0/#inbox/${data.threadId}`,
      }));
    }),

  tool("gmail_thread_history", "Has this mailbox ever replied in this thread, and how many messages does it hold?",
    { thread_id: z.string() },
    async ({ thread_id }) => {
      const { data } = await gmail.users.threads.get({ userId: USER, id: thread_id, format: "metadata", metadataHeaders: ["From"] });
      const msgs = data.messages ?? [];
      const replied = msgs.some((m) => header(m.payload?.headers, "From").toLowerCase().includes(USER.toLowerCase()));
      return text(JSON.stringify({ message_count: msgs.length, we_replied: replied }));
    }),

  tool("gmail_sent_to", "Has this mailbox ever sent mail to this address or domain (last 2 years)?",
    { address_or_domain: z.string() },
    async ({ address_or_domain }) => {
      const { data } = await gmail.users.messages.list({ userId: USER, q: `in:sent to:${address_or_domain} newer_than:2y`, maxResults: 1 });
      return text(JSON.stringify({ sent_before: (data.messages?.length ?? 0) > 0 }));
    }),

  tool("gmail_recent_sent_to", "Last N messages this mailbox sent to an address (for matching Neil's voice when drafting).",
    { address: z.string(), n: z.number().default(3) },
    async ({ address, n }) => {
      const { data } = await gmail.users.messages.list({ userId: USER, q: `in:sent to:${address}`, maxResults: n });
      const out = [];
      for (const m of data.messages ?? []) {
        const { data: full } = await gmail.users.messages.get({ userId: USER, id: m.id!, format: "full" });
        out.push(bodyText(full.payload).slice(0, 1500));
      }
      return text(JSON.stringify(out));
    }),

  tool("gmail_label", "Add an Agent/* label and optionally remove INBOX (archive). Labels: Agent/Captured, Agent/Cold Outreach, Agent/Draft Ready, Agent/Skipped.",
    { message_id: z.string(), label: z.enum(["Agent/Captured", "Agent/Cold Outreach", "Agent/Draft Ready", "Agent/Skipped"]), archive: z.boolean().default(false) },
    async ({ message_id, label, archive }) => {
      await gmail.users.messages.modify({ userId: USER, id: message_id, requestBody: { addLabelIds: [await labelId(label)], removeLabelIds: archive ? ["INBOX"] : [] } });
      return text("ok");
    }),

  tool("gmail_report_spam", "Move a message to Spam. Only allowed when settings.report_spam is true and confidence >= 0.95.",
    { message_id: z.string() },
    async ({ message_id }) => {
      await gmail.users.messages.modify({ userId: USER, id: message_id, requestBody: { addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] } });
      return text("ok");
    }),

  tool("gmail_create_draft", "Create a reply draft in an existing thread. Never sends. Body is plain text, no signature.",
    { thread_id: z.string(), to: z.string(), subject: z.string(), body: z.string(), in_reply_to_message_id: z.string() },
    async ({ thread_id, to, subject, body, in_reply_to_message_id }) => {
      const { data: orig } = await gmail.users.messages.get({ userId: USER, id: in_reply_to_message_id, format: "metadata", metadataHeaders: ["Message-ID"] });
      const mid = header(orig.payload?.headers, "Message-ID");
      const raw = Buffer.from(
        `To: ${to}\r\nSubject: ${subject.startsWith("Re:") ? subject : "Re: " + subject}\r\nIn-Reply-To: ${mid}\r\nReferences: ${mid}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
      ).toString("base64url");
      const { data } = await gmail.users.drafts.create({ userId: USER, requestBody: { message: { threadId: thread_id, raw } } });
      return text(JSON.stringify({ draft_id: data.id, draft_link: `https://mail.google.com/mail/u/0/#drafts?compose=${data.message?.id}` }));
    }),
];
