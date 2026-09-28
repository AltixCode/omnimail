import prisma from "@/lib/db";

export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, any>;
  sound?: string | null;
  badge?: number;
  channelId?: string;
}

export interface RegisterDeviceParams {
  userId: string;
  token: string;
  platform: string;
  deviceId?: string;
  deviceModel?: string;
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/**
 * Registers or updates a device push token for an authenticated user.
 */
export async function registerDeviceToken(params: RegisterDeviceParams) {
  const { userId, token, platform, deviceId, deviceModel } = params;

  if (!token || !token.trim()) {
    throw new Error("Push token is required");
  }

  const normalizedToken = token.trim();
  const normalizedPlatform = (platform || "unknown").toLowerCase();

  return await prisma.devicePushToken.upsert({
    where: { token: normalizedToken },
    update: {
      userId,
      platform: normalizedPlatform,
      deviceId: deviceId || null,
      deviceModel: deviceModel || null,
      updatedAt: new Date(),
    },
    create: {
      userId,
      token: normalizedToken,
      platform: normalizedPlatform,
      deviceId: deviceId || null,
      deviceModel: deviceModel || null,
    },
  });
}

/**
 * Unregisters a device push token.
 */
export async function unregisterDeviceToken(userId: string, token: string) {
  if (!token) return { count: 0 };
  return await prisma.devicePushToken.deleteMany({
    where: {
      userId,
      token: token.trim(),
    },
  });
}

/**
 * Lists all registered device tokens for a user.
 */
export async function getUserDeviceTokens(userId: string) {
  return await prisma.devicePushToken.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      token: true,
      platform: true,
      deviceId: true,
      deviceModel: true,
      updatedAt: true,
      createdAt: true,
    },
  });
}

/**
 * Dispatches push notifications to all registered devices for a given user.
 * Supports background wake-up payload (_contentAvailable: true) and auto-prunes
 * expired or unregistered tokens.
 */
export async function sendPushNotificationToUser(
  userId: string,
  payload: PushNotificationPayload
) {
  try {
    const devices = await prisma.devicePushToken.findMany({
      where: { userId },
    });

    if (devices.length === 0) {
      return { success: true, sent: 0, removed: 0 };
    }

    const messages = devices.map((d) => ({
      to: d.token,
      sound: payload.sound ?? "default",
      title: payload.title,
      body: payload.body,
      badge: payload.badge,
      priority: "high",
      channelId: payload.channelId || "default",
      categoryId: "email_actions",
      data: {
        ...(payload.data || {}),
        _contentAvailable: true, // iOS/Android background wake-up flag
      },
    }));

    // Expo supports batch sending up to 100 messages per chunk
    const chunks: typeof messages[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      chunks.push(messages.slice(i, i + 100));
    }

    let sentCount = 0;
    const tokensToRemove: string[] = [];

    for (const chunk of chunks) {
      try {
        const response = await fetch(EXPO_PUSH_URL, {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Accept-Encoding": "gzip, deflate",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(chunk),
        });

        if (!response.ok) {
          console.error("Expo push notification HTTP error:", response.status, await response.text());
          continue;
        }

        const result = await response.json();
        const tickets = result.data || [];

        for (let i = 0; i < tickets.length; i++) {
          const ticket = tickets[i];
          const targetToken = chunk[i]?.to;

          if (ticket.status === "ok") {
            sentCount++;
          } else if (ticket.status === "error") {
            console.warn(`Push error for token ${targetToken}:`, ticket.message, ticket.details);
            if (ticket.details?.error === "DeviceNotRegistered" && targetToken) {
              tokensToRemove.push(targetToken);
            }
          }
        }
      } catch (chunkErr) {
        console.error("Error sending push notification chunk:", chunkErr);
      }
    }

    // Prune invalid tokens
    if (tokensToRemove.length > 0) {
      await prisma.devicePushToken.deleteMany({
        where: { token: { in: tokensToRemove } },
      });
      console.log(`Pruned ${tokensToRemove.length} unregistered device token(s).`);
    }

    return {
      success: true,
      sent: sentCount,
      removed: tokensToRemove.length,
    };
  } catch (error) {
    console.error("Failed to send push notification to user:", error);
    return { success: false, error: String(error) };
  }
}
