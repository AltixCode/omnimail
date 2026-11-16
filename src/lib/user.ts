import prisma from "./db";
import { getCurrentUser } from "./auth";
import { NextRequest } from "next/server";

export class UnauthenticatedError extends Error {
  readonly status = 401;
  constructor() {
    super("Unauthorized");
    this.name = "UnauthenticatedError";
  }
}

/**
 * Returns the signed-in user for this request.
 *
 * The name is historical: this used to fall back to the first user in the
 * database whenever the request carried no session, which served that user's
 * mailboxes to any anonymous caller. It now throws UnauthenticatedError
 * instead; it never creates or picks a user.
 */
export async function getOrCreateDefaultUser(req?: NextRequest | Request) {
  const authUser = await getCurrentUser(req);
  if (authUser) {
    const fullUser = await prisma.user.findUnique({ where: { id: authUser.id } });
    if (fullUser) return fullUser;
  }
  throw new UnauthenticatedError();
}

export default getOrCreateDefaultUser;
