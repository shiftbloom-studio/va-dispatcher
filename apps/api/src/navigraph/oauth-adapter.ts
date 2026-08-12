const AUTHORIZATION_ENDPOINT =
  "https://identity.api.navigraph.com/connect/authorize";
const TOKEN_ENDPOINT = "https://identity.api.navigraph.com/connect/token";
const USERINFO_ENDPOINT = "https://identity.api.navigraph.com/connect/userinfo";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

/** Only identity is needed; tokens are neither retained nor refreshed. */
export const NAVIGRAPH_OAUTH_SCOPE = "openid userinfo";

export type NavigraphTokenResult = {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number | null;
  scope: string | null;
};

export type NavigraphUserInfo = {
  subject: string;
  username: string | null;
};

export type NavigraphOauthErrorReason =
  | "invalid_grant"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "invalid_response"
  | "response_too_large";

export class NavigraphOauthAdapterError extends Error {
  constructor(
    readonly reason: NavigraphOauthErrorReason,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "NavigraphOauthAdapterError";
  }
}

export function buildNavigraphAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  authorizationEndpoint?: string;
}): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.state)) {
    throw new Error("Navigraph OAuth state must be 43 base64url characters");
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.codeChallenge)) {
    throw new Error("Navigraph PKCE challenge must be 43 base64url characters");
  }

  const url = new URL(input.authorizationEndpoint ?? AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", NAVIGRAPH_OAUTH_SCOPE);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export class NavigraphOauthAdapter {
  constructor(
    private readonly options: {
      tokenEndpoint?: string;
      userInfoEndpoint?: string;
      timeoutMs?: number;
      fetchImpl?: typeof fetch;
    } = {},
  ) {}

  async exchangeAuthorizationCode(input: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    code: string;
    codeVerifier: string;
  }): Promise<NavigraphTokenResult> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code_verifier: input.codeVerifier,
    });
    const response = await this.request(
      this.options.tokenEndpoint ?? TOKEN_ENDPOINT,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );

    if (!response.ok) {
      if (response.status === 400 || response.status === 401) {
        throw new NavigraphOauthAdapterError(
          "invalid_grant",
          "The Navigraph authorization code is invalid or expired. Start the connection again.",
        );
      }
      throw responseError(response.status);
    }

    const parsed = await responseJson(response);
    const accessToken = stringClaim(parsed, "access_token", 16_384);
    const tokenType = stringClaim(parsed, "token_type", 32);
    if (!accessToken || tokenType?.toLowerCase() !== "bearer") {
      throw new NavigraphOauthAdapterError(
        "invalid_response",
        "Navigraph returned an invalid token response.",
      );
    }

    const expiresInValue = parsed.expires_in;
    const expiresIn =
      typeof expiresInValue === "number" &&
      Number.isFinite(expiresInValue) &&
      expiresInValue > 0
        ? expiresInValue
        : null;

    return {
      accessToken,
      tokenType: "Bearer",
      expiresIn,
      scope: stringClaim(parsed, "scope", 2_048),
    };
  }

  async fetchUserInfo(accessToken: string): Promise<NavigraphUserInfo> {
    const response = await this.request(
      this.options.userInfoEndpoint ?? USERINFO_ENDPOINT,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new NavigraphOauthAdapterError(
          "invalid_grant",
          "Navigraph could not verify the authorized account. Start the connection again.",
        );
      }
      throw responseError(response.status);
    }

    const parsed = await responseJson(response);
    const subject = stringClaim(parsed, "sub", 255)?.trim();
    const username = stringClaim(parsed, "preferred_username", 255)?.trim();
    if (!subject) {
      throw new NavigraphOauthAdapterError(
        "invalid_response",
        "Navigraph returned user information without an account identifier.",
      );
    }
    return { subject, username: username || null };
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await (this.options.fetchImpl ?? fetch)(url, {
        ...init,
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof NavigraphOauthAdapterError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new NavigraphOauthAdapterError(
          "timeout",
          `Navigraph did not respond within ${Math.ceil(timeoutMs / 1_000)} seconds.`,
          { cause: error },
        );
      }
      throw new NavigraphOauthAdapterError(
        "unavailable",
        "Navigraph could not be reached.",
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function responseError(status: number): NavigraphOauthAdapterError {
  if (status === 429) {
    return new NavigraphOauthAdapterError(
      "rate_limited",
      "Navigraph is rate-limiting authorization requests. Retry later.",
    );
  }
  return new NavigraphOauthAdapterError(
    "unavailable",
    "Navigraph is temporarily unavailable.",
  );
}

async function responseJson(
  response: Response,
): Promise<Record<string, unknown>> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new NavigraphOauthAdapterError(
      "response_too_large",
      "Navigraph returned a response larger than the supported limit.",
    );
  }

  const text = await boundedText(response, MAX_RESPONSE_BYTES);
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed)) return parsed;
  } catch (error) {
    throw new NavigraphOauthAdapterError(
      "invalid_response",
      "Navigraph returned an invalid response.",
      { cause: error },
    );
  }
  throw new NavigraphOauthAdapterError(
    "invalid_response",
    "Navigraph returned an invalid response.",
  );
}

async function boundedText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new NavigraphOauthAdapterError(
          "response_too_large",
          "Navigraph returned a response larger than the supported limit.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

function stringClaim(
  record: Record<string, unknown>,
  name: string,
  maxLength: number,
): string | null {
  const value = record[name];
  return typeof value === "string" && value.length <= maxLength ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
