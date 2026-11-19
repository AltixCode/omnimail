import { test } from "node:test";
import assert from "node:assert/strict";
import {
  executeAiAssist,
  formatThreadContext,
} from "../src/lib/ai-assistant";

test("formatThreadContext handles empty and populated threads", () => {
  assert.equal(formatThreadContext([]), "");

  const formatted = formatThreadContext([
    {
      from: "Alice <alice@example.com>",
      to: "Bob <bob@example.com>",
      subject: "Meeting follow-up",
      date: new Date("2026-11-18T10:00:00Z"),
      body: "Can you send the slides?",
    },
  ]);

  assert.ok(formatted.includes("Alice <alice@example.com>"));
  assert.ok(formatted.includes("Meeting follow-up"));
  assert.ok(formatted.includes("Can you send the slides?"));
});

test("executeAiAssist rephrases basic text professionally based on thread context", async () => {
  const result = await executeAiAssist({
    action: "rephrase",
    text: "yeah ill send the slides in an hour busy with a customer right now",
    subject: "Re: Meeting follow-up",
    recipient: "Alice <alice@example.com>",
    threadMessages: [
      {
        from: "Alice <alice@example.com>",
        to: "Bob <bob@example.com>",
        subject: "Meeting follow-up",
        date: "2026-11-18T10:00:00Z",
        body: "Can you send the slides from today's presentation?",
      },
    ],
  });

  assert.equal(result.action, "rephrase");
  assert.ok(result.text.length > 0);
  assert.ok(/slides/i.test(result.text));
  assert.ok(/hour|customer/i.test(result.text));
  // Should not contain markdown fences or conversational preamble
  assert.ok(!result.text.startsWith("Here is"));
  assert.ok(!result.text.startsWith("Sure"));
});

test("executeAiAssist drafts an email based on instruction and thread context", async () => {
  const result = await executeAiAssist({
    action: "draft",
    instruction: "Politely accept the meeting invitation and say 2pm works perfectly.",
    subject: "Re: Quick Sync",
    recipient: "David <david@example.com>",
    threadMessages: [
      {
        from: "David <david@example.com>",
        subject: "Quick Sync",
        date: "2026-11-18T11:00:00Z",
        body: "Are you free for a quick sync tomorrow at 2pm?",
      },
    ],
  });

  assert.equal(result.action, "draft");
  assert.ok(result.text.length > 0);
  assert.ok(/2\s*(?:pm|:00)/i.test(result.text));
  assert.ok(/works|great|see you|sound/i.test(result.text));
});

test("POST /api/ai/assist rejects unauthenticated requests with 401", async () => {
  const { POST } = await import("../src/app/api/ai/assist/route");
  const req = new Request("http://localhost:3000/api/ai/assist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "draft", instruction: "Hello" }),
  });
  const res = await POST(req as any);
  assert.equal(res.status, 401);
});
