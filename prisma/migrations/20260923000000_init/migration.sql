-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "imapHost" TEXT NOT NULL,
    "imapPort" INTEGER NOT NULL DEFAULT 993,
    "imapSecure" BOOLEAN NOT NULL DEFAULT true,
    "imapUser" TEXT NOT NULL,
    "imapPassEnc" TEXT NOT NULL,
    "smtpHost" TEXT NOT NULL,
    "smtpPort" INTEGER NOT NULL DEFAULT 587,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
    "smtpUser" TEXT NOT NULL,
    "smtpPassEnc" TEXT NOT NULL,
    "caldavUrl" TEXT,
    "caldavUser" TEXT,
    "caldavPassEnc" TEXT,
    "syncActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "syncStatus" TEXT DEFAULT 'idle',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "specialUse" TEXT,
    "uidValidity" BIGINT,
    "highestModSeq" BIGINT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "uid" INTEGER NOT NULL,
    "messageId" TEXT,
    "threadId" TEXT,
    "fromAddress" TEXT NOT NULL,
    "fromName" TEXT,
    "toAddresses" TEXT NOT NULL,
    "ccAddresses" TEXT,
    "bccAddresses" TEXT,
    "replyTo" TEXT,
    "subject" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "snippet" TEXT,
    "bodyText" TEXT,
    "bodyHtml" TEXT,
    "flags" TEXT NOT NULL DEFAULT '[]',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "isStarred" BOOLEAN NOT NULL DEFAULT false,
    "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
    "rawHeaders" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "contentId" TEXT,
    "storagePath" TEXT,
    "dataBase64" TEXT,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Calendar" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3b82f6',
    "caldavUrl" TEXT NOT NULL,
    "syncToken" TEXT,

    CONSTRAINT "Calendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isAllDay" BOOLEAN NOT NULL DEFAULT false,
    "rrule" TEXT,
    "etag" TEXT,
    "rawIcs" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "MailAccount_userId_idx" ON "MailAccount"("userId");

-- CreateIndex
CREATE INDEX "Folder_accountId_idx" ON "Folder"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Folder_accountId_path_key" ON "Folder"("accountId", "path");

-- CreateIndex
CREATE INDEX "Message_accountId_date_idx" ON "Message"("accountId", "date");

-- CreateIndex
CREATE INDEX "Message_folderId_date_idx" ON "Message"("folderId", "date");

-- CreateIndex
CREATE INDEX "Message_threadId_idx" ON "Message"("threadId");

-- CreateIndex
CREATE INDEX "Message_isRead_idx" ON "Message"("isRead");

-- CreateIndex
CREATE INDEX "Message_isStarred_idx" ON "Message"("isStarred");

-- CreateIndex
CREATE UNIQUE INDEX "Message_folderId_uid_key" ON "Message"("folderId", "uid");

-- CreateIndex
CREATE INDEX "Attachment_messageId_idx" ON "Attachment"("messageId");

-- CreateIndex
CREATE INDEX "Calendar_accountId_idx" ON "Calendar"("accountId");

-- CreateIndex
CREATE INDEX "CalendarEvent_calendarId_startDate_endDate_idx" ON "CalendarEvent"("calendarId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "CalendarEvent_startDate_endDate_idx" ON "CalendarEvent"("startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_calendarId_uid_key" ON "CalendarEvent"("calendarId", "uid");

-- AddForeignKey
ALTER TABLE "MailAccount" ADD CONSTRAINT "MailAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calendar" ADD CONSTRAINT "Calendar_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "Calendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

