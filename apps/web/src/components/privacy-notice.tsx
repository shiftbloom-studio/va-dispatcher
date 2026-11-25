import type { ReactNode } from "react";

import {
  LegalPageShell,
  LegalSection,
  LegalTable,
} from "@/components/legal-page-shell";
import {
  LEGAL_NOTICE_LAST_UPDATED,
  type LegalConfig,
  type LegalLocale,
} from "@/lib/legal";

const linkClass = "font-semibold text-slate-950 underline underline-offset-4";

function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={linkClass}>
      {children}
    </a>
  );
}

function Mail({ address }: { address: string }) {
  return (
    <a href={`mailto:${address}`} className={linkClass}>
      {address}
    </a>
  );
}

type Copy = {
  title: string;
  description: string;
  controllerTitle: string;
  controllerIntro: string;
  privacyEmail: string;
  scopeTitle: string;
  scope: string[];
  processingTitle: string;
  processingCaption: string;
  processingHeadings: string[];
  processingRows: string[][];
  voluntary: string;
  recipientsTitle: string;
  recipientsIntro: string;
  telemetryRecipients: string;
  providers: {
    accounts: ReactNode;
    cloudflare: ReactNode;
    hoppie: ReactNode;
    navigraph: ReactNode;
  };
  transfersTitle: string;
  transfers: string;
  storageTitle: string;
  storageIntro: string;
  storageCaption: string;
  storageHeadings: string[];
  storageRows: ReactNode[][];
  storageBasis: string;
  rightsTitle: string;
  rights: string;
  rightsRequest: (email: ReactNode) => ReactNode;
  rightsTelemetry: string;
  complaintsTitle: string;
  complaints: (authority: ReactNode) => ReactNode;
  securityTitle: string;
  security: string;
  changesTitle: string;
  changes: string;
};

const sessionCookies = (
  <code key="session">__Host-va-session, __Host-va-auth</code>
);
const accountCookie = (
  <code key="stem">stem session cookie (on stem.shiftbloom.studio)</code>
);
const botCookie = <code key="cf-bm">__cf_bm</code>;
const rateCookie = <code key="cfuvid">_cfuvid</code>;

const copy: Record<LegalLocale, Copy> = {
  en: {
    title: "Privacy Notice",
    description: `How personal data is processed when you use vSAS Live Operations. Last updated: ${LEGAL_NOTICE_LAST_UPDATED.en}.`,
    controllerTitle: "1. Controller and privacy contact",
    controllerIntro:
      "The controller responsible for the processing described in this notice is:",
    privacyEmail: "Privacy email",
    scopeTitle: "2. Scope and data sources",
    scope: [
      "This notice covers the web application, its same-origin API, and the operational data handled through them. Data comes from you, Virtual Airline administrators and dispatchers, the authentication provider, and, when live ACARS is enabled, participating Hoppie's ACARS stations. When you connect a simulator, data also comes from the MSFS 2024 client you set up with its one-time device token.",
      "The service is multi-tenant. Membership and operational records are visible only within the Virtual Airline organization linked to your signed-in account.",
    ],
    processingTitle: "3. Processing activities and legal bases",
    processingCaption: "Personal-data processing activities",
    processingHeadings: ["Data", "Purpose", "Legal basis", "Retention"],
    processingRows: [
      [
        "Account identifier, name, email address, organization, requested and assigned role, application, invitation, and membership status, display name, and pilot callsign",
        "Sign you in, review a tenant membership application, send invitations, maintain membership, authorize tenant and role access, and administer the service",
        "Art. 6(1)(b) GDPR where needed to provide the requested member service; otherwise Art. 6(1)(f) GDPR (operating and securing a voluntary service)",
        "While an account or membership request is pending or active; afterwards only under the approved retention rules for unsuccessful applications, account closure, legal obligations, or legal claims",
      ],
      [
        "Availability windows, schedule requests, preferences, notes, assigned flights, timestamps, and operational status",
        "Build and coordinate requested virtual flight schedules and keep an operational history",
        "Art. 6(1)(b) GDPR where needed for the member service; otherwise Art. 6(1)(f) GDPR (coordinating Virtual Airline operations)",
        "While required for the member service and operational history; then deleted or anonymized unless obligations or claims require longer retention",
      ],
      [
        "Simulator device name and revocation state; assigned flight and device links; latitude/longitude, altitude, speed, heading, simulator time, phase and heartbeat; automatic or corrected OOOI provenance",
        "Show the assigned pilot's simulator connection, give dispatch awareness of the simulated flight, keep a short track, and derive auditable Out/Off/On/In events",
        "Art. 6(1)(b) GDPR where needed for the requested member service; otherwise Art. 6(1)(f) GDPR (coordinating voluntary simulator operations). Connecting a device is voluntary",
        "The current position is replaced by each sample. Track history keeps at most the newest 5,000 points and removes points older than 24 hours. Device and OOOI records follow the recurring deletion process or a valid rights request",
      ],
      [
        "Hoppie's ACARS station identifiers, virtual message text, direction, provider metadata, and timestamps",
        "Exchange and display virtual operational messages through Hoppie's ACARS",
        "Art. 6(1)(b) GDPR where needed for the member service; otherwise Art. 6(1)(f) GDPR (Virtual Airline communications)",
        "While needed for current operations, support, abuse handling, and legal claims. Hoppie states a 24-hour message lifetime for its own queue",
      ],
      [
        "SimBrief pilot identifier and dispatch data, and Navigraph authorization tokens, when you link these accounts",
        "Create SimBrief flight plans for your assigned flights",
        "Art. 6(1)(b) GDPR (the linked feature you requested)",
        "Until you unlink the account or your membership ends; tokens are stored encrypted",
      ],
      [
        "Audit events, request IDs, authentication events, IP address, device and browser data, server logs, and Cloudflare bot scores of incoming requests",
        "Protect accounts and infrastructure, diagnose faults, prevent automated abuse, and establish or defend legal claims",
        "Art. 6(1)(f) GDPR (secure and reliable operation)",
        "Only as long as needed for security review, incident response, troubleshooting, and applicable claims; Cloudflare Workers logs are kept for a short provider-defined period",
      ],
    ],
    voluntary:
      "You are not legally required to provide this information. Account and core operational data are, however, necessary for the signed-in service. Without them, an account or dispatch function may not be available.",
    recipientsTitle: "4. Recipients and service providers",
    recipientsIntro:
      "Members of your Virtual Airline see only what their operational role permits. The following providers process data to run the service:",
    telemetryRecipients:
      "Simulator telemetry goes from the simulator client directly to this application. It is not passed to any map or simulator provider; Cloudflare processes it only as the hosting and database provider.",
    providers: {
      accounts: (
        <>
          <strong>stem</strong>: the shiftbloom account service, run by the same
          controller on Cloudflare. It handles sign-in with one-time email
          codes, your account, organization memberships and roles, and
          invitation emails. No other company receives your account data.
        </>
      ),
      cloudflare: (
        <>
          <strong>Cloudflare, Inc.</strong>: hosting on Cloudflare Workers,
          content delivery, the application database (D1), organization logo
          storage (R2), infrastructure logs, and bot and abuse detection. See
          the{" "}
          <External href="https://www.cloudflare.com/cloudflare-customer-dpa/">
            Cloudflare Data Processing Addendum
          </External>
          .
        </>
      ),
      hoppie: (
        <>
          <strong>Hoppie&apos;s ACARS</strong>: only when a Virtual Airline
          configures its Hoppie ground station. Station identifiers and messages
          are relayed through a hobby network hosted in the Netherlands. Hoppie
          points out that ACARS is not a private messaging system and that
          others may see messages. Never put personal, confidential, or
          special-category data in an ACARS message. See the{" "}
          <External href="https://www.hoppie.nl/acars/system/register.html">
            Hoppie privacy statement
          </External>
          .
        </>
      ),
      navigraph: (
        <>
          <strong>Navigraph (Navigraph AB) and SimBrief</strong>: only when you
          link your account to plan flights. See the{" "}
          <External href="https://navigraph.com/legal/privacy-policy">
            Navigraph privacy policy
          </External>
          .
        </>
      ),
    },
    transfersTitle: "5. International transfers",
    transfers:
      "Cloudflare is based in the United States and uses subprocessors outside the European Economic Area. Where personal data goes to a country without an EU adequacy decision, the controller relies on the EU–US Data Privacy Framework where the provider is certified, or on the EU Standard Contractual Clauses with supplementary safeguards. The provider documents linked above list current subprocessors and transfer details.",
    storageTitle: "6. Cookies and local storage",
    storageIntro:
      "The application uses no analytics, advertising, or marketing cookies and no tracking tools. It stores only what is needed to sign you in and to protect the service:",
    storageCaption: "Browser storage used by the application",
    storageHeadings: ["Storage", "Provider", "Purpose", "Lifetime"],
    storageRows: [
      [
        sessionCookies,
        "VA Dispatch",
        "Keep you signed in (encrypted session) and protect the sign-in step",
        "30 days for the session; 10 minutes for the sign-in step",
      ],
      [
        accountCookie,
        "stem (shiftbloom)",
        "Remember your shiftbloom sign-in across shiftbloom apps",
        "Until you sign out or the session expires",
      ],
      [
        botCookie,
        "Cloudflare",
        "Tell people from automated traffic and block abuse",
        "30 minutes",
      ],
      [
        rateCookie,
        "Cloudflare",
        "Rate limiting and abuse protection",
        "End of the browser session",
      ],
    ],
    storageBasis:
      "This storage is strictly necessary to provide the signed-in service you request (Section 25(2) no. 2 TDDDG), so no consent banner is shown. You can inspect or clear site data in your browser at any time; you will then need to sign in again.",
    rightsTitle: "7. Your rights",
    rights:
      "Subject to the legal conditions, you have the right of access (Art. 15 GDPR), rectification (Art. 16), erasure (Art. 17), restriction of processing (Art. 18), data portability (Art. 20), and to object to processing based on legitimate interests (Art. 21).",
    rightsRequest: (email) => (
      <>
        Send your request to {email}. We may need to verify your identity before
        we disclose or change account data.
      </>
    ),
    rightsTelemetry:
      "Access, portability, rectification, and erasure requests also cover simulator devices, current telemetry, stored track points, and OOOI provenance where the conditions apply. Revoking a device stops future samples but does not by itself erase operational history.",
    complaintsTitle: "8. Complaints",
    complaints: (authority) => (
      <>
        You have the right to lodge a complaint with a data protection
        supervisory authority, in particular in the EU Member State of your
        habitual residence, your place of work, or the place of the alleged
        infringement. The authority responsible for the controller is{" "}
        {authority}.
      </>
    ),
    securityTitle: "9. Security and automated decisions",
    security:
      "The service uses role-based access, tenant isolation, encrypted transport, encrypted storage for provider credentials, audit identifiers per request, and security headers. Access is limited to people and providers who need it for the purposes stated here. No solely automated decision with legal or similarly significant effect is made. Cloudflare's bot score automatically blocks requests that look automated; it is not used for marketing or to evaluate members. Simulator telemetry may be delayed, inaccurate, or manually corrected and is meant only for simulated Virtual Airline operations, never for real-world aviation.",
    changesTitle: "10. Changes to this notice",
    changes:
      "We update this notice when purposes, providers, browser storage, or legal requirements change. The date at the top shows the current version.",
  },
  de: {
    title: "Datenschutzerklärung",
    description: `Wie personenbezogene Daten bei der Nutzung von vSAS Live Operations verarbeitet werden. Stand: ${LEGAL_NOTICE_LAST_UPDATED.de}.`,
    controllerTitle: "1. Verantwortlicher und Datenschutzkontakt",
    controllerIntro:
      "Verantwortlich für die in dieser Erklärung beschriebene Verarbeitung ist:",
    privacyEmail: "E-Mail für Datenschutzanfragen",
    scopeTitle: "2. Geltungsbereich und Datenquellen",
    scope: [
      "Diese Erklärung gilt für die Webanwendung, ihre API unter derselben Domain und die darüber verarbeiteten Betriebsdaten. Die Daten stammen von dir, von Administratoren und Dispatchern deiner virtuellen Airline, vom Anmeldedienst und, wenn Live-ACARS aktiviert ist, von teilnehmenden Hoppie's-ACARS-Stationen. Wenn du einen Simulator verbindest, stammen Daten außerdem aus dem MSFS-2024-Client, den du mit seinem einmaligen Geräte-Token einrichtest.",
      "Der Dienst ist mandantenfähig. Mitgliedschafts- und Betriebsdaten sind nur innerhalb der virtuellen Airline sichtbar, die mit deinem angemeldeten Konto verknüpft ist.",
    ],
    processingTitle: "3. Verarbeitungen und Rechtsgrundlagen",
    processingCaption: "Verarbeitung personenbezogener Daten",
    processingHeadings: ["Daten", "Zweck", "Rechtsgrundlage", "Speicherdauer"],
    processingRows: [
      [
        "Kontokennung, Name, E-Mail-Adresse, Organisation, beantragte und zugewiesene Rolle, Status von Bewerbung, Einladung und Mitgliedschaft, Anzeigename und Pilot-Callsign",
        "Anmeldung, Mitgliedsanträge prüfen, Einladungen versenden, Mitgliedschaften verwalten, Zugriff nach Mandant und Rolle steuern und den Dienst administrieren",
        "Art. 6 Abs. 1 lit. b DSGVO, soweit für den angefragten Mitgliederdienst erforderlich; im Übrigen Art. 6 Abs. 1 lit. f DSGVO (Betrieb und Absicherung eines freiwilligen Dienstes)",
        "Solange ein Konto oder Mitgliedsantrag offen oder aktiv ist; danach nur nach den festgelegten Löschregeln für abgelehnte Anträge, Kontoschließung, gesetzliche Pflichten oder Rechtsansprüche",
      ],
      [
        "Verfügbarkeitsfenster, Flugplananfragen, Präferenzen, Notizen, zugewiesene Flüge, Zeitstempel und Betriebsstatus",
        "Angefragte virtuelle Flugpläne erstellen und koordinieren und eine Betriebshistorie führen",
        "Art. 6 Abs. 1 lit. b DSGVO, soweit für den Mitgliederdienst erforderlich; im Übrigen Art. 6 Abs. 1 lit. f DSGVO (Koordination des Airline-Betriebs)",
        "Solange für den Mitgliederdienst und die Betriebshistorie erforderlich; danach gelöscht oder anonymisiert, sofern keine Pflichten oder Ansprüche eine längere Speicherung erfordern",
      ],
      [
        "Gerätename und Widerrufsstatus des Simulators; Verknüpfung von Flug und Gerät; Breiten-/Längengrad, Höhe, Geschwindigkeit, Kurs, Simulatorzeit, Flugphase und Heartbeat; automatische oder korrigierte OOOI-Herkunft",
        "Die Simulatorverbindung des zugewiesenen Piloten anzeigen, dem Dispatch einen Überblick über den simulierten Flug geben, einen kurzen Track speichern und nachvollziehbare Out/Off/On/In-Ereignisse ableiten",
        "Art. 6 Abs. 1 lit. b DSGVO, soweit für den angefragten Mitgliederdienst erforderlich; im Übrigen Art. 6 Abs. 1 lit. f DSGVO (Koordination des freiwilligen Simulatorbetriebs). Das Verbinden eines Geräts ist freiwillig",
        "Die aktuelle Position wird mit jeder Meldung ersetzt. Der Track umfasst höchstens die neuesten 5.000 Punkte und entfernt Punkte, die älter als 24 Stunden sind. Geräte- und OOOI-Daten folgen dem regelmäßigen Löschprozess oder einem berechtigten Betroffenenantrag",
      ],
      [
        "Stationskennungen bei Hoppie's ACARS, virtueller Nachrichtentext, Richtung, Anbieter-Metadaten und Zeitstempel",
        "Virtuelle Betriebsnachrichten über Hoppie's ACARS austauschen und anzeigen",
        "Art. 6 Abs. 1 lit. b DSGVO, soweit für den Mitgliederdienst erforderlich; im Übrigen Art. 6 Abs. 1 lit. f DSGVO (Kommunikation der virtuellen Airline)",
        "Solange für den laufenden Betrieb, Support, Missbrauchsabwehr und Rechtsansprüche erforderlich. Hoppie gibt für die eigene Warteschlange eine Lebensdauer von 24 Stunden an",
      ],
      [
        "SimBrief-Pilotkennung und Dispatch-Daten sowie Navigraph-Autorisierungstoken, wenn du diese Konten verknüpfst",
        "SimBrief-Flugpläne für deine zugewiesenen Flüge erstellen",
        "Art. 6 Abs. 1 lit. b DSGVO (die von dir angefragte verknüpfte Funktion)",
        "Bis du die Verknüpfung aufhebst oder deine Mitgliedschaft endet; Token werden verschlüsselt gespeichert",
      ],
      [
        "Audit-Ereignisse, Request-IDs, Anmeldeereignisse, IP-Adresse, Geräte- und Browserdaten, Serverprotokolle und Cloudflare-Bot-Scores eingehender Anfragen",
        "Konten und Infrastruktur schützen, Fehler analysieren, automatisierten Missbrauch verhindern und Rechtsansprüche geltend machen oder abwehren",
        "Art. 6 Abs. 1 lit. f DSGVO (sicherer und zuverlässiger Betrieb)",
        "Nur so lange, wie es für Sicherheitsprüfung, Vorfallsbearbeitung, Fehleranalyse und mögliche Ansprüche nötig ist; Protokolle von Cloudflare Workers werden nur für einen kurzen, vom Anbieter festgelegten Zeitraum gespeichert",
      ],
    ],
    voluntary:
      "Du bist gesetzlich nicht verpflichtet, diese Daten bereitzustellen. Konto- und zentrale Betriebsdaten sind jedoch für den angemeldeten Dienst erforderlich. Ohne sie stehen ein Konto oder einzelne Dispatch-Funktionen möglicherweise nicht zur Verfügung.",
    recipientsTitle: "4. Empfänger und Dienstleister",
    recipientsIntro:
      "Mitglieder deiner virtuellen Airline sehen nur, was ihre Rolle im Betrieb erlaubt. Folgende Dienstleister verarbeiten Daten, um den Dienst zu betreiben:",
    telemetryRecipients:
      "Simulator-Telemetrie geht direkt vom Simulator-Client an diese Anwendung. Sie wird an keinen Karten- oder Simulatoranbieter weitergegeben; Cloudflare verarbeitet sie nur als Hosting- und Datenbankanbieter.",
    providers: {
      accounts: (
        <>
          <strong>stem</strong>: der Kontodienst von shiftbloom, betrieben vom
          selben Verantwortlichen auf Cloudflare. Er übernimmt die Anmeldung mit
          Einmalcodes per E-Mail, dein Konto, Organisationsmitgliedschaften und
          Rollen sowie Einladungs-E-Mails. Kein anderes Unternehmen erhält deine
          Kontodaten.
        </>
      ),
      cloudflare: (
        <>
          <strong>Cloudflare, Inc.</strong>: Hosting auf Cloudflare Workers,
          Auslieferung, Anwendungsdatenbank (D1), Speicher für
          Organisationslogos (R2), Infrastrukturprotokolle sowie Bot- und
          Missbrauchserkennung. Siehe{" "}
          <External href="https://www.cloudflare.com/cloudflare-customer-dpa/">
            Auftragsverarbeitungsvertrag von Cloudflare
          </External>
          .
        </>
      ),
      hoppie: (
        <>
          <strong>Hoppie&apos;s ACARS</strong>: nur, wenn eine virtuelle Airline
          ihre Hoppie-Bodenstation einrichtet. Stationskennungen und Nachrichten
          laufen über ein in den Niederlanden betriebenes Hobby-Netzwerk. Hoppie
          weist darauf hin, dass ACARS kein privates Nachrichtensystem ist und
          Nachrichten für andere sichtbar sein können. Schreibe deshalb nie
          personenbezogene, vertrauliche oder besonders schützenswerte Daten in
          eine ACARS-Nachricht. Siehe{" "}
          <External href="https://www.hoppie.nl/acars/system/register.html">
            Datenschutzhinweise von Hoppie
          </External>
          .
        </>
      ),
      navigraph: (
        <>
          <strong>Navigraph (Navigraph AB) und SimBrief</strong>: nur, wenn du
          dein Konto zur Flugplanung verknüpfst. Siehe{" "}
          <External href="https://navigraph.com/legal/privacy-policy">
            Datenschutzerklärung von Navigraph
          </External>
          .
        </>
      ),
    },
    transfersTitle: "5. Übermittlung in Drittländer",
    transfers:
      "Cloudflare hat seinen Sitz in den USA und setzt Unterauftragsverarbeiter außerhalb des Europäischen Wirtschaftsraums ein. Werden personenbezogene Daten in ein Land ohne Angemessenheitsbeschluss der EU übermittelt, stützt sich der Verantwortliche auf das EU-US Data Privacy Framework, sofern der Anbieter zertifiziert ist, oder auf die EU-Standardvertragsklauseln mit ergänzenden Schutzmaßnahmen. Aktuelle Unterauftragsverarbeiter und Details zur Übermittlung findest du in den oben verlinkten Dokumenten der Anbieter.",
    storageTitle: "6. Cookies und lokaler Speicher",
    storageIntro:
      "Die Anwendung verwendet keine Analyse-, Werbe- oder Marketing-Cookies und keine Tracking-Tools. Gespeichert wird nur, was für die Anmeldung und den Schutz des Dienstes nötig ist:",
    storageCaption: "Im Browser gespeicherte Daten",
    storageHeadings: ["Speicher", "Anbieter", "Zweck", "Dauer"],
    storageRows: [
      [
        sessionCookies,
        "VA Dispatch",
        "Angemeldet bleiben (verschlüsselte Sitzung) und den Anmeldeschritt absichern",
        "30 Tage für die Sitzung; 10 Minuten für den Anmeldeschritt",
      ],
      [
        accountCookie,
        "stem (shiftbloom)",
        "Deine shiftbloom-Anmeldung für alle shiftbloom-Apps merken",
        "Bis zur Abmeldung oder zum Ablauf der Sitzung",
      ],
      [
        botCookie,
        "Cloudflare",
        "Menschen von automatisiertem Verkehr unterscheiden und Missbrauch blockieren",
        "30 Minuten",
      ],
      [
        rateCookie,
        "Cloudflare",
        "Begrenzung von Anfragen und Missbrauchsschutz",
        "Ende der Browsersitzung",
      ],
    ],
    storageBasis:
      "Diese Speicherung ist unbedingt erforderlich, um den von dir angefragten angemeldeten Dienst bereitzustellen (§ 25 Abs. 2 Nr. 2 TDDDG). Deshalb gibt es kein Cookie-Banner. Du kannst gespeicherte Website-Daten jederzeit in deinem Browser einsehen oder löschen; danach musst du dich neu anmelden.",
    rightsTitle: "7. Deine Rechte",
    rights:
      "Unter den gesetzlichen Voraussetzungen hast du das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit (Art. 20) und auf Widerspruch gegen Verarbeitungen, die auf berechtigten Interessen beruhen (Art. 21).",
    rightsRequest: (email) => (
      <>
        Schicke deine Anfrage an {email}. Bevor wir Kontodaten herausgeben oder
        ändern, müssen wir eventuell deine Identität prüfen.
      </>
    ),
    rightsTelemetry:
      "Anträge auf Auskunft, Übertragbarkeit, Berichtigung und Löschung umfassen, soweit die Voraussetzungen vorliegen, auch Simulatorgeräte, aktuelle Telemetrie, gespeicherte Trackpunkte und die OOOI-Herkunft. Wird ein Gerät widerrufen, endet die Übermittlung neuer Daten; die Betriebshistorie wird dadurch allein nicht gelöscht.",
    complaintsTitle: "8. Beschwerderecht",
    complaints: (authority) => (
      <>
        Du hast das Recht, dich bei einer Datenschutz-Aufsichtsbehörde zu
        beschweren, insbesondere in dem EU-Mitgliedstaat deines gewöhnlichen
        Aufenthalts, deines Arbeitsplatzes oder des Orts des mutmaßlichen
        Verstoßes. Zuständig für den Verantwortlichen ist {authority}.
      </>
    ),
    securityTitle: "9. Sicherheit und automatisierte Entscheidungen",
    security:
      "Der Dienst nutzt rollenbasierte Zugriffe, Trennung der Mandanten, verschlüsselte Übertragung, verschlüsselte Speicherung von Zugangsdaten zu Drittanbietern, Audit-Kennungen pro Anfrage und Sicherheits-Header. Zugriff haben nur Personen und Dienstleister, die ihn für die hier genannten Zwecke brauchen. Es gibt keine ausschließlich automatisierte Entscheidung mit rechtlicher oder ähnlich erheblicher Wirkung. Der Bot-Score von Cloudflare blockiert automatisch Anfragen, die automatisiert wirken; er dient weder Werbung noch der Bewertung von Mitgliedern. Simulator-Telemetrie kann verzögert, ungenau oder manuell korrigiert sein und ist nur für den simulierten Betrieb gedacht, nie für die reale Luftfahrt.",
    changesTitle: "10. Änderungen",
    changes:
      "Wir passen diese Erklärung an, wenn sich Zwecke, Dienstleister, Browserspeicher oder rechtliche Anforderungen ändern. Das Datum oben zeigt den aktuellen Stand.",
  },
};

export function PrivacyNotice({
  locale,
  config,
}: {
  locale: LegalLocale;
  config: LegalConfig;
}) {
  const t = copy[locale];

  return (
    <LegalPageShell
      locale={locale}
      title={t.title}
      description={t.description}
      config={config}
      alternate={
        locale === "en"
          ? { href: "/datenschutz", label: "Deutsch", lang: "de" }
          : { href: "/privacy", label: "English", lang: "en" }
      }
    >
      <LegalSection title={t.controllerTitle}>
        <p>{t.controllerIntro}</p>
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
          {t.privacyEmail}: <Mail address={config.privacyEmail} />
        </address>
      </LegalSection>

      <LegalSection title={t.scopeTitle}>
        {t.scope.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </LegalSection>

      <LegalSection title={t.processingTitle}>
        <LegalTable
          caption={t.processingCaption}
          headings={t.processingHeadings}
          rows={t.processingRows}
        />
        <p>{t.voluntary}</p>
      </LegalSection>

      <LegalSection title={t.recipientsTitle}>
        <p>{t.recipientsIntro}</p>
        <ul className="list-disc space-y-3 pl-6">
          <li>{t.providers.accounts}</li>
          <li>{t.providers.cloudflare}</li>
          <li>{t.providers.hoppie}</li>
          <li>{t.providers.navigraph}</li>
        </ul>
        <p>{t.telemetryRecipients}</p>
      </LegalSection>

      <LegalSection title={t.transfersTitle}>
        <p>{t.transfers}</p>
      </LegalSection>

      <LegalSection id="cookies-and-local-storage" title={t.storageTitle}>
        <p>{t.storageIntro}</p>
        <LegalTable
          caption={t.storageCaption}
          headings={t.storageHeadings}
          rows={t.storageRows}
        />
        <p>{t.storageBasis}</p>
      </LegalSection>

      <LegalSection title={t.rightsTitle}>
        <p>{t.rights}</p>
        <p>{t.rightsRequest(<Mail address={config.privacyEmail} />)}</p>
        <p>{t.rightsTelemetry}</p>
      </LegalSection>

      <LegalSection title={t.complaintsTitle}>
        <p>
          {t.complaints(
            <External href={config.supervisoryAuthorityUrl}>
              {config.supervisoryAuthorityName}
            </External>,
          )}
        </p>
      </LegalSection>

      <LegalSection title={t.securityTitle}>
        <p>{t.security}</p>
      </LegalSection>

      <LegalSection title={t.changesTitle}>
        <p>{t.changes}</p>
      </LegalSection>
    </LegalPageShell>
  );
}
