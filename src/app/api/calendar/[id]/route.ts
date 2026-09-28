import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import eventBus from "@/server/event-bus";
import caldavWorker from "@/server/caldav-worker";
import { getOrCreateDefaultUser } from "@/lib/user";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getOrCreateDefaultUser(req);
    const { id } = await params;
    const event = await prisma.calendarEvent.findUnique({
      where: { id },
      include: {
        calendar: { include: { account: { select: { userId: true } } } },
      },
    });

    if (!event || event.calendar.account.userId !== user.id) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Delete remotely in background if backed by CalDAV
    caldavWorker.deleteRemoteEvent(event.calendarId, event.uid).catch((err) => {
      console.warn("Background CalDAV delete error:", err);
    });

    await prisma.calendarEvent.delete({
      where: { id },
    });

    eventBus.broadcast("calendar-updated", {
      deletedEventId: id,
      calendarId: event.calendarId,
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getOrCreateDefaultUser(req);
    const { id } = await params;

    const existing = await prisma.calendarEvent.findUnique({
      where: { id },
      select: {
        calendar: { select: { account: { select: { userId: true } } } },
      },
    });
    if (!existing || existing.calendar.account.userId !== user.id) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const body = await req.json();

    const data: any = {};
    if (body.summary !== undefined) data.summary = body.summary;
    if (body.description !== undefined) data.description = body.description;
    if (body.location !== undefined) data.location = body.location;
    if (body.startDate) data.startDate = new Date(body.startDate);
    if (body.endDate) data.endDate = new Date(body.endDate);
    if (body.isAllDay !== undefined) data.isAllDay = Boolean(body.isAllDay);

    const updated = await prisma.calendarEvent.update({
      where: { id },
      data,
      include: { calendar: true },
    });

    // Push updated event to remote CalDAV in background
    caldavWorker.pushEventToRemote(updated.calendarId, updated).catch((err) => {
      console.warn("Background CalDAV update error:", err);
    });

    eventBus.broadcast("calendar-updated", {
      eventId: id,
      calendarId: updated.calendarId,
    });
    return NextResponse.json({ success: true, event: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
