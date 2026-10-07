import express from "express";
import crypto from "node:crypto";
import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { SYSTEM_PROMPT } from "./prompt.js";
import { dbTools, log } from "./tools/db.js";
import { gmailTools } from "./tools/gmail.js";
import { asanaTools, slackTools } from "./tools/asana_slack.js";
import { syncClients } from "./tools/sheet.js";
import { briefTools } from "./tools/brief.js";
import { statusSnapshot } from "./tools/status.js";

const app = express();
app.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf; } }));

type RunType = "capture" | "brief" | "slack_reply" | "bootstrap";
let running = false;

async function runAgent(runType: RunType, prompt: string) {
  if (running) return { skipped: "another run in progress" };
  running = true;
  const runId = crypto.randomUUID();
  await log(runId, runType, "run_start");
  try {
    const nrn = createSdkMcpServer({
      name: "nrn",
      version: "1.0.0",
      tools: [...dbTools(runId, runType), ...gmailTools, ...asanaTools, ...slackTools, ...briefTools],
    });
    let result = "";
    for await (const msg of query({
      prompt,
      options: {
        systemPrompt: SYSTEM_PROMPT,
        mcpServers: { nrn },
        allowedTools: ["mcp__nrn__*", "Skill", "Read"],
        settingSources: ["project"],          // loads .claude/skills/*
        permissionMode: "bypassPermissions",  // headless; tool list is the guardrail
        maxTurns: 150,
        model: process.env.AGENT_MODEL ?? "claude-sonnet-4-6",
      },
    })) {
      if (msg.type === "result") result = (msg as any).result ?? "";
    }
    await log(runId, runType, "run_end", { result: result.slice(0, 2000) });
    return { runId, result };
  } catch (e: any) {
    await log(runId, runType, "error", { message: e.message });
    return { runId, error: e.message };
  } finally {
    running = false;
  }
}

const guard = (req: express.Request, res: express.Response, next: express.NextFunction) =>
  req.header("X-Run-Token") === process.env.RUN_TOKEN ? next() : res.status(401).end();

app.post("/run/capture", guard, async (_req, res) => {
  res.json(await runAgent("capture", "Run the capture skill: process new inbox mail since last_message_id, then update last_message_id."));
});
app.post("/run/brief", guard, async (_req, res) => {
  res.json(await runAgent("brief", "Run the brief skill: build and post today's triage brief to #agent."));
});
app.post("/run/bootstrap", guard, async (_req, res) => {
  res.json(await runAgent("bootstrap", "Run the bootstrap skill: propose the client domain → Asana project map and post it to #agent for confirmation."));
});
// Manual: load the clients sheet into agent_clients. ?dry_run=1 reports without writing.
app.post("/run/sync-clients", guard, async (req, res) => {
  try { res.json(await syncClients(req.query.dry_run === "1")); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Slack Events API: message.channels in #agent. Only Neil (or approvers) trigger a run.
app.post("/slack/events", async (req: any, res) => {
  if (req.body.type === "url_verification") return res.send(req.body.challenge);
  const ts = req.header("X-Slack-Request-Timestamp") ?? "";
  const sig = req.header("X-Slack-Signature") ?? "";
  const base = `v0:${ts}:${req.rawBody}`;
  const mine = "v0=" + crypto.createHmac("sha256", process.env.SLACK_SIGNING_SECRET!).update(base).digest("hex");
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300 || !crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(sig))) return res.status(401).end();
  res.status(200).end(); // ack fast, work async

  const ev = req.body.event;
  if (!ev || ev.type !== "message" || ev.bot_id || ev.channel !== process.env.SLACK_AGENT_CHANNEL_ID) return;
  if (ev.user !== process.env.SLACK_NEIL_USER_ID) return; // approvers list checked inside the skill for v2
  runAgent("slack_reply", `Run the slack-reply skill. Neil replied in #agent.\nthread_ts: ${ev.thread_ts ?? ev.ts}\nmessage_ts: ${ev.ts}\ntext: """${ev.text}"""`);
});

// Read-only snapshot for the status dashboard. Separate token so a reader can never trigger a run.
const statusGuard = (req: express.Request, res: express.Response, next: express.NextFunction) =>
  process.env.STATUS_TOKEN && req.header("X-Status-Token") === process.env.STATUS_TOKEN ? next() : res.status(401).end();
app.get("/status", statusGuard, async (_req, res) => {
  try { res.json(await statusSnapshot(running)); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.get("/health", (_req, res) => res.json({ ok: true, running }));
app.listen(Number(process.env.PORT ?? 3000), () => console.log("agent listening"));
