-- Additive: AltixAuth (Authentik OIDC) subject for single sign-on.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "oidcSub" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_oidcSub_key" ON "User"("oidcSub");
