import prisma from "@/lib/db";
import imapWorkerPool from "@/server/imap-worker";

/**
 * Permanently deletes an OmniMail user account and all associated data:
 * - Stops any active IMAP IDLE workers for the user's connected mailboxes.
 * - Deletes non-FK queue/tombstone rows scoped by accountId.
 * - Deletes the User row (cascading to MailAccount, Folder, Message,
 *   Attachment, Calendar, CalendarEvent, TrustedSender, DevicePushToken,
 *   and ScheduledEmail).
 */
export async function deleteUserAccount(userId: string): Promise<{ deletedAccountCount: number }> {
  const mailAccounts = await prisma.mailAccount.findMany({
    where: { userId },
    select: { id: true },
  });
  const accountIds = mailAccounts.map((account) => account.id);

  for (const accountId of accountIds) {
    try {
      await imapWorkerPool.stopAccount(accountId);
    } catch (err) {
      console.warn(`Failed to stop IMAP worker for account ${accountId}:`, err);
    }
  }

  await prisma.$transaction(async (tx) => {
    if (accountIds.length > 0) {
      await tx.syncActionQueue.deleteMany({
        where: { accountId: { in: accountIds } },
      });
      await tx.tombstone.deleteMany({
        where: { accountId: { in: accountIds } },
      });
    }

    await tx.user.delete({
      where: { id: userId },
    });
  });

  return { deletedAccountCount: accountIds.length };
}
