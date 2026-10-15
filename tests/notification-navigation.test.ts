import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNotificationUrl,
  parseNotificationTarget,
  shouldOpenCalendarNotification,
} from "../src/lib/notification-navigation";

test("email notification URLs retain the exact database message id", () => {
  const url = buildNotificationUrl(
    { type: "email", messageId: "gmail/message id", accountId: "account-2", folderId: "label-7" },
    "https://mail.example.test/?view=inbox",
  );

  assert.equal(
    url,
    "https://mail.example.test/?notification=email&messageId=gmail%2Fmessage+id&accountId=account-2&folderId=label-7",
  );
  assert.deepEqual(parseNotificationTarget(new URL(url).search), {
    type: "email",
    messageId: "gmail/message id",
    accountId: "account-2",
    folderId: "label-7",
  });
});

test("calendar notification URLs retain the exact event and occurrence time", () => {
  const url = buildNotificationUrl(
    {
      type: "calendar",
      eventId: "event-42_1792056600000",
      startDate: "2026-10-15T10:30:00.000Z",
    },
    "https://mail.example.test/",
  );

  assert.deepEqual(parseNotificationTarget(new URL(url).search), {
    type: "calendar",
    eventId: "event-42_1792056600000",
    startDate: "2026-10-15T10:30:00.000Z",
  });
});

test("malformed notification targets are ignored", () => {
  assert.equal(parseNotificationTarget("?notification=email"), null);
  assert.equal(parseNotificationTarget("?notification=calendar&eventId="), null);
  assert.equal(parseNotificationTarget("?notification=other&id=x"), null);
});

test("optional notification fields are trimmed or omitted and stale URL state is cleared", () => {
  const url = new URL(
    buildNotificationUrl(
      { type: "email", messageId: "message-1" },
      "https://mail.example.test/inbox?old=value#stale",
    ),
  );

  assert.equal(url.pathname, "/inbox");
  assert.equal(url.hash, "");
  assert.equal(url.searchParams.get("old"), null);
  assert.deepEqual(
    parseNotificationTarget(
      "?notification=email&messageId=%20message-1%20&accountId=%20%20&folderId=%20label-1%20",
    ),
    { type: "email", messageId: "message-1", folderId: "label-1" },
  );
});

test("calendar notification targets are consumed once until cleared", () => {
  assert.equal(shouldOpenCalendarNotification("event-1", null), true);
  assert.equal(shouldOpenCalendarNotification("event-1", "event-1"), false);
  assert.equal(shouldOpenCalendarNotification(null, "event-1"), false);
  assert.equal(shouldOpenCalendarNotification("event-1", null), true);
});
