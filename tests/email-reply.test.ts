import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanEmail,
  parseContact,
  parseAddressList,
  resolveReplyRecipients,
} from "../src/lib/email-reply";

test("cleanEmail extracts and normalizes emails", () => {
  assert.equal(cleanEmail("Elena Tsakona <etsakona@hfm.com>"), "etsakona@hfm.com");
  assert.equal(cleanEmail("<AtasMohammadi@gmail.com>"), "atasmohammadi@gmail.com");
  assert.equal(cleanEmail("  USER@DOMAIN.COM  "), "user@domain.com");
  assert.equal(cleanEmail(null), "");
  assert.equal(cleanEmail(""), "");
});

test("parseContact handles various email header formats", () => {
  assert.deepEqual(parseContact("Elena Tsakona <etsakona@hfm.com>"), {
    address: "etsakona@hfm.com",
    name: "Elena Tsakona",
  });
  assert.deepEqual(parseContact('"Tsakona, Elena" <etsakona@hfm.com>'), {
    address: "etsakona@hfm.com",
    name: "Tsakona, Elena",
  });
  assert.deepEqual(parseContact("etsakona@hfm.com"), {
    address: "etsakona@hfm.com",
    name: null,
  });
  assert.deepEqual(parseContact("<etsakona@hfm.com>"), {
    address: "etsakona@hfm.com",
    name: null,
  });
});

test("parseAddressList parses JSON arrays and delimited strings", () => {
  assert.deepEqual(parseAddressList('["etsakona@hfm.com", "other@example.com"]'), [
    { address: "etsakona@hfm.com", name: null },
    { address: "other@example.com", name: null },
  ]);

  assert.deepEqual(
    parseAddressList(
      JSON.stringify([{ address: "etsakona@hfm.com", name: "Elena Tsakona" }])
    ),
    [{ address: "etsakona@hfm.com", name: "Elena Tsakona" }]
  );

  assert.deepEqual(
    parseAddressList("Elena Tsakona <etsakona@hfm.com>, David <david@example.com>"),
    [
      { address: "etsakona@hfm.com", name: "Elena Tsakona" },
      { address: "david@example.com", name: "David" },
    ]
  );
});

test("resolveReplyRecipients: replying to incoming message targets the sender", () => {
  const targetMessage = {
    fromAddress: "etsakona@hfm.com",
    fromName: "Elena Tsakona",
    toAddresses: JSON.stringify(["atasmohammadi@gmail.com"]),
  };

  const res = resolveReplyRecipients({
    targetMessage,
    userEmails: ["atasmohammadi@gmail.com"],
  });

  assert.equal(res.toAddress, "etsakona@hfm.com");
  assert.equal(res.displayName, "Elena Tsakona");
  assert.deepEqual(res.replyAllTo, ["etsakona@hfm.com"]);
  assert.deepEqual(res.replyAllCc, []);
});

test("resolveReplyRecipients: thread where user sent the latest message targets the other person, not the user", () => {
  // Scenario matching user's screenshot:
  // 1. Ata -> Elena
  // 2. Elena -> Ata
  // 3. Ata -> Elena (latest message)
  const threadMessages = [
    {
      id: "msg-1",
      fromAddress: "atasmohammadi@gmail.com",
      fromName: "Me",
      toAddresses: JSON.stringify(["etsakona@hfm.com"]),
    },
    {
      id: "msg-2",
      fromAddress: "etsakona@hfm.com",
      fromName: "Elena Tsakona",
      toAddresses: JSON.stringify(["atasmohammadi@gmail.com"]),
    },
    {
      id: "msg-3",
      fromAddress: "atasmohammadi@gmail.com",
      fromName: "Me",
      toAddresses: JSON.stringify(["etsakona@hfm.com"]),
    },
  ];

  const targetMessage = threadMessages[2];

  const res = resolveReplyRecipients({
    targetMessage,
    threadMessages,
    userEmails: ["atasmohammadi@gmail.com"],
  });

  // MUST target Elena, NEVER Ata!
  assert.equal(res.toAddress, "etsakona@hfm.com");
  assert.equal(res.displayName, "Elena Tsakona");
  assert.deepEqual(res.replyAllTo, ["etsakona@hfm.com"]);
  assert.deepEqual(res.replyAllCc, []);
});

test("resolveReplyRecipients: sent email with no earlier thread messages targets the recipient", () => {
  // User wrote an email to Elena (e.g. in Sent folder)
  const targetMessage = {
    fromAddress: "atasmohammadi@gmail.com",
    fromName: "Ata Mohammadi",
    toAddresses: JSON.stringify(["Elena Tsakona <etsakona@hfm.com>"]),
  };

  const res = resolveReplyRecipients({
    targetMessage,
    threadMessages: [targetMessage],
    userEmails: ["atasmohammadi@gmail.com"],
  });

  assert.equal(res.toAddress, "etsakona@hfm.com");
  assert.equal(res.displayName, "Elena Tsakona");
});

test("resolveReplyRecipients: multi-party conversation excludes self from reply-all", () => {
  const targetMessage = {
    fromAddress: "atasmohammadi@gmail.com",
    fromName: "Me",
    toAddresses: JSON.stringify(["etsakona@hfm.com", "colleague@hfm.com"]),
    ccAddresses: "boss@hfm.com",
  };

  const threadMessages = [
    {
      fromAddress: "etsakona@hfm.com",
      fromName: "Elena Tsakona",
      toAddresses: JSON.stringify(["atasmohammadi@gmail.com", "colleague@hfm.com"]),
      ccAddresses: "boss@hfm.com",
    },
    targetMessage,
  ];

  const res = resolveReplyRecipients({
    targetMessage,
    threadMessages,
    userEmails: ["atasmohammadi@gmail.com"],
  });

  assert.equal(res.toAddress, "etsakona@hfm.com");
  assert.equal(res.displayName, "Elena Tsakona");
  assert.deepEqual(res.replyAllTo, ["etsakona@hfm.com"]);
  // All other external participants in CC, Ata excluded
  assert.ok(res.replyAllCc.includes("colleague@hfm.com"));
  assert.ok(res.replyAllCc.includes("boss@hfm.com"));
  assert.ok(!res.replyAllCc.includes("atasmohammadi@gmail.com"));
});

test("resolveReplyRecipients: note to self sent to self falls back safely", () => {
  const targetMessage = {
    fromAddress: "atasmohammadi@gmail.com",
    fromName: "Ata Mohammadi",
    toAddresses: JSON.stringify(["atasmohammadi@gmail.com"]),
  };

  const res = resolveReplyRecipients({
    targetMessage,
    threadMessages: [targetMessage],
    userEmails: ["atasmohammadi@gmail.com"],
  });

  assert.equal(res.toAddress, "atasmohammadi@gmail.com");
});

test("resolveReplyRecipients: respects replyTo header when present and not self", () => {
  const targetMessage = {
    fromAddress: "notifications@service.com",
    fromName: "Support Team",
    replyTo: "support-agent@service.com",
    toAddresses: JSON.stringify(["atasmohammadi@gmail.com"]),
  };

  const res = resolveReplyRecipients({
    targetMessage,
    userEmails: ["atasmohammadi@gmail.com"],
  });

  assert.equal(res.toAddress, "support-agent@service.com");
  assert.equal(res.displayName, "Support Team");
});
