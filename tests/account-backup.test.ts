import test from "node:test";
import assert from "node:assert/strict";
import {
  serializeAccountsForExport,
  parseBackupPayload,
  planAccountDeduplication,
} from "../src/lib/account-backup";
import { encryptSecret } from "../src/lib/crypto";

test("serializeAccountsForExport decrypts passwords and exports full config", () => {
  const encImapPass = encryptSecret("superSecretImap123");
  const encSmtpPass = encryptSecret("superSecretSmtp456");
  const encCalPass = encryptSecret("superSecretCal789");

  const mockDbAccounts = [
    {
      id: "acc_1",
      label: "Work Account",
      emailAddress: "work@company.com",
      imapHost: "imap.company.com",
      imapPort: 993,
      imapSecure: true,
      imapUser: "work@company.com",
      imapPassEnc: encImapPass,
      smtpHost: "smtp.company.com",
      smtpPort: 465,
      smtpSecure: true,
      smtpUser: "work@company.com",
      smtpPassEnc: encSmtpPass,
      caldavUrl: "https://dav.company.com",
      caldavUser: "work@company.com",
      caldavPassEnc: encCalPass,
      syncActive: true,
      syncIntervalMinutes: 5,
      enableIdle: true,
      syncMaxMessages: 150,
      syncFolderScope: "all",
      caldavSyncIntervalMinutes: 15,
    },
  ];

  const exportResult = serializeAccountsForExport(mockDbAccounts, {
    timezoneMode: "manual",
    timezone: "Europe/Berlin",
    trustedSenders: ["partner@trusted.com"],
  });

  assert.equal(exportResult.version, 1);
  assert.equal(exportResult.app, "OmniMail");
  assert.equal(exportResult.accounts.length, 1);

  const acc = exportResult.accounts[0];
  assert.equal(acc.emailAddress, "work@company.com");
  assert.equal(acc.imapPassword, "superSecretImap123");
  assert.equal(acc.smtpPassword, "superSecretSmtp456");
  assert.equal(acc.caldavPassword, "superSecretCal789");
  assert.equal(acc.imapPort, 993);
  assert.equal(acc.smtpPort, 465);
  assert.equal(acc.syncMaxMessages, 150);

  assert.equal(exportResult.settings?.timezone, "Europe/Berlin");
  assert.deepEqual(exportResult.settings?.trustedSenders, ["partner@trusted.com"]);
});

test("parseBackupPayload handles object with accounts, arrays, and field variations", () => {
  const jsonWithObject = {
    version: 1,
    accounts: [
      {
        email: "alice@example.com",
        password: "commonPassword",
        imapHost: "imap.example.com",
        smtpHost: "smtp.example.com",
      },
    ],
    settings: {
      timezone: "Asia/Nicosia",
      trustedSenders: ["billing@supplier.com"],
    },
  };

  const parsed1 = parseBackupPayload(jsonWithObject);
  assert.equal(parsed1.accounts.length, 1);
  assert.equal(parsed1.accounts[0].emailAddress, "alice@example.com");
  assert.equal(parsed1.accounts[0].imapPassword, "commonPassword");
  assert.equal(parsed1.accounts[0].smtpPassword, "commonPassword");
  assert.equal(parsed1.settings?.timezone, "Asia/Nicosia");

  // Raw array payload
  const rawArray = [
    {
      emailAddress: "bob@example.com",
      imapPassword: "p1",
      smtpPassword: "p2",
      imapHost: "mail.example.com",
      smtpHost: "mail.example.com",
    },
  ];
  const parsed2 = parseBackupPayload(rawArray);
  assert.equal(parsed2.accounts.length, 1);
  assert.equal(parsed2.accounts[0].emailAddress, "bob@example.com");
  assert.equal(parsed2.accounts[0].imapPassword, "p1");
});

test("planAccountDeduplication accurately avoids duplicates", () => {
  const existingInDb = [
    { id: "db_1", emailAddress: "existing@example.com" },
    { id: "db_2", emailAddress: "ceo@company.com" },
  ];

  const importedList = [
    // Duplicate of existing in DB
    {
      label: "Existing Updated",
      emailAddress: "Existing@Example.COM ",
      imapHost: "imap.example.com",
      imapPort: 993,
      imapSecure: true,
      imapUser: "existing@example.com",
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: "existing@example.com",
    },
    // New account
    {
      label: "New Account",
      emailAddress: "new@example.com",
      imapHost: "imap.new.com",
      imapPort: 993,
      imapSecure: true,
      imapUser: "new@example.com",
      smtpHost: "smtp.new.com",
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: "new@example.com",
    },
    // Repeated entry of new account in the same file (internal duplicate)
    {
      label: "New Account Duplicate",
      emailAddress: "new@example.com",
      imapHost: "imap.new.com",
      imapPort: 993,
      imapSecure: true,
      imapUser: "new@example.com",
      smtpHost: "smtp.new.com",
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: "new@example.com",
    },
    // Invalid email
    {
      label: "Invalid Account",
      emailAddress: "not-an-email",
      imapHost: "imap.x.com",
      imapPort: 993,
      imapSecure: true,
      imapUser: "x",
      smtpHost: "smtp.x.com",
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: "x",
    },
  ];

  // Default mode: update existing
  const planUpdate = planAccountDeduplication(importedList, existingInDb, { updateExisting: true });
  assert.equal(planUpdate.toCreate.length, 1);
  assert.equal(planUpdate.toCreate[0].emailAddress, "new@example.com");

  assert.equal(planUpdate.toUpdate.length, 1);
  assert.equal(planUpdate.toUpdate[0].existingId, "db_1");
  assert.equal(planUpdate.toUpdate[0].account.label, "Existing Updated");

  assert.equal(planUpdate.toSkip.length, 1); // internal duplicate of new@example.com was skipped
  assert.equal(planUpdate.invalid.length, 1);
  assert.equal(planUpdate.duplicatesAvoided, 2); // 1 db duplicate + 1 internal duplicate

  // Skip mode: do not update existing
  const planSkip = planAccountDeduplication(importedList, existingInDb, { updateExisting: false });
  assert.equal(planSkip.toCreate.length, 1);
  assert.equal(planSkip.toUpdate.length, 0);
  assert.equal(planSkip.toSkip.length, 2); // both the existing@ and duplicate new@ skipped
  assert.equal(planSkip.duplicatesAvoided, 2);
});
