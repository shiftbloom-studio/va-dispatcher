import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const apiOrigin = `http://127.0.0.1:${Number(
  process.env.E2E_INTEGRATED_API_PORT ?? 3201,
)}`;
const fixtureSecret =
  process.env.E2E_FIXTURE_SECRET ??
  "local-integrated-e2e-authority-not-for-production";

let pilotMembershipId: string;

test.beforeEach(async () => {
  const ids = object(await fixtureControl("reset"));
  pilotMembershipId = stringField(ids, "pilot");
});

test("pilot signs in, requests a schedule, and completes a dispatched flight", async ({
  page,
  context,
}) => {
  const failedAssets: string[] = [];
  const externalRequests: string[] = [];
  observePageNetwork(page, failedAssets, externalRequests);

  await page.goto("/vsas");
  await expect(page).toHaveURL(/\/vsas\/sign-in$/);
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  const logo = page.getByRole("img", { name: "Virtual SAS logo" }).first();
  await expect(logo).toBeVisible();
  await expect
    .poll(() => logo.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await expect
    .poll(() => page.locator("link[rel='stylesheet']").count())
    .toBeGreaterThan(0);
  expect(
    await page
      .locator("main")
      .evaluate((element) => getComputedStyle(element).backgroundColor),
  ).not.toBe("rgba(0, 0, 0, 0)");

  await completeFixtureSignIn(page, "pilot");
  await page.goto("/vsas/dispatch");
  await expect(
    page.getByRole("heading", {
      name: "This workspace is not available for your role",
    }),
  ).toBeVisible();

  await page.goto("/vsas/portal");
  await page.getByRole("link", { name: /Request schedule/ }).click();
  await page.getByLabel("Number of flights").fill("1");
  await page.getByLabel("Title (optional)").fill("Integrated pilot duty");
  await page
    .getByLabel("Notes (optional)")
    .fill("Synthetic A320 sector for persistence coverage");
  await page.getByLabel("Start (UTC)").fill("2099-09-10T08:00");
  await page.getByLabel("End (UTC)").fill("2099-09-10T14:00");
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page).toHaveURL(/\/schedule-requests\/[0-9a-f-]+$/);
  await expect(page.getByText("Integrated pilot duty")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Integrated pilot duty")).toBeVisible();

  await page.getByRole("button", { name: "Cancel request" }).click();
  await page
    .getByRole("dialog", { name: "Cancel this schedule request?" })
    .getByRole("button", { name: "Cancel request" })
    .click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();

  await setIdentity(context, "dispatcher");
  const created = object(
    await apiJson(page, "POST", "/flights", {
      pilotMembershipId,
      flightNumber: "SK201",
      depIcao: "EKCH",
      arrIcao: "ENGM",
      etd: "2099-09-10T09:00:00.000Z",
      eta: "2099-09-10T10:20:00.000Z",
      aircraftType: "A320",
      status: "offered",
    }),
  );
  const flightId = stringField(object(created.flight), "id");

  await setIdentity(context, "pilot");
  await page.goto(`/vsas/portal/flights/${flightId}`);
  await page.getByRole("button", { name: "Accept flight" }).click();
  await expect(page.getByText("Accepted", { exact: true })).toBeVisible();

  await setIdentity(context, "dispatcher");
  const acceptedDetail = object(
    await apiJson(page, "GET", `/flights/${flightId}`),
  );
  await apiJson(page, "POST", `/flights/${flightId}/release`, {
    ...releaseBody,
    expectedVersion: numberField(object(acceptedDetail.flight), "version"),
  });

  await setIdentity(context, "pilot");
  await page.goto(`/vsas/portal/flights/${flightId}`);
  await expect(page.getByText("Integrated dispatcher release")).toBeVisible();
  await page.getByRole("button", { name: "Start flight" }).click();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Finish flight" }).click();
  await expect(page.getByText("Finished", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Finished", { exact: true })).toBeVisible();

  const stored = object(await apiJson(page, "GET", `/flights/${flightId}`));
  expect(stringField(object(stored.flight), "status")).toBe("completed");
  expect(stringField(object(stored.release), "dispatcherRemarks")).toBe(
    "Integrated dispatcher release",
  );

  await page.getByRole("button", { name: "Switch test identity" }).click();
  await expect(page).toHaveURL(/\/vsas\/sign-in$/);
  expect(failedAssets).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test("dispatcher fulfills a request, publishes a release, plans, and exchanges ACARS", async ({
  page,
  context,
}) => {
  await setIdentity(context, "pilot");
  const createdRequest = object(
    await apiJson(page, "POST", "/schedule-requests", {
      title: "Integrated dispatcher duty",
      notes: "Synthetic request for dispatcher persistence coverage",
      windowStart: "2099-09-11T08:00:00.000Z",
      windowEnd: "2099-09-11T14:00:00.000Z",
      desiredFlightCount: 1,
      preferences: {
        availability: [
          {
            startAt: "2099-09-11T08:00:00.000Z",
            endAt: "2099-09-11T14:00:00.000Z",
          },
        ],
      },
    }),
  );
  const requestId = stringField(object(createdRequest.request), "id");

  await page.goto("/vsas/sign-in");
  await completeFixtureSignIn(page, "dispatcher");
  await page.goto(`/vsas/dispatch/requests/${requestId}`);
  await expect(
    page.getByRole("heading", { name: "Integrated dispatcher duty" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start review" }).click();
  await expect(page.getByText("In Review", { exact: true })).toBeVisible();
  await page.getByLabel("Flight number").fill("SK701");
  await page.getByLabel("Departure ICAO").fill("EKCH");
  await page.getByLabel("Arrival ICAO").fill("ENGM");
  await page.getByLabel("ETD (UTC)").fill("2099-09-11T09:00");
  await page.getByLabel("ETA (UTC)").fill("2099-09-11T10:20");
  await page.getByLabel("Aircraft (optional)").fill("A320");
  await page.getByRole("button", { name: "Offer flight batch" }).click();
  await expect(page.getByText("Fulfilled", { exact: true })).toBeVisible();

  const requestDetail = object(
    await apiJson(page, "GET", `/schedule-requests/${requestId}`),
  );
  expect(object(requestDetail.fulfillment)).toMatchObject({
    linkedFlightCount: 1,
    remainingFlightCount: 0,
  });
  const flightPage = object(
    await apiJson(
      page,
      "GET",
      `/flights?scheduleRequestId=${encodeURIComponent(requestId)}&limit=50`,
    ),
  );
  const [flight] = objectArray(flightPage.items);
  if (!flight) throw new Error("Dispatcher fulfillment created no flight");
  const flightId = stringField(flight, "id");

  await setIdentity(context, "pilot");
  await apiJson(page, "POST", `/flights/${flightId}/accept`, {
    expectedVersion: numberField(flight, "version"),
  });
  await setIdentity(context, "dispatcher");
  await page.goto(`/vsas/dispatch/flights/${flightId}`);
  await page.getByRole("button", { name: "Prepare dispatch release" }).click();
  const planning = page.getByRole("dialog", {
    name: "Flight planning workspace",
  });
  await planning.getByLabel("Operational route").fill("NEXEN Z711 MONAK");
  await planning.getByLabel("Cruise level").fill("350");
  await planning.getByLabel("Alternate ICAO").fill("ESSA");
  await planning.getByLabel("Taxi").fill("200");
  await planning.getByLabel("Trip").fill("4000");
  await planning.getByLabel("Contingency").fill("200");
  await planning.getByLabel("Alternate", { exact: true }).fill("700");
  await planning.getByLabel("Final reserve").fill("900");
  await planning.getByLabel("Additional").fill("0");
  await planning.getByLabel("Planned payload").fill("14000");
  await planning
    .getByLabel("Dispatcher remarks")
    .fill("Integrated dispatcher release");
  await planning
    .getByRole("button", { name: "Publish and schedule flight" })
    .click();
  await expect(planning.getByText("Scheduled", { exact: true })).toBeVisible();
  await planning
    .getByRole("button", { name: "Close planning workspace" })
    .click();

  const scheduledDetail = object(
    await apiJson(page, "GET", `/flights/${flightId}`),
  );
  const scheduledFlight = object(scheduledDetail.flight);
  const release = object(scheduledDetail.release);
  const preparedResponse = object(
    await apiJson(page, "POST", `/flights/${flightId}/simbrief/dispatches`, {
      expectedFlightVersion: numberField(scheduledFlight, "version"),
      expectedAssignmentRevision: numberField(
        scheduledFlight,
        "assignmentRevision",
      ),
      releaseId: stringField(release, "id"),
      releaseRevision: numberField(release, "revision"),
    }),
  );
  const preparedDispatch = object(preparedResponse.dispatch);
  expect(preparedDispatch).toMatchObject({
    status: "prepared",
    dispatcherName: "Integrated Test Dispatcher",
    dispatcherRemarks: "Integrated dispatcher release",
  });

  await setIdentity(context, "pilot");
  await apiJson(page, "PUT", "/simbrief/connection", { userId: "987654" });
  const generatedResponse = object(
    await apiJson(
      page,
      "POST",
      `/flights/${flightId}/simbrief/dispatches/${stringField(preparedDispatch, "id")}/generate`,
    ),
  );
  expect(stringField(generatedResponse, "dispatchUrl")).toMatch(
    /^https:\/\/www\.simbrief\.com\//,
  );
  expect(object(generatedResponse.dispatch)).toMatchObject({
    status: "pending",
    generatedByMembershipId: pilotMembershipId,
  });
  const synced = object(
    await apiJson(
      page,
      "POST",
      `/flights/${flightId}/simbrief/dispatches/${stringField(preparedDispatch, "id")}/sync`,
    ),
  );
  expect(object(synced.dispatch)).toMatchObject({
    status: "ready",
    generatedByMembershipId: pilotMembershipId,
    dispatcherName: "Integrated Test Dispatcher",
    dispatcherRemarks: "Integrated dispatcher release",
  });

  const oauth = object(await apiJson(page, "POST", "/simbrief/oauth/start"));
  const state = new URL(
    stringField(oauth, "authorizationUrl"),
  ).searchParams.get("state");
  if (!state) throw new Error("Navigraph fixture returned no OAuth state");
  const callback = await fetch(
    `${apiOrigin}/api/v1/simbrief/oauth/callback?state=${encodeURIComponent(state)}&code=synthetic-code`,
  );
  expect(callback.status).toBe(200);
  const connection = object(object(await callback.json()).connection);
  expect(object(connection.oauth)).toMatchObject({
    connected: true,
    username: "synthetic-pilot",
  });

  await setIdentity(context, "dispatcher");
  await page.goto("/vsas/dispatch/acars");
  await expect(
    page.getByRole("heading", { name: "ACARS workspace" }),
  ).toBeVisible();
  await page.getByLabel("Recipient station").fill("SAS101");
  await page.getByLabel("Message", { exact: true }).fill("CONTACT DISPATCH");
  await page.getByRole("button", { name: "Send telex" }).click();
  await page.getByLabel("Simulated sender").fill("SAS101");
  await page.getByLabel("Simulated message").fill("REQUESTING GATE");
  await page.getByRole("button", { name: "Simulate inbound" }).click();
  await expect(
    page.getByText("REQUESTING GATE", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("CONTACT DISPATCH", { exact: true }),
  ).toBeVisible();

  await expect
    .poll(async () => {
      const inbox = object(
        await apiJson(page, "GET", "/acars/messages?limit=50"),
      );
      return objectArray(inbox.items).map((message) => ({
        direction: message.direction,
        fromStation: message.fromStation,
        toStation: message.toStation,
        body: message.body,
      }));
    })
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: "outbound",
          toStation: "SAS101",
          body: "CONTACT DISPATCH",
        }),
        expect.objectContaining({
          direction: "inbound",
          fromStation: "SAS101",
          body: "REQUESTING GATE",
        }),
        expect.objectContaining({
          direction: "inbound",
          fromStation: "SAS101",
          body: "ACK: CONTACT DISPATCH",
        }),
      ]),
    );

  await setIdentity(context, "outsider");
  const crossTenant = await page.request.get(`/api/v1/flights/${flightId}`);
  expect(crossTenant.status()).toBe(404);
  await page.goto("/vsas");
  await expect(
    page.getByRole("heading", { name: "Select the correct organization" }),
  ).toBeVisible();
});

const releaseBody = {
  operationalRoute: "NEXEN Z711 MONAK",
  cruiseLevel: 350,
  alternateIcao: "ESSA",
  fuelUnit: "kg",
  payloadUnit: "kg",
  taxiFuel: 200,
  tripFuel: 4000,
  contingencyFuel: 200,
  alternateFuel: 700,
  finalReserveFuel: 900,
  additionalFuel: 0,
  blockFuel: 6000,
  plannedPayload: 14000,
  dispatcherRemarks: "Integrated dispatcher release",
};

async function completeFixtureSignIn(
  page: Page,
  identity: "pilot" | "dispatcher",
) {
  await dismissAnalytics(page);
  await page.getByRole("radio", { name: identity }).check();
  await dismissAnalytics(page);
  await page
    .getByRole("button", { name: `Continue to ${identity} workspace` })
    .click();
  await expect(page).toHaveURL(
    identity === "pilot" ? /\/vsas\/portal$/ : /\/vsas\/dispatch$/,
  );
}

async function setIdentity(
  context: BrowserContext,
  identity: "pilot" | "dispatcher" | "outsider",
) {
  await context.addCookies([
    {
      name: "va-e2e-identity",
      value: identity,
      domain: "127.0.0.1",
      path: "/",
      sameSite: "Lax",
    },
  ]);
}

async function dismissAnalytics(page: Page) {
  await page
    .getByRole("complementary", { name: "Cookie notice" })
    .getByRole("button", { name: "Continue without analytics" })
    .click({ timeout: 2_000 })
    .catch(() => undefined);
}

async function fixtureControl(action: "reset"): Promise<unknown> {
  const response = await fetch(`${apiOrigin}/api/v1/internal/e2e/${action}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${fixtureSecret}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`E2E control ${action} failed with ${response.status}`);
  }
  return object(await response.json()).ids;
}

async function apiJson(
  page: Page,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const response = await page.request.fetch(`/api/v1${path}`, {
    method,
    data: body,
  });
  const payload: unknown = await response.json();
  if (!response.ok()) {
    throw new Error(
      `${method} ${path} returned ${response.status()}: ${JSON.stringify(payload)}`,
    );
  }
  return payload;
}

function observePageNetwork(
  page: Page,
  failedAssets: string[],
  externalRequests: string[],
) {
  page.on("response", (response) => {
    if (
      ["document", "stylesheet", "script", "image", "font"].includes(
        response.request().resourceType(),
      ) &&
      response.status() >= 400
    ) {
      failedAssets.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname) &&
      !["data:", "blob:"].includes(url.protocol)
    ) {
      externalRequests.push(request.url());
    }
  });
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an object response");
  }
  return value as Record<string, unknown>;
}

function objectArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error("Expected an array response");
  return value.map(object);
}

function stringField(value: Record<string, unknown>, field: string): string {
  const candidate = value[field];
  if (typeof candidate !== "string") {
    throw new Error(`Expected ${field} to be a string`);
  }
  return candidate;
}

function numberField(value: Record<string, unknown>, field: string): number {
  const candidate = value[field];
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    throw new Error(`Expected ${field} to be a number`);
  }
  return candidate;
}
