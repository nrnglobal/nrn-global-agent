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

import { contextRows } from "../src/tools/context.js";

describe("contextRows", () => {
  it("renders one row per client with tasks and threads flattened to lines, header first", () => {
    const rows = contextRows([
      { client_name: "IMS", report_label: "IMS", asana_project_gid: "1", open_tasks: [{ name: "Mgmt IMS", assignee: "Neil", due_on: "2026-10-13", modified_at: "x", permalink: "u" }], ewise_threads: [{ subject: "Re: phones", from: "Philip <p@ewisecommunications.com>", date: "Thu, 8 Oct 2026 10:00:00 -0400", snippet: "s", gmail_link: "g" }] },
      { client_name: "NPDES", report_label: "NPDES", asana_project_gid: "2", open_tasks: [], ewise_threads: [] },
    ], "2026-10-06", "2026-10-09T12:45:00Z");
    expect(rows[0]).toEqual(["report_label", "client_name", "asana_project_gid", "since", "generated_at", "open_tasks", "ewise_threads"]);
    expect(rows[1]).toEqual(["IMS", "IMS", "1", "2026-10-06", "2026-10-09T12:45:00Z", "Mgmt IMS (Neil, due 2026-10-13)", "email Oct 8 Re: phones (Philip)"]);
    expect(rows[2]).toEqual(["NPDES", "NPDES", "2", "2026-10-06", "2026-10-09T12:45:00Z", "", ""]);
  });
});
