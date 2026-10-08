-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "gmailMessageId" TEXT;

-- CreateIndex
CREATE INDEX "Message_accountId_gmailMessageId_idx" ON "Message"("accountId", "gmailMessageId");
