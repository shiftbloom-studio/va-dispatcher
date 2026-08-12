import { expect, test, type Page, type Route } from "@playwright/test";

const timestamp = "2026-09-01T08:00:00.000Z";

const pilot = {
  id: "11111111-1111-4111-8111-111111111111",
  role: "pilot",
  pilotCallsign: "SAS101",
  displayName: "Test Pilot",
  status: "active",
  createdAt: timestamp,
};

function flight(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    scheduleRequestId: "33333333-3333-4333-8333-333333333333",
    pilotMembershipId: pilot.id,
    flightNumber: "SK101",
    depIcao: "EKCH",
    arrIcao: "ENGM",
    etd: "2026-09-10T08:00:00.000Z",
    eta: "2026-09-10T09:20:00.000Z",
    aircraftType: "A320",
    status: "offered",
    cancelReason: null,
    declinedReason: null,
    dispatcherNotes: "Report ready for briefing.",
    outAt: null,
    offAt: null,
    onAt: null,
    inAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function scheduleRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    pilotMembershipId: pilot.id,
    title: "September schedule",
    notes: "Scandinavian regional flights",
    windowStart: "2026-09-10T08:00:00.000Z",
    windowEnd: "2026-09-12T18:00:00.000Z",
    desiredFlightCount: 1,
    preferences: {
      availability: [
        {
          startAt: "2026-09-10T08:00:00.000Z",
          endAt: "2026-09-10T14:00:00.000Z",
        },
      ],
    },
    status: "pending",
    rejectReason: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: { "X-Request-Id": "fixture-request" },
    body: JSON.stringify(body),
  });
}

async function baseFixtures(page: Page) {
  await page.route("**/api/health", (route) =>
    json(route, {
      ok: true,
      service: "va-dispatch-api",
      env: "test",
      database: true,
      acarsProvider: "mock",
    }),
  );
  await page.route("**/api/v1/members", (route) =>
    json(route, { items: [pilot] }),
  );
  await page.route("**/api/v1/tenant", (route) =>
    json(route, {
      id: "tenant-vsas",
      slug: "vsas",
      name: "Virtual SAS",
      hoppieStation: "VSAS",
      hasHoppieLogon: false,
      acarsProvider: "mock",
      hoppiePollingEnabled: false,
      hoppieLastTestedAt: null,
      settings: {},
    }),
  );
}

test("public legal pages expose necessary-storage controls", async ({
  page,
}) => {
  await page.goto("/privacy");
  await expect(
    page.getByRole("heading", { name: "Privacy Notice", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Example Aviation e.V.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator('script[src*="clerk"]')).toHaveCount(0);

  const notice = page.getByRole("complementary", { name: "Cookie notice" });
  await expect(notice).toBeVisible();
  await page.getByRole("button", { name: "Details" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Always active", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Acknowledge notice" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(notice).toBeHidden();

  await page.reload();
  await expect(notice).toBeHidden();
  await page.getByRole("button", { name: "Cookie settings" }).click();
  await page.getByRole("button", { name: "Show notice again" }).click();
  await expect(notice).toBeVisible();

  await page.goto("/imprint");
  await expect(page).toHaveURL(/\/impressum$/);
  await expect(
    page.getByRole("heading", { name: "Impressum", exact: true }),
  ).toBeVisible();
});

test("pilot requests a UTC schedule and accepts an offer", async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: "e2e-role", value: "pilot", domain: "127.0.0.1", path: "/" },
  ]);
  let currentFlight = flight();
  let requestCreated = false;
  await baseFixtures(page);
  await page.route("**/api/v1/schedule-requests?*", (route) =>
    json(route, {
      items: requestCreated ? [scheduleRequest()] : [],
      nextCursor: null,
    }),
  );
  await page.route("**/api/v1/schedule-requests", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON();
    expect(body.preferences.availability).toEqual([
      {
        startAt: "2026-09-10T08:00:00.000Z",
        endAt: "2026-09-10T12:00:00.000Z",
      },
    ]);
    requestCreated = true;
    return json(
      route,
      {
        request: scheduleRequest({
          desiredFlightCount: body.desiredFlightCount,
          windowStart: body.windowStart,
          windowEnd: body.windowEnd,
        }),
      },
      201,
    );
  });
  await page.route("**/api/v1/schedule-requests/*", (route) =>
    json(route, { request: scheduleRequest(), flights: [] }),
  );
  await page.route("**/api/v1/flights?*", (route) =>
    json(route, { items: [currentFlight], nextCursor: null }),
  );
  await page.route("**/api/v1/flights/*/accept", (route) => {
    currentFlight = flight({ status: "accepted" });
    return json(route, { flight: currentFlight });
  });
  await page.route("**/api/v1/flights/*", (route) =>
    json(route, { flight: currentFlight }),
  );

  await page.goto("/vsas/portal/schedule-requests/new");
  await page.getByLabel("Number of flights").fill("1");
  await page.getByLabel("Start (UTC)").fill("2026-09-10T08:00");
  await page.getByLabel("End (UTC)").fill("2026-09-10T12:00");
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page).toHaveURL(/schedule-requests\/33333333/);

  await page.goto(`/vsas/portal/flights/${currentFlight.id}`);
  await page.getByRole("button", { name: "Accept flight" }).click();
  await expect(page.getByText("Accepted", { exact: true })).toBeVisible();
});

test("dispatcher builds the exact offer and advances a flight", async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: "e2e-role", value: "dispatcher", domain: "127.0.0.1", path: "/" },
  ]);
  let currentFlight = flight({ status: "accepted" });
  let currentRequest = scheduleRequest({ status: "in_review" });
  await baseFixtures(page);
  await page.route("**/api/v1/schedule-requests/*", (route) =>
    json(route, { request: currentRequest, flights: [] }),
  );
  await page.route("**/api/v1/flights?*", (route) =>
    json(route, { items: [], nextCursor: null }),
  );
  await page.route("**/api/v1/flights/*", (route) =>
    json(route, { flight: currentFlight }),
  );
  await page.route("**/api/v1/flights/bulk", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.flights).toHaveLength(1);
    currentRequest = scheduleRequest({ status: "fulfilled" });
    return json(route, { flights: [flight()] }, 201);
  });
  await page.route("**/api/v1/flights/*/status", async (route) => {
    const body = route.request().postDataJSON();
    currentFlight = flight({ status: body.status });
    return json(route, { flight: currentFlight });
  });
  await page.route("**/api/v1/dispatch/board", (route) =>
    json(route, { flights: [], scheduleRequestCounts: {} }),
  );

  await page.goto(`/vsas/dispatch/requests/${currentRequest.id}`);
  await page.getByLabel("Flight number").fill("SK201");
  await page.getByLabel("Departure ICAO").fill("EKCH");
  await page.getByLabel("Arrival ICAO").fill("ESSA");
  await page.getByLabel("ETD (UTC)").fill("2026-09-10T10:00");
  await page.getByLabel("ETA (UTC)").fill("2026-09-10T11:10");
  await page.getByRole("button", { name: "Offer complete schedule" }).click();
  await expect(page.getByText("Fulfilled", { exact: true })).toBeVisible();

  await page.goto(`/vsas/dispatch/flights/${currentFlight.id}`);
  await page.getByRole("button", { name: "Mark briefed" }).click();
  await expect(page.getByText("Briefed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Activate flight" }).click();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Complete flight" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Complete flight" })
    .click();
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
});

test("dispatcher sends Hoppie ACARS", async ({ page, context }) => {
  await context.addCookies([
    { name: "e2e-role", value: "dispatcher", domain: "127.0.0.1", path: "/" },
  ]);
  const messages: Array<Record<string, unknown>> = [];
  await baseFixtures(page);
  await page.route("**/api/v1/flights?*", (route) =>
    json(route, { items: [], nextCursor: null }),
  );
  await page.route("**/api/v1/dispatch/inbox", (route) =>
    json(route, { items: messages, nextCursor: null }),
  );
  await page.route("**/api/v1/tenant", (route) =>
    json(route, {
      id: "tenant-vsas",
      slug: "vsas",
      name: "Virtual SAS",
      hoppieStation: "VSAS",
      hasHoppieLogon: true,
      acarsProvider: "hoppie",
      hoppiePollingEnabled: true,
      hoppieLastTestedAt: timestamp,
      settings: {},
    }),
  );
  await page.route("**/api/v1/acars/messages", async (route) => {
    const body = route.request().postDataJSON();
    const message = {
      id: `message-${messages.length + 1}`,
      direction: "outbound",
      msgType: "telex",
      fromStation: "VSAS",
      toStation: body.to,
      body: body.body,
      provider: "hoppie",
      flightId: null,
      createdAt: timestamp,
      sentAt: timestamp,
      receivedAt: null,
    };
    messages.unshift(message);
    return json(route, { message }, 201);
  });
  await page.goto("/vsas/dispatch/acars");
  await page.getByLabel("Recipient station").fill("SAS101");
  await page.getByLabel("Message", { exact: true }).fill("CONTACT DISPATCH");
  await page.getByRole("button", { name: "Send telex" }).click();
  await expect(
    page.getByText(/Hoppie accepted the telex to SAS101/),
  ).toBeVisible();
});

test("admin configures the tenant Hoppie ground station", async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: "e2e-role", value: "admin", domain: "127.0.0.1", path: "/" },
  ]);
  await baseFixtures(page);
  await page.route("**/api/v1/me", (route) =>
    json(route, {
      user: { clerkUserId: "admin-test" },
      membership: {
        ...pilot,
        id: "admin-membership",
        role: "admin",
        displayName: "Test Admin",
      },
      tenant: {
        id: "tenant-vsas",
        slug: "vsas",
        name: "Virtual SAS",
        hoppieStation: "VSAS",
      },
    }),
  );
  await page.route("**/api/v1/tenant/acars-config", async (route) => {
    expect(route.request().method()).toBe("PUT");
    const body = route.request().postDataJSON();
    expect(body).toEqual({
      hoppieStation: "SAS",
      hoppieLogon: "private-logon",
    });
    return json(route, {
      hoppieStation: "SAS",
      hasHoppieLogon: true,
      acarsProvider: "hoppie",
      hoppiePollingEnabled: true,
      hoppieLastTestedAt: "2026-09-01T08:05:00.000Z",
    });
  });

  await page.goto("/vsas/settings");
  await page.getByLabel("Ground-station callsign").fill("sas");
  await page.getByLabel("Ground-station Hoppie logon").fill("private-logon");
  await page.getByRole("button", { name: "Test and save" }).click();

  await expect(
    page.getByText(/Hoppie accepted the connection test/),
  ).toBeVisible();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
});
