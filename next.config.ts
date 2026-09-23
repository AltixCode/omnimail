import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "prisma", "imapflow", "mailparser", "nodemailer", "tsdav", "ical.js"],
};

export default nextConfig;
