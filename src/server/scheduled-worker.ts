import prisma from "@/lib/db";
import { sendEmail } from "./smtp-dispatcher";
import eventBus from "./event-bus";

export interface ScheduledEmailInput {
  userId: string;
  accountId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  inReplyTo?: string;
  references?: string;
  threadId?: string;
  scheduledAt: Date;
  timezone: string;
  attachments?: Array<{
    filename: string;
    content: string; // base64
    contentType: string;
    size?: number;
  }>;
}

export class ScheduledEmailWorker {
  private timer: NodeJS.Timeout | null = null;
  private precisionTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private isStarted = false;

  constructor() {
    this.start();
  }

  public start() {
    if (this.isStarted) return;
    this.isStarted = true;

    // Run tick every 10 seconds for reliable background processing
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        console.error("[ScheduledEmailWorker] Tick error:", err);
      });
    }, 10000);
    if (this.timer && typeof this.timer.unref === "function") {
      this.timer.unref();
    }

    // Initial check
    this.tick().catch(() => {});
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.precisionTimer) {
      clearTimeout(this.precisionTimer);
      this.precisionTimer = null;
    }
    this.isStarted = false;
  }

  /**
   * Schedules a precise timer if the next pending email is due soon.
   */
  public async scheduleNextPreciseTimer() {
    try {
      if (this.precisionTimer) {
        clearTimeout(this.precisionTimer);
        this.precisionTimer = null;
      }

      const nextPending = await prisma.scheduledEmail.findFirst({
        where: { status: "pending" },
        orderBy: { scheduledAt: "asc" },
        select: { id: true, scheduledAt: true },
      });

      if (!nextPending) return;

      const diffMs = nextPending.scheduledAt.getTime() - Date.now();
      // If within 15 minutes, set an exact timer
      if (diffMs > 0 && diffMs <= 15 * 60 * 1000) {
        this.precisionTimer = setTimeout(() => {
          this.tick().catch((err) => console.error("[ScheduledEmailWorker] Precision tick error:", err));
        }, diffMs);
        if (this.precisionTimer && typeof this.precisionTimer.unref === "function") {
          this.precisionTimer.unref();
        }
      } else if (diffMs <= 0) {
        // Due right now
        this.tick().catch(() => {});
      }
    } catch (err) {
      console.warn("[ScheduledEmailWorker] Failed to schedule precise timer:", err);
    }
  }

  /**
   * Checks for and sends any emails whose scheduledAt timestamp has arrived.
   */
  public async tick() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const now = new Date();

      // Find all pending emails whose scheduled time has arrived (scheduledAt <= now)
      const dueEmails = await prisma.scheduledEmail.findMany({
        where: {
          status: "pending",
          scheduledAt: { lte: now },
        },
        include: {
          attachments: true,
          account: true,
        },
        take: 20, // Process in batches
      });

      for (const scheduled of dueEmails) {
        // Atomically claim the email to avoid duplicate processing in concurrent nodes
        const claimed = await prisma.scheduledEmail.updateMany({
          where: {
            id: scheduled.id,
            status: "pending",
          },
          data: {
            status: "sending",
          },
        });

        if (claimed.count === 0) {
          // Already claimed by another worker tick
          continue;
        }

        try {
          const toArray = JSON.parse(scheduled.toAddresses || "[]");
          const ccArray = scheduled.ccAddresses ? JSON.parse(scheduled.ccAddresses) : undefined;
          const bccArray = scheduled.bccAddresses ? JSON.parse(scheduled.bccAddresses) : undefined;

          const attachments = scheduled.attachments.map((att) => ({
            filename: att.filename,
            content: att.dataBase64,
            contentType: att.contentType,
          }));

          const result = await sendEmail({
            accountId: scheduled.accountId,
            to: toArray,
            cc: ccArray,
            bcc: bccArray,
            subject: scheduled.subject,
            bodyText: scheduled.bodyText || undefined,
            bodyHtml: scheduled.bodyHtml || undefined,
            inReplyTo: scheduled.inReplyTo || undefined,
            references: scheduled.references || undefined,
            threadId: scheduled.threadId || undefined,
            attachments: attachments.length > 0 ? attachments : undefined,
          });

          if (result.success) {
            await prisma.scheduledEmail.update({
              where: { id: scheduled.id },
              data: {
                status: "sent",
                sentAt: new Date(),
                error: null,
              },
            });

            // Notify UI via Server-Sent Events
            eventBus.broadcast("scheduled-updated", {
              action: "sent",
              id: scheduled.id,
              accountId: scheduled.accountId,
              subject: scheduled.subject,
            });
          } else {
            console.error(`[ScheduledEmailWorker] Failed sending ${scheduled.id}:`, result.error);
            await prisma.scheduledEmail.update({
              where: { id: scheduled.id },
              data: {
                status: "failed",
                error: result.error || "Failed to send scheduled message via SMTP",
              },
            });

            eventBus.broadcast("scheduled-updated", {
              action: "failed",
              id: scheduled.id,
              accountId: scheduled.accountId,
              error: result.error,
            });
          }
        } catch (sendErr: any) {
          console.error(`[ScheduledEmailWorker] Exception sending ${scheduled.id}:`, sendErr);
          await prisma.scheduledEmail.update({
            where: { id: scheduled.id },
            data: {
              status: "failed",
              error: sendErr?.message || String(sendErr),
            },
          });
        }
      }
    } catch (err) {
      console.error("[ScheduledEmailWorker] Error during tick:", err);
    } finally {
      this.isProcessing = false;
      this.scheduleNextPreciseTimer().catch(() => {});
    }
  }

  /**
   * Creates a new scheduled email.
   */
  public async createScheduledEmail(input: ScheduledEmailInput) {
    const scheduled = await prisma.scheduledEmail.create({
      data: {
        userId: input.userId,
        accountId: input.accountId,
        toAddresses: JSON.stringify(input.to),
        ccAddresses: input.cc && input.cc.length > 0 ? JSON.stringify(input.cc) : null,
        bccAddresses: input.bcc && input.bcc.length > 0 ? JSON.stringify(input.bcc) : null,
        subject: input.subject,
        bodyText: input.bodyText || null,
        bodyHtml: input.bodyHtml || null,
        inReplyTo: input.inReplyTo || null,
        references: input.references || null,
        threadId: input.threadId || null,
        scheduledAt: input.scheduledAt,
        timezone: input.timezone,
        status: "pending",
        attachments: input.attachments && input.attachments.length > 0
          ? {
              create: input.attachments.map((att) => ({
                filename: att.filename,
                contentType: att.contentType,
                size: att.size || Math.round((att.content.length * 3) / 4),
                dataBase64: att.content,
              })),
            }
          : undefined,
      },
      include: {
        attachments: {
          select: {
            id: true,
            filename: true,
            contentType: true,
            size: true,
          },
        },
        account: {
          select: {
            label: true,
            emailAddress: true,
          },
        },
      },
    });

    // Broadcast SSE update
    eventBus.broadcast("scheduled-updated", {
      action: "created",
      id: scheduled.id,
      accountId: scheduled.accountId,
    });

    this.scheduleNextPreciseTimer().catch(() => {});

    return scheduled;
  }

  /**
   * Updates an existing pending scheduled email.
   */
  public async updateScheduledEmail(
    id: string,
    userId: string,
    input: Partial<ScheduledEmailInput>
  ) {
    const existing = await prisma.scheduledEmail.findUnique({
      where: { id },
      include: { attachments: true },
    });

    if (!existing || existing.userId !== userId) {
      throw new Error("Scheduled email not found or unauthorized");
    }

    if (existing.status !== "pending") {
      throw new Error(`Cannot edit scheduled email with status: ${existing.status}`);
    }

    const data: any = {};
    if (input.accountId) data.accountId = input.accountId;
    if (input.to) data.toAddresses = JSON.stringify(input.to);
    if (input.cc !== undefined) {
      data.ccAddresses = input.cc && input.cc.length > 0 ? JSON.stringify(input.cc) : null;
    }
    if (input.bcc !== undefined) {
      data.bccAddresses = input.bcc && input.bcc.length > 0 ? JSON.stringify(input.bcc) : null;
    }
    if (input.subject !== undefined) data.subject = input.subject;
    if (input.bodyText !== undefined) data.bodyText = input.bodyText;
    if (input.bodyHtml !== undefined) data.bodyHtml = input.bodyHtml;
    if (input.scheduledAt !== undefined) data.scheduledAt = input.scheduledAt;
    if (input.timezone !== undefined) data.timezone = input.timezone;

    // If new attachments are provided, replace them
    if (input.attachments !== undefined) {
      await prisma.scheduledAttachment.deleteMany({
        where: { scheduledEmailId: id },
      });

      if (input.attachments.length > 0) {
        await prisma.scheduledAttachment.createMany({
          data: input.attachments.map((att) => ({
            scheduledEmailId: id,
            filename: att.filename,
            contentType: att.contentType,
            size: att.size || Math.round((att.content.length * 3) / 4),
            dataBase64: att.content,
          })),
        });
      }
    }

    const updated = await prisma.scheduledEmail.update({
      where: { id },
      data,
      include: {
        attachments: {
          select: {
            id: true,
            filename: true,
            contentType: true,
            size: true,
          },
        },
        account: {
          select: {
            label: true,
            emailAddress: true,
          },
        },
      },
    });

    eventBus.broadcast("scheduled-updated", {
      action: "updated",
      id: updated.id,
      accountId: updated.accountId,
    });

    this.scheduleNextPreciseTimer().catch(() => {});

    return updated;
  }

  /**
   * Sends a scheduled email immediately right now ("Send now").
   */
  public async sendScheduledEmailNow(id: string, userId: string) {
    const scheduled = await prisma.scheduledEmail.findUnique({
      where: { id },
      include: {
        attachments: true,
        account: true,
      },
    });

    if (!scheduled || scheduled.userId !== userId) {
      throw new Error("Scheduled email not found or unauthorized");
    }

    if (scheduled.status !== "pending") {
      throw new Error(`Email is already ${scheduled.status}`);
    }

    await prisma.scheduledEmail.update({
      where: { id },
      data: { status: "sending" },
    });

    const toArray = JSON.parse(scheduled.toAddresses || "[]");
    const ccArray = scheduled.ccAddresses ? JSON.parse(scheduled.ccAddresses) : undefined;
    const bccArray = scheduled.bccAddresses ? JSON.parse(scheduled.bccAddresses) : undefined;

    const attachments = scheduled.attachments.map((att) => ({
      filename: att.filename,
      content: att.dataBase64,
      contentType: att.contentType,
    }));

    const result = await sendEmail({
      accountId: scheduled.accountId,
      to: toArray,
      cc: ccArray,
      bcc: bccArray,
      subject: scheduled.subject,
      bodyText: scheduled.bodyText || undefined,
      bodyHtml: scheduled.bodyHtml || undefined,
      inReplyTo: scheduled.inReplyTo || undefined,
      references: scheduled.references || undefined,
      threadId: scheduled.threadId || undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    if (result.success) {
      await prisma.scheduledEmail.update({
        where: { id: scheduled.id },
        data: {
          status: "sent",
          sentAt: new Date(),
          error: null,
        },
      });

      eventBus.broadcast("scheduled-updated", {
        action: "sent",
        id: scheduled.id,
        accountId: scheduled.accountId,
      });

      return { success: true };
    } else {
      await prisma.scheduledEmail.update({
        where: { id: scheduled.id },
        data: {
          status: "failed",
          error: result.error,
        },
      });
      throw new Error(result.error || "Failed to send email");
    }
  }

  /**
   * Cancels and deletes a scheduled email.
   */
  public async deleteScheduledEmail(id: string, userId: string) {
    const scheduled = await prisma.scheduledEmail.findUnique({
      where: { id },
      select: { id: true, userId: true, accountId: true },
    });

    if (!scheduled || scheduled.userId !== userId) {
      throw new Error("Scheduled email not found or unauthorized");
    }

    await prisma.scheduledEmail.delete({
      where: { id },
    });

    eventBus.broadcast("scheduled-updated", {
      action: "deleted",
      id,
      accountId: scheduled.accountId,
    });

    this.scheduleNextPreciseTimer().catch(() => {});

    return { success: true };
  }

  /**
   * Retrieves pending scheduled emails formatted as MessageListItem.
   */
  public async getScheduledMessagesForUser(
    userId: string,
    accountId?: string
  ) {
    const where: any = {
      userId,
      status: "pending",
    };
    if (accountId) {
      where.accountId = accountId;
    }

    const items = await prisma.scheduledEmail.findMany({
      where,
      orderBy: { scheduledAt: "asc" },
      include: {
        account: {
          select: {
            id: true,
            label: true,
            emailAddress: true,
          },
        },
        attachments: {
          select: {
            id: true,
            filename: true,
            contentType: true,
            size: true,
          },
        },
      },
    });

    return items.map((item) => {
      let snippet = (item.bodyText || item.subject || "").slice(0, 250);
      return {
        id: `sched_${item.id}`,
        scheduledId: item.id,
        isScheduled: true,
        scheduledAt: item.scheduledAt.toISOString(),
        timezone: item.timezone,
        accountId: item.accountId,
        folderId: "scheduled",
        uid: 0,
        messageId: null,
        threadId: item.threadId || null,
        fromAddress: item.account.emailAddress,
        fromName: item.account.label,
        toAddresses: item.toAddresses,
        ccAddresses: item.ccAddresses,
        bccAddresses: item.bccAddresses,
        subject: item.subject,
        date: item.scheduledAt.toISOString(),
        snippet,
        bodyText: item.bodyText,
        bodyHtml: item.bodyHtml,
        isRead: true,
        isStarred: false,
        hasAttachments: item.attachments.length > 0,
        account: {
          label: item.account.label,
          emailAddress: item.account.emailAddress,
        },
        folder: {
          id: "scheduled",
          name: "Scheduled",
          path: "Scheduled",
          specialUse: "\\Scheduled",
        },
        attachments: item.attachments,
      };
    });
  }

  /**
   * Retrieves full details of a single scheduled email.
   */
  public async getScheduledEmailDetail(id: string, userId: string) {
    const cleanId = id.startsWith("sched_") ? id.slice(6) : id;
    const item = await prisma.scheduledEmail.findUnique({
      where: { id: cleanId },
      include: {
        account: {
          select: {
            id: true,
            userId: true,
            label: true,
            emailAddress: true,
          },
        },
        attachments: true,
      },
    });

    if (!item || item.userId !== userId) {
      return null;
    }

    let snippet = (item.bodyText || item.subject || "").slice(0, 250);

    return {
      id: `sched_${item.id}`,
      scheduledId: item.id,
      isScheduled: true,
      scheduledAt: item.scheduledAt.toISOString(),
      timezone: item.timezone,
      status: item.status,
      accountId: item.accountId,
      folderId: "scheduled",
      uid: 0,
      messageId: null,
      threadId: item.threadId || null,
      fromAddress: item.account.emailAddress,
      fromName: item.account.label,
      toAddresses: item.toAddresses,
      ccAddresses: item.ccAddresses,
      bccAddresses: item.bccAddresses,
      subject: item.subject,
      date: item.scheduledAt.toISOString(),
      snippet,
      bodyText: item.bodyText,
      bodyHtml: item.bodyHtml,
      isRead: true,
      isStarred: false,
      hasAttachments: item.attachments.length > 0,
      account: {
        id: item.account.id,
        userId: item.account.userId,
        label: item.account.label,
        emailAddress: item.account.emailAddress,
      },
      folder: {
        id: "scheduled",
        name: "Scheduled",
        path: "Scheduled",
        specialUse: "\\Scheduled",
      },
      attachments: item.attachments.map((att) => ({
        id: att.id,
        filename: att.filename,
        contentType: att.contentType,
        size: att.size,
        contentId: att.contentId,
        dataBase64: att.dataBase64,
      })),
    };
  }
}

const globalForScheduled = globalThis as unknown as {
  scheduledEmailWorker: ScheduledEmailWorker | undefined;
};

export const scheduledEmailWorker =
  globalForScheduled.scheduledEmailWorker ?? new ScheduledEmailWorker();

if (process.env.NODE_ENV !== "production") {
  globalForScheduled.scheduledEmailWorker = scheduledEmailWorker;
}

export default scheduledEmailWorker;
