import { LegalPageShell, LegalSection } from "@/components/legal-page-shell";
import {
  toTelephoneUri,
  type LegalConfig,
  type LegalLocale,
} from "@/lib/legal";

const linkClass = "font-semibold text-slate-950 underline underline-offset-4";

const copy = {
  en: {
    title: "Imprint",
    description:
      "Provider identification for this digital service under Section 5 DDG and, where applicable, Section 18 MStV.",
    provider: "Service provider",
    representedBy: "Represented by",
    contact: "Contact",
    email: "Email",
    phone: "Phone",
    register: "Register entry",
    registerName: "Register",
    registerNumber: "Registration number",
    vat: "VAT identification number",
    vatBody:
      "VAT identification number under Section 27a of the German VAT Act:",
    editorial: "Editorial responsibility",
    editorialBody:
      "Responsible for journalistic-editorial content under Section 18(2) MStV:",
    scope: "Service scope",
    scopeBody:
      "vSAS Live Operations is an open-source scheduling and dispatch service for virtual airlines. It exchanges virtual operational messages through Hoppie's ACARS. It is made for flight simulation only and provides no real-world aviation, airline, or air traffic control services.",
  },
  de: {
    title: "Impressum",
    description:
      "Anbieterkennzeichnung für diesen digitalen Dienst nach § 5 DDG und, soweit anwendbar, § 18 MStV.",
    provider: "Diensteanbieter",
    representedBy: "Vertreten durch",
    contact: "Kontakt",
    email: "E-Mail",
    phone: "Telefon",
    register: "Registereintrag",
    registerName: "Register",
    registerNumber: "Registernummer",
    vat: "Umsatzsteuer-Identifikationsnummer",
    vatBody: "Umsatzsteuer-Identifikationsnummer nach § 27a UStG:",
    editorial: "Redaktionell verantwortlich",
    editorialBody:
      "Verantwortlich für journalistisch-redaktionelle Inhalte nach § 18 Abs. 2 MStV:",
    scope: "Gegenstand des Dienstes",
    scopeBody:
      "vSAS Live Operations ist ein Open-Source-Dienst für Flugplanung und Dispatch virtueller Airlines. Er tauscht virtuelle Betriebsnachrichten über Hoppie's ACARS aus. Der Dienst ist ausschließlich für die Flugsimulation gedacht und erbringt keine Leistungen für die reale Luftfahrt, für Fluggesellschaften oder die Flugsicherung.",
  },
} as const;

export function ImprintNotice({
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
          ? { href: "/impressum", label: "Deutsch", lang: "de" }
          : { href: "/imprint", label: "English", lang: "en" }
      }
    >
      <LegalSection title={t.provider}>
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
        </address>
        {config.representative ? (
          <p>
            {t.representedBy}: <strong>{config.representative}</strong>
          </p>
        ) : null}
      </LegalSection>

      <LegalSection title={t.contact}>
        <p>
          {t.email}:{" "}
          <a href={`mailto:${config.email}`} className={linkClass}>
            {config.email}
          </a>
          {config.phone ? (
            <>
              <br />
              {t.phone}:{" "}
              <a href={toTelephoneUri(config.phone)} className={linkClass}>
                {config.phone}
              </a>
            </>
          ) : null}
        </p>
      </LegalSection>

      {config.registerName || config.registerNumber ? (
        <LegalSection title={t.register}>
          <p>
            {t.registerName}: {config.registerName ?? "—"}
            <br />
            {t.registerNumber}: {config.registerNumber ?? "—"}
          </p>
        </LegalSection>
      ) : null}

      {config.vatId ? (
        <LegalSection title={t.vat}>
          <p>
            {t.vatBody} {config.vatId}
          </p>
        </LegalSection>
      ) : null}

      {config.editoriallyResponsibleName ? (
        <LegalSection title={t.editorial}>
          <p>{t.editorialBody}</p>
          <address className="not-italic">
            <strong className="text-slate-950">
              {config.editoriallyResponsibleName}
            </strong>
            {config.editoriallyResponsibleAddressLines.map((line) => (
              <span key={line}>
                <br />
                {line}
              </span>
            ))}
          </address>
        </LegalSection>
      ) : null}

      <LegalSection title={t.scope}>
        <p>{t.scopeBody}</p>
      </LegalSection>
    </LegalPageShell>
  );
}
