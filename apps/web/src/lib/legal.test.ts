import { describe, expect, it } from "vitest";

import { loadLegalConfig } from "@/lib/legal";

const completeEnvironment = {
  NODE_ENV: "production",
  LEGAL_OPERATOR_NAME: "Example Aviation e.V.",
  LEGAL_OPERATOR_ADDRESS: "Example Street 1|10115 Berlin|Germany",
  LEGAL_OPERATOR_EMAIL: "legal@example.test",
  LEGAL_PRIVACY_EMAIL: "privacy@example.test",
  LEGAL_SUPERVISORY_AUTHORITY_NAME: "Example authority",
  LEGAL_SUPERVISORY_AUTHORITY_URL: "https://authority.example.test",
};

describe("legal configuration", () => {
  it("rejects incomplete production configuration", () => {
    expect(() => loadLegalConfig({ NODE_ENV: "production" })).toThrowError(
      /LEGAL_OPERATOR_NAME/,
    );
  });

  it("loads public legal details and splits postal-address lines", () => {
    const config = loadLegalConfig(completeEnvironment);

    expect(config.configured).toBe(true);
    expect(config.addressLines).toEqual([
      "Example Street 1",
      "10115 Berlin",
      "Germany",
    ]);
    expect(config.privacyEmail).toBe("privacy@example.test");
  });

  it("allows explicit development placeholders without hiding missing keys", () => {
    const config = loadLegalConfig(
      { NODE_ENV: "development" },
      { strict: false },
    );

    expect(config.configured).toBe(false);
    expect(config.missingEnvironmentVariables).toContain(
      "LEGAL_OPERATOR_ADDRESS",
    );
    expect(config.email).toBe("legal@example.invalid");
  });

  it("requires an HTTPS supervisory-authority URL", () => {
    expect(() =>
      loadLegalConfig({
        ...completeEnvironment,
        LEGAL_SUPERVISORY_AUTHORITY_URL: "http://authority.example.test",
      }),
    ).toThrowError(/absolute HTTPS URL/);
  });

  it("treats a separator-only address as missing", () => {
    expect(() =>
      loadLegalConfig({
        ...completeEnvironment,
        LEGAL_OPERATOR_ADDRESS: " | | ",
      }),
    ).toThrowError(/LEGAL_OPERATOR_ADDRESS/);
  });

  it("rejects malformed public email addresses", () => {
    expect(() =>
      loadLegalConfig({
        ...completeEnvironment,
        LEGAL_PRIVACY_EMAIL: "privacy-at-example.test",
      }),
    ).toThrowError(/LEGAL_PRIVACY_EMAIL must be a valid email address/);
  });

  it("requires register details to be configured as a pair", () => {
    expect(() =>
      loadLegalConfig({
        ...completeEnvironment,
        LEGAL_REGISTER_NAME: "Register court Berlin",
      }),
    ).toThrowError(/LEGAL_REGISTER_NAME and LEGAL_REGISTER_NUMBER/);
  });

  it("requires an address for editorial responsibility", () => {
    expect(() =>
      loadLegalConfig({
        ...completeEnvironment,
        LEGAL_EDITORIALLY_RESPONSIBLE_NAME: "Example Person",
      }),
    ).toThrowError(
      /LEGAL_EDITORIALLY_RESPONSIBLE_NAME and LEGAL_EDITORIALLY_RESPONSIBLE_ADDRESS/,
    );
  });
});
