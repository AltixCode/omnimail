import prisma from "./db";

export async function getOrCreateDefaultUser() {
  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: "owner@omnimail.local",
        name: "OmniMail User",
      },
    });
  }
  return user;
}
