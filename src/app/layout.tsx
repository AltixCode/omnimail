import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  title: {
    default: "OmniMail — Unified Multi-Account Webmail & CalDAV Client",
    template: "%s | OmniMail",
  },
  description:
    "Open-source, privacy-first unified webmail and CalDAV calendar client with persistent IMAP IDLE real-time push streaming, sandboxed email rendering, and AES-256 encrypted credential vault.",
  applicationName: "OmniMail",
  authors: [{ name: "AltixCode", url: "https://altixcode.com" }],
  keywords: [
    "webmail",
    "email client",
    "caldav",
    "calendar",
    "unified inbox",
    "imap idle",
    "self-hosted",
    "privacy",
    "open-source webmail",
  ],
  creator: "AltixCode",
  publisher: "AltixCode",
  robots: {
    index: false,
    follow: false,
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://webmail.altixcode.com",
    siteName: "OmniMail",
    title: "OmniMail — Unified Multi-Account Webmail & CalDAV Client",
    description:
      "Open-source, privacy-first unified webmail and CalDAV calendar client with persistent IMAP IDLE real-time push streaming.",
  },
  twitter: {
    card: "summary",
    title: "OmniMail — Unified Webmail & CalDAV Client",
    description:
      "Open-source, privacy-first unified webmail and CalDAV calendar client with persistent IMAP IDLE real-time push streaming.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-slate-950 text-slate-100">{children}</body>
    </html>
  );
}
