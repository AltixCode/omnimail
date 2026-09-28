import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How OmniMail collects, stores, and protects your account and mail data across the web and mobile apps.",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24">
      <a
        href="/"
        className="text-sm text-slate-400 hover:text-slate-200 transition-colors"
      >
        ← Back to OmniMail
      </a>

      <h1 className="mt-6 text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl">
        Privacy Policy
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        Last updated: September 28, 2026
      </p>

      <div className="mt-10 space-y-10 text-slate-300 leading-relaxed">
        <section>
          <h2 className="text-lg font-medium text-slate-100">1. Overview</h2>
          <p className="mt-3">
            OmniMail (&ldquo;we&rdquo;, &ldquo;our&rdquo;, &ldquo;the
            service&rdquo;) is a unified webmail and calendar aggregator,
            available at{" "}
            <a
              href="https://webmail.altixcode.com"
              className="underline underline-offset-2 hover:text-slate-100"
            >
              webmail.altixcode.com
            </a>{" "}
            and through the OmniMail mobile app for iOS and Android. This policy
            explains what data OmniMail processes, why, and how it is protected,
            for both the web application and the mobile companion app.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-medium text-slate-100">
            2. What we collect
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              <strong className="text-slate-100">Account information:</strong>{" "}
              the email address and name you register with, and a securely
              hashed password.
            </li>
            <li>
              <strong className="text-slate-100">
                Connected mail &amp; calendar accounts:
              </strong>{" "}
              IMAP/SMTP/CalDAV credentials you provide to connect your own
              mailboxes and calendars are encrypted at rest and used solely to
              synchronize your mail and events on your behalf.
            </li>
            <li>
              <strong className="text-slate-100">
                Mail and calendar content:
              </strong>{" "}
              messages, folders, attachments, and calendar events are synced
              from your connected accounts so they can be displayed in OmniMail.
              We do not read, scan, or use this content for advertising.
            </li>
            <li>
              <strong className="text-slate-100">Device push token:</strong> if
              you enable notifications in the mobile app, we store an Expo push
              token tied to your account so we can notify your device of new
              mail.
            </li>
            <li>
              <strong className="text-slate-100">Session tokens:</strong> a
              signed session token is issued on login and stored in your browser
              or, on mobile, in the device&rsquo;s hardware-backed secure
              storage (Keychain / Keystore). It is never stored as plain text.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-medium text-slate-100">
            3. What we do not do
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>
              We do not sell or share your mail content or account data with
              third parties.
            </li>
            <li>
              We do not run advertising or ad-tracking SDKs in the mobile app.
            </li>
            <li>
              We do not store your mail account password in plain text —
              connected-account credentials are encrypted at rest.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-medium text-slate-100">
            4. Data retention &amp; deletion
          </h2>
          <p className="mt-3">
            Your account data and synced mail/calendar content are retained for
            as long as your account is active. You can disconnect a mail account
            at any time from Settings, which stops further synchronization and
            removes the stored credentials for that account. To request full
            account deletion, contact us using the details below.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-medium text-slate-100">
            5. Mobile app permissions
          </h2>
          <p className="mt-3">
            The OmniMail mobile app requests notification permission to deliver
            new-mail alerts. No other device permissions are required or
            requested.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-medium text-slate-100">6. Contact</h2>
          <p className="mt-3">
            Questions about this policy or a data request can be sent to{" "}
            <a
              href="mailto:ata@altixcode.com"
              className="underline underline-offset-2 hover:text-slate-100"
            >
              ata@altixcode.com
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
