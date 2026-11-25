import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pollAllTenants: vi.fn(),
  runPrivacyLifecycleCron: vi.fn(),
  isMockAcarsEnabled: vi.fn(),
}));

vi.mock("./domain/acars/service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./domain/acars/service.js")>()),
  pollAllTenants: mocks.pollAllTenants,
}));
vi.mock("./domain/privacy/service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./domain/privacy/service.js")>()),
  runPrivacyLifecycleCron: mocks.runPrivacyLifecycleCron,
}));
vi.mock("./acars/factory.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./acars/factory.js")>()),
  isMockAcarsEnabled: mocks.isMockAcarsEnabled,
}));

import {
  CRON_ACARS_POLL,
  CRON_PRIVACY_LIFECYCLE,
  runScheduledJob,
} from "./scheduled.js";

describe("Worker scheduled jobs", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.isMockAcarsEnabled.mockReturnValue(false);
    mocks.pollAllTenants.mockResolvedValue({ tenants: 1, messages: 0 });
    mocks.runPrivacyLifecycleCron.mockResolvedValue({ scheduled: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("polls Hoppie on the minute cron", async () => {
    await runScheduledJob(CRON_ACARS_POLL);
    expect(mocks.pollAllTenants).toHaveBeenCalledTimes(1);
    expect(mocks.runPrivacyLifecycleCron).not.toHaveBeenCalled();
  });

  it("skips polling for the mock ACARS adapter", async () => {
    mocks.isMockAcarsEnabled.mockReturnValue(true);
    await runScheduledJob(CRON_ACARS_POLL);
    expect(mocks.pollAllTenants).not.toHaveBeenCalled();
  });

  it("runs the privacy lifecycle on the hourly cron", async () => {
    await runScheduledJob(CRON_PRIVACY_LIFECYCLE);
    expect(mocks.runPrivacyLifecycleCron).toHaveBeenCalledWith({ maxRuns: 10 });
  });

  it("ignores unknown cron expressions", async () => {
    await runScheduledJob("5 4 * * *");
    expect(mocks.pollAllTenants).not.toHaveBeenCalled();
    expect(mocks.runPrivacyLifecycleCron).not.toHaveBeenCalled();
  });

  it("keeps the wrangler cron triggers in sync", async () => {
    const { readFileSync } = await import("node:fs");
    const config = readFileSync(
      new URL("../wrangler.jsonc", import.meta.url),
      "utf8",
    );
    expect(config).toContain(
      `"triggers": { "crons": ["${CRON_ACARS_POLL}", "${CRON_PRIVACY_LIFECYCLE}"] }`,
    );
  });
});
