import type { Metadata } from "next";
import { connection } from "next/server";

import { LegalPageShell, LegalSection } from "@/components/legal-page-shell";
import { loadLegalConfig, toTelephoneUri } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Impressum",
  description: "Legal provider information for vSAS Live Operations.",
};

export default async function ImpressumPage() {
  await connection();
  const config = loadLegalConfig();

  return (
    <LegalPageShell
      title="Impressum"
      description="Provider identification for this digital service under Section 5 DDG and, where applicable, Section 18 MStV."
      config={config}
    >
      <LegalSection title="Service provider">
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
            Represented by: <strong>{config.representative}</strong>
          </p>
        ) : null}
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Email:{" "}
          <a
            href={`mailto:${config.email}`}
            className="font-semibold text-slate-950 underline underline-offset-4"
          >
            {config.email}
          </a>
          {config.phone ? (
            <>
              <br />
              Phone:{" "}
              <a
                href={toTelephoneUri(config.phone)}
                className="font-semibold text-slate-950 underline underline-offset-4"
              >
                {config.phone}
              </a>
            </>
          ) : null}
        </p>
      </LegalSection>

      {config.registerName || config.registerNumber ? (
        <LegalSection title="Register entry">
          <p>
            Register: {config.registerName ?? "—"}
            <br />
            Registration number: {config.registerNumber ?? "—"}
          </p>
        </LegalSection>
      ) : null}

      {config.vatId ? (
        <LegalSection title="VAT identification number">
          <p>
            VAT identification number pursuant to Section 27a of the German VAT
            Act: {config.vatId}
          </p>
        </LegalSection>
      ) : null}

      {config.editoriallyResponsibleName ? (
        <LegalSection title="Editorial responsibility">
          <p>
            Responsible for journalistic-editorial content pursuant to Section
            18(2) MStV:
          </p>
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

      <LegalSection title="Service scope">
        <p>
          vSAS Live Operations is an open-source virtual-airline scheduling and
          dispatch service that exchanges virtual operational messages through
          Hoppie&apos;s ACARS. It is solely for flight simulation and does not
          provide real-world aviation, airline, or air-traffic-control services.
        </p>
      </LegalSection>
    </LegalPageShell>
  );
}
