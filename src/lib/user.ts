import prisma from "./db";
import { getCurrentUser } from "./auth";
import { NextRequest } from "next/server";

export async function getOrCreateDefaultUser(req?: NextRequest | Request) {
  if (req) {
    const authUser = await getCurrentUser(req);
    if (authUser) {
      const fullUser = await prisma.user.findUnique({ where: { id: authUser.id } });
      if (fullUser) return fullUser;
    }
  }

  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: "admin@omnimail.local",
        name: "OmniMail Admin",
      },
    });
  }
  return user;
}

export default getOrCreateDefaultUser;
