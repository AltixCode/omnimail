import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNotificationUrl,
  parseNotificationTarget,
  shouldOpenCalendarNotification,
} from "../src/lib/notification-navigation";
import {
  buildAppUrl,
  parseAppUrl,
  normalizeCalendarViewMode,
} from "../src/lib/app-navigation";

test("email notification URLs generate canonical path and retain message id", () => {
  const url = buildNotificationUrl(
    { type: "email", messageId: "gmail/message id", accountId: "account-2", folderId: "label-7" },
    "https://mail.example.test/?view=inbox",
  );

  assert.equal(
    url,
    "https://mail.example.test/mail/message/gmail%2Fmessage%20id?accountId=account-2&folderId=label-7",
  );
  assert.deepEqual(parseNotificationTarget(url), {
    type: "email",
    messageId: "gmail/message id",
    accountId: "account-2",
    folderId: "label-7",
  });
});

test("calendar notification URLs generate canonical event path and retain occurrence time", () => {
  const url = buildNotificationUrl(
    {
      type: "calendar",
      eventId: "event-42_1792056600000",
      startDate: "2026-10-15T10:30:00.000Z",
    },
    "https://mail.example.test/",
  );

  assert.equal(
    url,
    "https://mail.example.test/calendar/event/event-42_1792056600000?startDate=2026-10-15T10%3A30%3A00.000Z",
  );
  assert.deepEqual(parseNotificationTarget(url), {
    type: "calendar",
    eventId: "event-42_1792056600000",
    startDate: "2026-10-15T10:30:00.000Z",
  });
});

test("malformed notification targets are ignored", () => {
  assert.equal(parseNotificationTarget("?notification=email"), null);
  assert.equal(parseNotificationTarget("?notification=calendar&eventId="), null);
  assert.equal(parseNotificationTarget("?notification=other&id=x"), null);
  assert.equal(parseNotificationTarget("/random/unknown/path"), null);
});

test("legacy notification queries are still parsed accurately", () => {
  assert.deepEqual(
    parseNotificationTarget(
      "?notification=email&messageId=%20message-1%20&accountId=%20%20&folderId=%20label-1%20",
    ),
    { type: "email", messageId: "message-1", folderId: "label-1" },
  );
  assert.deepEqual(
    parseNotificationTarget(
      "?notification=calendar&eventId=evt-100&startDate=2026-10-21T11%3A00%3A00.000Z",
    ),
    { type: "calendar", eventId: "evt-100", startDate: "2026-10-21T11:00:00.000Z" },
  );
});

test("calendar notification targets are consumed once until cleared", () => {
  assert.equal(shouldOpenCalendarNotification("event-1", null), true);
  assert.equal(shouldOpenCalendarNotification("event-1", "event-1"), false);
  assert.equal(shouldOpenCalendarNotification(null, "event-1"), false);
  assert.equal(shouldOpenCalendarNotification("event-1", null), true);
});

test("app navigation parses calendar views and aliases", () => {
  assert.deepEqual(parseAppUrl("/calendar/weekly"), {
    tab: "calendar",
    calendarViewMode: "week",
    calendarEventId: null,
    calendarDate: null,
    accountId: null,
  });

  assert.deepEqual(parseAppUrl("/calendar/week"), {
    tab: "calendar",
    calendarViewMode: "week",
    calendarEventId: null,
    calendarDate: null,
    accountId: null,
  });

  assert.deepEqual(parseAppUrl("/calendar/monthly"), {
    tab: "calendar",
    calendarViewMode: "month",
    calendarEventId: null,
    calendarDate: null,
    accountId: null,
  });

  assert.deepEqual(parseAppUrl("/calendar/agenda"), {
    tab: "calendar",
    calendarViewMode: "agenda",
    calendarEventId: null,
    calendarDate: null,
    accountId: null,
  });

  assert.deepEqual(parseAppUrl("/calendar/event/meet-xyz?date=2026-10-21"), {
    tab: "calendar",
    calendarEventId: "meet-xyz",
    calendarDate: new Date("2026-10-21"),
    calendarViewMode: "month",
    accountId: null,
  });
});

test("app navigation parses mail views and direct messages regardless of folder", () => {
  assert.deepEqual(parseAppUrl("/mail/inbox"), {
    tab: "mail",
    mailView: "inbox",
    messageId: null,
    accountId: null,
    filterMode: "all",
    searchQuery: "",
  });

  assert.deepEqual(parseAppUrl("/mail/trash"), {
    tab: "mail",
    mailView: "trash",
    messageId: null,
    accountId: null,
    filterMode: "all",
    searchQuery: "",
  });

  assert.deepEqual(parseAppUrl("/mail/spam"), {
    tab: "mail",
    mailView: "spam",
    messageId: null,
    accountId: null,
    filterMode: "all",
    searchQuery: "",
  });

  assert.deepEqual(parseAppUrl("/mail/message/msg_12345"), {
    tab: "mail",
    mailView: "inbox",
    messageId: "msg_12345",
    accountId: null,
    filterMode: "all",
    searchQuery: "",
  });

  assert.deepEqual(parseAppUrl("/message/msg_12345"), {
    tab: "mail",
    mailView: "inbox",
    messageId: "msg_12345",
    accountId: null,
    filterMode: "all",
    searchQuery: "",
  });

  assert.deepEqual(parseAppUrl("/mail/folder/folder_abc"), {
    tab: "mail",
    mailView: "folder",
    folderId: "folder_abc",
    messageId: null,
    accountId: null,
    filterMode: "all",
    searchQuery: "",
  });
});

test("app navigation generates proper canonical URLs", () => {
  assert.equal(
    buildAppUrl({ tab: "calendar", calendarViewMode: "week" }),
    "/calendar/week",
  );
  assert.equal(
    buildAppUrl({ tab: "calendar", calendarEventId: "evt_99" }),
    "/calendar/event/evt_99",
  );
  assert.equal(
    buildAppUrl({ tab: "mail", mailView: "trash" }),
    "/mail/trash",
  );
  assert.equal(
    buildAppUrl({ tab: "mail", messageId: "msg_abc" }),
    "/mail/message/msg_abc",
  );
  assert.equal(
    buildAppUrl({ tab: "mail", mailView: "folder", folderId: "fld_77" }),
    "/mail/folder/fld_77",
  );
});
