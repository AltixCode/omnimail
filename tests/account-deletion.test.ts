import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { DELETE } from "../src/app/api/auth/account/route";
import { createSessionToken, COOKIE_NAME } from "../src/lib/session-token";
import prisma from "../src/lib/db";

test("DELETE /api/auth/account returns 401 when unauthenticated", async () => {
  const req = new NextRequest("http://localhost/api/auth/account", {
    method: "DELETE",
  });
  const res = await DELETE(req);
  assert.equal(res.status, 401);
});

test("DELETE /api/auth/account returns 401 when bearer token references nonexistent user", async () => {
  const token = createSessionToken(`nonexistent-${Date.now()}`);
  const req = new NextRequest("http://localhost/api/auth/account", {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  const res = await DELETE(req);
  assert.equal(res.status, 401);
});

test("DELETE /api/auth/account permanently deletes user, connected mailboxes, sync queues, and tombstones", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const user = await prisma.user.create({
    data: {
      email: `delete-test-${suffix}@example.com`,
      name: "Delete Test User",
      passwordHash: "hash-placeholder",
    },
  });

  const account = await prisma.mailAccount.create({
    data: {
      userId: user.id,
      label: "Test Account",
      emailAddress: `mailbox-${suffix}@example.com`,
      imapHost: "imap.example.com",
      imapUser: "user",
      imapPassEnc: "enc",
      smtpHost: "smtp.example.com",
      smtpUser: "user",
      smtpPassEnc: "enc",
    },
  });

  await prisma.trustedSender.create({
    data: { userId: user.id, email: "trusted@example.com" },
  });

  await prisma.devicePushToken.create({
    data: { userId: user.id, token: `ExponentPushToken[test-${suffix}]`, platform: "ios" },
  });

  await prisma.syncActionQueue.create({
    data: {
      accountId: account.id,
      action: "mark-read",
      folderPath: "INBOX",
      uids: "[1]",
    },
  });

  await prisma.tombstone.create({
    data: {
      accountId: account.id,
      folderPath: "INBOX",
      uid: 1,
    },
  });

  const token = createSessionToken(user.id);
  const req = new NextRequest("http://localhost/api/auth/account", {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });

  const res = await DELETE(req);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.success, true);

  const clearedCookie = res.cookies.get(COOKIE_NAME);
  assert.equal(clearedCookie?.value, "");

  assert.equal(await prisma.user.findUnique({ where: { id: user.id } }), null);
  assert.equal(await prisma.mailAccount.findUnique({ where: { id: account.id } }), null);
  assert.equal(await prisma.trustedSender.count({ where: { userId: user.id } }), 0);
  assert.equal(await prisma.devicePushToken.count({ where: { userId: user.id } }), 0);
  assert.equal(await prisma.syncActionQueue.count({ where: { accountId: account.id } }), 0);
  assert.equal(await prisma.tombstone.count({ where: { accountId: account.id } }), 0);
});
