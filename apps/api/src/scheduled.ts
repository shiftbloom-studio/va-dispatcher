import { isMockAcarsEnabled } from "./acars/factory.js";
import { pollAllTenants } from "./domain/acars/service.js";
import { runPrivacyLifecycleCron } from "./domain/privacy/service.js";

/** Cron expressions; keep in sync with `triggers.crons` in wrangler.jsonc. */
export const CRON_ACARS_POLL = "* * * * *";
export const CRON_PRIVACY_LIFECYCLE = "0 * * * *";

export async function runScheduledJob(cron: string): Promise<void> {
  if (cron === CRON_ACARS_POLL) {
    // Hoppie asks live stations to poll roughly once per minute. The mock
    // adapter never needs a background poll.
    if (isMockAcarsEnabled()) return;
    const result = await pollAllTenants();
    console.log("acars-poll", JSON.stringify(result));
    return;
  }
  if (cron === CRON_PRIVACY_LIFECYCLE) {
    const result = await runPrivacyLifecycleCron({ maxRuns: 10 });
    console.log("privacy-lifecycle", JSON.stringify(result));
    return;
  }
  console.warn(`No scheduled job is registered for "${cron}"`);
}
