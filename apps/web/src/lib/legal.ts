export const LEGAL_NOTICE_VERSION = "2026-08-12";
export const LEGAL_NOTICE_LAST_UPDATED = "12 August 2026";

type Environment = Record<string, string | undefined>;

export type LegalConfig = {
  configured: boolean;
  missingEnvironmentVariables: string[];
  operatorName: string;
  addressLines: string[];
  email: string;
  privacyEmail: string;
  phone: string | null;
  representative: string | null;
  registerName: string | null;
  registerNumber: string | null;
  vatId: string | null;
  editoriallyResponsibleName: string | null;
  editoriallyResponsibleAddressLines: string[];
  supervisoryAuthorityName: string;
  supervisoryAuthorityUrl: string;
};

const requiredVariables = [
  "LEGAL_OPERATOR_NAME",
  "LEGAL_OPERATOR_ADDRESS",
  "LEGAL_OPERATOR_EMAIL",
  "LEGAL_PRIVACY_EMAIL",
  "LEGAL_SUPERVISORY_AUTHORITY_NAME",
  "LEGAL_SUPERVISORY_AUTHORITY_URL",
] as const;

const developmentFallbacks = {
  LEGAL_OPERATOR_NAME: "Legal operator not configured",
  LEGAL_OPERATOR_ADDRESS:
    "Configure LEGAL_OPERATOR_ADDRESS|before a production deployment",
  LEGAL_OPERATOR_EMAIL: "legal@example.invalid",
  LEGAL_PRIVACY_EMAIL: "privacy@example.invalid",
  LEGAL_SUPERVISORY_AUTHORITY_NAME:
    "Competent supervisory authority not configured",
  LEGAL_SUPERVISORY_AUTHORITY_URL: "https://example.invalid",
};

function optionalValue(source: Environment, key: string): string | null {
  const value = source[key]?.trim();
  return value ? value : null;
}

function addressLines(value: string | null): string[] {
  return (value ?? "")
    .split("|")
    .map((line) => line.trim())
    .filter(Boolean);
}

function hasRequiredValue(
  source: Environment,
  key: (typeof requiredVariables)[number],
): boolean {
  const value = optionalValue(source, key);
  return key === "LEGAL_OPERATOR_ADDRESS"
    ? addressLines(value).length > 0
    : Boolean(value);
}

function requiredValue(
  source: Environment,
  key: (typeof requiredVariables)[number],
): string {
  return (
    optionalValue(source, key) ??
    developmentFallbacks[key as keyof typeof developmentFallbacks]
  );
}

function validatePublicUrl(value: string, key: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be an absolute HTTPS URL.`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${key} must be an absolute HTTPS URL.`);
  }
}

function validateEmail(value: string, key: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error(`${key} must be a valid email address.`);
  }
}

function validatePairedValues(
  first: string | null,
  firstKey: string,
  secondPresent: boolean,
  secondKey: string,
): void {
  if (Boolean(first) !== secondPresent) {
    throw new Error(
      `${firstKey} and ${secondKey} must be configured together.`,
    );
  }
}

export function loadLegalConfig(
  source: Environment = process.env,
  options: { strict?: boolean } = {},
): LegalConfig {
  const missingEnvironmentVariables = requiredVariables.filter(
    (key) => !hasRequiredValue(source, key),
  );
  const strict = options.strict ?? source.NODE_ENV === "production";

  if (strict && missingEnvironmentVariables.length > 0) {
    throw new Error(
      `Missing required legal configuration: ${missingEnvironmentVariables.join(", ")}`,
    );
  }

  const supervisoryAuthorityUrl = requiredValue(
    source,
    "LEGAL_SUPERVISORY_AUTHORITY_URL",
  );
  validatePublicUrl(supervisoryAuthorityUrl, "LEGAL_SUPERVISORY_AUTHORITY_URL");

  const email = requiredValue(source, "LEGAL_OPERATOR_EMAIL");
  const privacyEmail = requiredValue(source, "LEGAL_PRIVACY_EMAIL");
  validateEmail(email, "LEGAL_OPERATOR_EMAIL");
  validateEmail(privacyEmail, "LEGAL_PRIVACY_EMAIL");

  const registerName = optionalValue(source, "LEGAL_REGISTER_NAME");
  const registerNumber = optionalValue(source, "LEGAL_REGISTER_NUMBER");
  validatePairedValues(
    registerName,
    "LEGAL_REGISTER_NAME",
    Boolean(registerNumber),
    "LEGAL_REGISTER_NUMBER",
  );

  const editoriallyResponsibleName = optionalValue(
    source,
    "LEGAL_EDITORIALLY_RESPONSIBLE_NAME",
  );
  const editoriallyResponsibleAddressLines = addressLines(
    optionalValue(source, "LEGAL_EDITORIALLY_RESPONSIBLE_ADDRESS"),
  );
  validatePairedValues(
    editoriallyResponsibleName,
    "LEGAL_EDITORIALLY_RESPONSIBLE_NAME",
    editoriallyResponsibleAddressLines.length > 0,
    "LEGAL_EDITORIALLY_RESPONSIBLE_ADDRESS",
  );

  return {
    configured: missingEnvironmentVariables.length === 0,
    missingEnvironmentVariables,
    operatorName: requiredValue(source, "LEGAL_OPERATOR_NAME"),
    addressLines: addressLines(requiredValue(source, "LEGAL_OPERATOR_ADDRESS")),
    email,
    privacyEmail,
    phone: optionalValue(source, "LEGAL_OPERATOR_PHONE"),
    representative: optionalValue(source, "LEGAL_REPRESENTATIVE"),
    registerName,
    registerNumber,
    vatId: optionalValue(source, "LEGAL_VAT_ID"),
    editoriallyResponsibleName,
    editoriallyResponsibleAddressLines,
    supervisoryAuthorityName: requiredValue(
      source,
      "LEGAL_SUPERVISORY_AUTHORITY_NAME",
    ),
    supervisoryAuthorityUrl,
  };
}
