import test from "node:test";
import assert from "node:assert/strict";
import prisma from "../src/lib/db";
import { saveDraft, deleteDraft } from "../src/lib/drafts";

test("saveDraft creates a draft message in the Drafts folder and deleteDraft removes it", async () => {
  // Find or create a test user
  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({
      data: {
        id: "test-user-draft",
        email: "test-draft@example.com",
        name: "Test User",
      },
    });
  }

  // Find or create a test account
  let account = await prisma.mailAccount.findFirst({
    where: { userId: user.id },
  });
  if (!account) {
    account = await prisma.mailAccount.create({
      data: {
        userId: user.id,
        label: "Test Account",
        emailAddress: "me@example.com",
        imapHost: "localhost",
        imapPort: 993,
        imapUser: "me@example.com",
        imapPassEnc: "enc",
        smtpHost: "localhost",
        smtpPort: 587,
        smtpUser: "me@example.com",
        smtpPassEnc: "enc",
      },
    });
  }

  // 1. Create a draft
  const draft1 = await saveDraft(user.id, {
    accountId: account.id,
    to: ["alice@example.com", "bob@example.com"],
    subject: "Meeting Tomorrow",
    bodyText: "Hey folks, can we meet at 10 AM?",
    bodyHtml: "<p>Hey folks, can we meet at 10 AM?</p>",
  });

  assert.ok(draft1);
  assert.ok(draft1.id);
  assert.equal(draft1.subject, "Meeting Tomorrow");
  assert.equal(draft1.bodyText, "Hey folks, can we meet at 10 AM?");
  assert.equal(draft1.snippet, "Hey folks, can we meet at 10 AM?");
  assert.deepEqual(JSON.parse(draft1.toAddresses), ["alice@example.com", "bob@example.com"]);

  // 2. Update the same draft
  const draft2 = await saveDraft(user.id, {
    draftId: draft1.id,
    accountId: account.id,
    to: "alice@example.com, bob@example.com, charlie@example.com",
    subject: "Meeting Tomorrow (Updated)",
    bodyText: "Updated body content.",
    bodyHtml: "<p>Updated body content.</p>",
  });

  assert.equal(draft2.id, draft1.id);
  assert.equal(draft2.subject, "Meeting Tomorrow (Updated)");
  assert.deepEqual(JSON.parse(draft2.toAddresses), ["alice@example.com", "bob@example.com", "charlie@example.com"]);

  // Verify in database
  const inDb = await prisma.message.findUnique({
    where: { id: draft1.id },
  });
  assert.ok(inDb);
  assert.equal(inDb.subject, "Meeting Tomorrow (Updated)");

  // 3. Delete the draft
  const deleted = await deleteDraft(user.id, draft1.id);
  assert.deepEqual(deleted, { success: true });

  const afterDelete = await prisma.message.findUnique({
    where: { id: draft1.id },
  });
  assert.equal(afterDelete, null);
});
