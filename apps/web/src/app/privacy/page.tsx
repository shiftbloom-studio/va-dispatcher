import type { Metadata } from "next";
import { connection } from "next/server";

import {
  LegalPageShell,
  LegalSection,
  LegalTable,
} from "@/components/legal-page-shell";
import { LEGAL_NOTICE_LAST_UPDATED, loadLegalConfig } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Notice",
  description:
    "How vSAS Live Operations processes personal data and uses essential browser storage.",
};

const externalLinkClass =
  "font-semibold text-slate-950 underline underline-offset-4";

export default async function PrivacyPage() {
  await connection();
  const config = loadLegalConfig();

  return (
    <LegalPageShell
      title="Privacy Notice"
      description={`How personal data is processed when you use vSAS Live Operations. Last updated: ${LEGAL_NOTICE_LAST_UPDATED}.`}
      config={config}
    >
      <LegalSection title="1. Controller and privacy contact">
        <p>
          The controller responsible for the processing described in this notice
          is:
        </p>
        <address className="not-italic">
          <strong className="text-slate-950">{config.operatorName}</strong>
          {config.operatorDescription ? (
            <>
              <br />
              <span>{config.operatorDescription}</span>
            </>
          ) : null}
          <br />
          {config.addressLines.map((line) => (
            <span key={line}>
              {line}
              <br />
            </span>
          ))}
          Privacy email:{" "}
          <a
            href={`mailto:${config.privacyEmail}`}
            className={externalLinkClass}
          >
            {config.privacyEmail}
          </a>
        </address>
      </LegalSection>

      <LegalSection title="2. Scope and data sources">
        <p>
          This notice covers the web application, its same-origin API, and the
          operational data handled through them. Data comes from you, Virtual
          Airline administrators and dispatchers, the configured authentication
          provider, and—when live ACARS is enabled—participating Hoppie&apos;s
          ACARS stations. When you create a simulator connection, data also
          comes from the MSFS 2024 client you configure with its one-time device
          token.
        </p>
        <p>
          The service is multi-tenant. Membership and operational records are
          restricted to the Virtual Airline organization associated with your
          authenticated account.
        </p>
      </LegalSection>

      <LegalSection title="3. Processing activities and legal bases">
        <LegalTable
          caption="Personal-data processing activities"
          headings={["Data", "Purpose", "Legal basis", "Retention criteria"]}
          rows={[
            [
              "Account identifiers, name, email or login identifier, organization, role, display name, and pilot callsign",
              "Authenticate you, maintain membership, authorize tenant and role access, and administer the service",
              "Article 6(1)(b) GDPR where needed to provide the requested member service; otherwise Article 6(1)(f) GDPR (operate and secure the voluntary service)",
              "For the active account or membership and afterwards only while needed for account closure, legal obligations, or legal claims",
            ],
            [
              "Availability windows, schedule requests, preferences, notes, assigned flights, timestamps, and operational status",
              "Build and coordinate requested virtual flight schedules and keep an operational history",
              "Article 6(1)(b) GDPR where needed for the member service; otherwise Article 6(1)(f) GDPR (coordinate Virtual Airline operations)",
              "While required for the member service and operational history; then deleted or anonymized unless obligations or claims require longer retention",
            ],
            [
              "Simulator device name and revocation state; assigned flight and device links; exact latitude/longitude, altitude, speed, heading, simulator time, phase and heartbeat; automatic or corrected OOOI provenance",
              "Show the assigned pilot's simulator connection, give dispatch current simulated-flight awareness, keep a short operational track, and derive auditable Out/Off/On/In events",
              "Article 6(1)(b) GDPR where needed for the requested member service; otherwise Article 6(1)(f) GDPR (coordinate voluntary Virtual Airline simulator operations). Creating and configuring a device is voluntary and is not optional analytics consent",
              "Current position is replaced by each sample. While reporting, accepted samples prune track history to the newest 5,000 points and physically remove points older than 24 hours; track views exclude every older sample. Dormant rows, device records, and OOOI records follow the approved recurring account and operational-history deletion process or a valid rights request",
            ],
            [
              "Hoppie's ACARS station identifiers, virtual message text, direction, provider metadata, and timestamps",
              "Exchange and display virtual operational messages through Hoppie's ACARS",
              "Article 6(1)(b) GDPR where needed for the member service; otherwise Article 6(1)(f) GDPR (operate Virtual Airline communications)",
              "While needed for current operations, support, abuse handling, and legal claims. The external Hoppie queue states a 24-hour message lifetime",
            ],
            [
              "Audit events, request IDs, authentication events, IP address, device/browser and server log data, and BotID challenge results and browser/request signals on protected mutations",
              "Protect accounts and infrastructure, diagnose faults, prevent abuse, and establish or defend legal claims",
              "Article 6(1)(f) GDPR (legitimate interests in secure and reliable operations)",
              "Only for the period necessary for security review, incident response, troubleshooting, and applicable claims; records are then deleted or aggregated",
            ],
            [
              "Aggregated page routes, referrers, coarse location and device categories, and browser performance metrics",
              "Understand service usage and improve reliability and performance",
              "Article 6(1)(a) GDPR (consent); the optional telemetry remains off until allowed",
              "According to the configured Vercel Analytics and Speed Insights retention periods; Web Analytics visitor hashes reset daily",
            ],
          ]}
        />
        <p>
          You are not legally required to provide this information. Account and
          core operational data are, however, necessary to provide the signed-in
          service. Without them, an account or requested dispatch function may
          not be available.
        </p>
      </LegalSection>

      <LegalSection title="4. Recipients and service providers">
        <p>
          Authorized Virtual Airline members receive only the information their
          operational role permits. The following providers process data to run
          the service:
        </p>
        <p>
          MSFS telemetry is sent from the simulator client directly to this
          application and is not forwarded to an external map or simulator
          provider. Vercel and Neon process it as hosting and database providers
          under the safeguards described below.
        </p>
        <ul className="list-disc space-y-3 pl-6">
          <li>
            <strong>Clerk, Inc.</strong> — account authentication, organization
            membership, sessions, and abuse protection. See the{" "}
            <a
              href="https://clerk.com/legal/dpa"
              target="_blank"
              rel="noreferrer"
              className={externalLinkClass}
            >
              Clerk Data Processing Addendum
            </a>
            .
          </li>
          <li>
            <strong>Vercel Inc.</strong> — application hosting, delivery, server
            execution, infrastructure logs, privacy-preserving web analytics,
            performance measurement, and bot and abuse detection. See the{" "}
            <a
              href="https://vercel.com/legal/dpa"
              target="_blank"
              rel="noreferrer"
              className={externalLinkClass}
            >
              Vercel Data Processing Addendum
            </a>
            .
          </li>
          <li>
            <strong>Neon, LLC</strong> — managed application database and
            backups. See the{" "}
            <a
              href="https://neon.com/dpa"
              target="_blank"
              rel="noreferrer"
              className={externalLinkClass}
            >
              Neon Data Processing Agreement
            </a>
            .
          </li>
          <li>
            <strong>Hoppie&apos;s ACARS</strong> — only when a tenant configures
            its Hoppie ground station. Station identifiers and messages are
            relayed through a Netherlands-hosted hobby network. Hoppie warns
            that ACARS is not a private messaging system and messages may be
            visible to others. Never put personal, confidential, or
            special-category data in an ACARS message. See the{" "}
            <a
              href="https://www.hoppie.nl/acars/system/register.html"
              target="_blank"
              rel="noreferrer"
              className={externalLinkClass}
            >
              Hoppie privacy statement
            </a>
            .
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="5. International transfers">
        <p>
          Some providers are established in the United States or use
          subprocessors outside the European Economic Area. Where personal data
          is transferred to a country without an EU adequacy decision, the
          controller relies on an applicable transfer mechanism such as the EU
          Standard Contractual Clauses and supplementary safeguards. Where a
          provider is validly certified, the EU–US Data Privacy Framework may be
          used. Current subprocessor and transfer details are available from the
          provider documents linked above.
        </p>
      </LegalSection>

      <LegalSection
        id="cookies-and-local-storage"
        title="6. Cookies and local storage"
      >
        <p>
          The current application does not use advertising or marketing cookies.
          Optional Vercel Web Analytics stores anonymized aggregate data without
          analytics cookies, and Speed Insights reports browser performance
          metrics. Both remain off until you select “Allow anonymous analytics”.
          Vercel BotID is always active on protected mutations: it runs a
          browser challenge and sends proof and security signals with those
          requests.
        </p>
        <LegalTable
          caption="Browser storage used by the application"
          headings={["Storage", "Provider", "Purpose", "Lifetime / access"]}
          rows={[
            [
              <code key="clerk-cookies">
                __session, __client_uat (and equivalent Clerk session keys)
              </code>,
              "Clerk",
              "Authentication, session continuity, organization selection, and security",
              "Session or Clerk-configured lifetime; cookies are required for signed-in functionality",
            ],
            [
              <code key="cloudflare-cookie">_cfuvid (where set)</code>,
              "Cloudflare as part of Clerk delivery",
              "Rate limiting, fraud and abuse protection",
              "Provider-controlled security lifetime",
            ],
            [
              <code key="notice-storage">va-dispatch.privacy-preferences</code>,
              "vSAS Live Operations",
              "Remember the notice version, analytics choice, and decision time so your preference is applied",
              "Local storage until the notice version changes, you use ‘Show notice again’, or you clear browser data; never sent automatically with requests",
            ],
          ]}
        />
        <p>
          Authentication and security storage is strictly necessary to provide
          the signed-in service requested by the user (Section 25(2)(2) TDDDG).
          The privacy preference is stored only after you make a choice.
          Optional Analytics and Speed Insights rely on your consent under
          Section 25(1) TDDDG and Article 6(1)(a) GDPR. You can withdraw that
          consent at any time through “Cookie settings” in the footer; future
          optional telemetry then stops. You can also inspect or clear site data
          in your browser at any time.
        </p>
      </LegalSection>

      <LegalSection title="7. Your rights">
        <p>
          Subject to the applicable conditions, you have the right to access
          your data (Article 15 GDPR), rectify inaccurate data (Article 16),
          erase data (Article 17), restrict processing (Article 18), receive
          portable data (Article 20), and object to processing based on
          legitimate interests (Article 21). You may also withdraw consent at
          any time for future processing. This deployment relies on consent only
          for optional Vercel Analytics and Speed Insights.
        </p>
        <p>
          Send a request to{" "}
          <a
            href={`mailto:${config.privacyEmail}`}
            className={externalLinkClass}
          >
            {config.privacyEmail}
          </a>
          . We may need to verify your identity before disclosing or changing
          account data.
        </p>
        <p>
          An access, portability, correction, or erasure request also covers
          simulator devices, current telemetry, retained track points, and OOOI
          provenance where the applicable conditions permit. Revoking a device
          stops future samples but does not by itself erase operational history.
        </p>
      </LegalSection>

      <LegalSection title="8. Complaints">
        <p>
          You have the right to lodge a complaint with a data-protection
          supervisory authority, in particular in the EU Member State of your
          habitual residence, place of work, or the alleged infringement. The
          authority configured for the controller is{" "}
          <a
            href={config.supervisoryAuthorityUrl}
            target="_blank"
            rel="noreferrer"
            className={externalLinkClass}
          >
            {config.supervisoryAuthorityName}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="9. Security and automated decisions">
        <p>
          The service uses role-based access, tenant isolation, encrypted
          transport, encrypted storage for provider credentials, request-level
          audit identifiers, and security headers. Access is limited to people
          and providers who need it for the stated purposes. No solely automated
          decision with legal or similarly significant effects is made. BotID
          automatically classifies protected requests for abuse prevention as
          described above; it is not used for marketing or member evaluation.
          Simulator telemetry may be delayed, inaccurate, stale, or manually
          corrected and is provided only for simulated Virtual Airline
          awareness, never real-world aviation safety.
        </p>
      </LegalSection>

      <LegalSection title="10. Changes to this notice">
        <p>
          This notice is updated when processing purposes, providers, browser
          storage, or legal requirements change. A changed notice version causes
          the cookie notice to be shown again. Material changes that require
          consent will not take effect for optional processing until valid
          consent has been obtained.
        </p>
      </LegalSection>
    </LegalPageShell>
  );
}
