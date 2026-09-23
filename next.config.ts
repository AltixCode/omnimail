import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@prisma/client", "prisma", "imapflow", "mailparser", "nodemailer", "tsdav", "ical.js"],
};

export default nextConfig;
