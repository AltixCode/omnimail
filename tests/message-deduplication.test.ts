import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  deduplicateThreadMessages,
  isKnownMessageIdentity,
} from "../src/lib/message-deduplication";

test("indexes account-scoped RFC Message-ID deduplication lookups", () => {
  const schema = readFileSync(
    new URL("../prisma/schema.prisma", import.meta.url),
    "utf8",
  );

  assert.match(schema, /@@index\(\[accountId, messageId\]\)/);
});

type TestMessage = {
  id: string;
  accountId: string;
  gmailMessageId?: string | null;
  messageId?: string | null;
  date: string;
};

test("deduplicates the same Gmail message synced from Sent and All Mail", () => {
  const messages: TestMessage[] = [
    {
      id: "sent-copy",
      accountId: "gmail-account",
      gmailMessageId: "1900042000000000000",
      messageId: "<reply@example.test>",
      date: "2026-10-15T07:29:00.000Z",
    },
    {
      id: "all-mail-copy",
      accountId: "gmail-account",
      gmailMessageId: "1900042000000000000",
      messageId: "<reply@example.test>",
      date: "2026-10-15T07:29:00.000Z",
    },
  ];

  assert.deepEqual(
    deduplicateThreadMessages(messages, "all-mail-copy").map((message) => message.id),
    ["all-mail-copy"],
  );
});

test("deduplicates a locally saved sent copy by RFC Message-ID", () => {
  const messages: TestMessage[] = [
    {
      id: "local-copy",
      accountId: "gmail-account",
      messageId: "<reply@example.test>",
      date: "2026-10-15T07:29:00.000Z",
    },
    {
      id: "remote-copy",
      accountId: "gmail-account",
      gmailMessageId: "1900042000000000000",
      messageId: "<reply@example.test>",
      date: "2026-10-15T07:29:00.000Z",
    },
  ];

  assert.equal(deduplicateThreadMessages(messages).length, 1);
});

test("skips future sync copies by either provider or RFC Message-ID", () => {
  const knownProviderIds = new Set(["provider-1"]);
  const knownMessageIds = new Set(["<sent@example.test>"]);

  assert.equal(
    isKnownMessageIdentity("provider-1", null, knownProviderIds, knownMessageIds),
    true,
  );
  assert.equal(
    isKnownMessageIdentity(
      null,
      "<sent@example.test>",
      knownProviderIds,
      knownMessageIds,
    ),
    true,
  );
  assert.equal(
    isKnownMessageIdentity(
      "provider-2",
      "<different@example.test>",
      knownProviderIds,
      knownMessageIds,
    ),
    false,
  );
  assert.equal(
    isKnownMessageIdentity(null, null, knownProviderIds, knownMessageIds),
    false,
  );
});

test("keeps messages without stable identities and handles an empty thread", () => {
  const anonymous: TestMessage[] = [
    {
      id: "anonymous-1",
      accountId: "account-a",
      date: "2026-10-15T07:00:00.000Z",
    },
    {
      id: "anonymous-2",
      accountId: "account-a",
      date: "2026-10-15T07:01:00.000Z",
    },
  ];

  assert.deepEqual(deduplicateThreadMessages([]), []);
  assert.deepEqual(
    deduplicateThreadMessages(anonymous).map((message) => message.id),
    ["anonymous-1", "anonymous-2"],
  );
});

test("does not collapse distinct replies or the same Message-ID in different accounts", () => {
  const messages: TestMessage[] = [
    {
      id: "reply-1",
      accountId: "account-a",
      messageId: "<reply-1@example.test>",
      date: "2026-10-15T07:00:00.000Z",
    },
    {
      id: "reply-2",
      accountId: "account-a",
      messageId: "<reply-2@example.test>",
      date: "2026-10-15T07:30:00.000Z",
    },
    {
      id: "other-account-copy",
      accountId: "account-b",
      messageId: "<reply-1@example.test>",
      date: "2026-10-15T07:00:00.000Z",
    },
  ];

  assert.deepEqual(
    deduplicateThreadMessages(messages).map((message) => message.id),
    ["reply-1", "other-account-copy", "reply-2"],
  );
});

test("keeps the preferred row when a later copy bridges provider and RFC identities", () => {
  const messages: TestMessage[] = [
    {
      id: "provider-copy",
      accountId: "gmail-account",
      gmailMessageId: "provider-1",
      date: "2026-10-15T07:29:00.000Z",
    },
    {
      id: "preferred-rfc-copy",
      accountId: "gmail-account",
      messageId: "<reply@example.test>",
      date: "2026-10-15T07:29:00.000Z",
    },
    {
      id: "bridge-copy",
      accountId: "gmail-account",
      gmailMessageId: "provider-1",
      messageId: "<reply@example.test>",
      date: "2026-10-15T07:29:00.000Z",
    },
  ];

  assert.deepEqual(
    deduplicateThreadMessages(messages, "preferred-rfc-copy").map(
      (message) => message.id,
    ),
    ["preferred-rfc-copy"],
  );
});
