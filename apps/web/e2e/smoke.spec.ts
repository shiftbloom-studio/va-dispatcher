import { expect, test, type Page, type Route } from "@playwright/test";

const timestamp = "2026-09-01T08:00:00.000Z";

const brand = {
  seedColor: "#e64646",
  presence: "balanced",
  logoUrl: null,
};

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
    assignmentRevision: 1,
    assignmentConfirmedRevision: null,
    assignmentConfirmedAt: null,
    assignmentConfirmationRequired: false,
    outAt: null,
    offAt: null,
    onAt: null,
    inAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function dispatchRelease(overrides: Record<string, unknown> = {}) {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    flightId: "22222222-2222-4222-8222-222222222222",
    revision: 1,
    operationalRoute: "NEXEN Z711 MONAK",
    sid: "NEXEN2A",
    star: "MONAK3M",
    cruiseLevel: 350,
    alternateIcao: "ESSA",
    fuelUnit: "kg",
    payloadUnit: "kg",
    taxiFuel: 200,
    tripFuel: 4_000,
    contingencyFuel: 200,
    alternateFuel: 700,
    finalReserveFuel: 900,
    additionalFuel: 0,
    blockFuel: 6_000,
    plannedPayload: 14_000,
    weatherSnapshot: {
      source: "aviationweather.gov",
      fetchedAt: timestamp,
      stations: ["EKCH", "ENGM", "ESSA"],
      metar: [{ icaoId: "EKCH", rawOb: "EKCH 010750Z 24008KT CAVOK" }],
      taf: [],
      unavailable: [],
    },
    releaseNotes: "Review NOTAMs before departure.",
    dispatcherRemarks: "Gate allocation pending.",
    releasedByMembershipId: "dispatcher-membership",
    releasedAt: timestamp,
    ...overrides,
  };
}

function flightDetail(
  currentFlight: ReturnType<typeof flight>,
  release: ReturnType<typeof dispatchRelease> | null = null,
) {
  return {
    flight: currentFlight,
    release,
    releaseRevisions: release ? [release] : [],
    events: [],
  };
}

function emptyBoard() {
  return {
    flights: [],
    metrics: {
      window: {
        from: "2026-09-01T00:00:00.000Z",
        toExclusive: "2026-10-01T00:00:00.000Z",
        label: "Current UTC calendar month",
      },
      activeFlights: {
        value: 0,
        definition: "Flights currently in Active status.",
      },
      onTimePerformance: {
        value: null,
        onTime: 0,
        tracked: 0,
        eligible: 0,
        definition: "Actual OUT at or before ETD + 15 minutes.",
      },
      scheduledVsFinished: {
        scheduled: 0,
        finished: 0,
        value: null,
        definition: "Finished flights divided by scheduled flights.",
      },
    },
    scheduleRequestCounts: {},
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
      brand,
      settings: {},
    }),
  );
}

async function continueWithoutAnalytics(page: Page) {
  const notice = page.getByRole("complementary", { name: "Cookie notice" });
  await expect(notice).toBeVisible();
  await notice
    .getByRole("button", { name: "Continue without analytics" })
    .click();
  await expect(notice).toBeHidden();
}

test("public legal pages expose privacy and telemetry controls", async ({
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
  await page.getByRole("button", { name: "Use without analytics" }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
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
    currentFlight = flight({
      status: "accepted",
      assignmentConfirmedRevision: 1,
      assignmentConfirmedAt: timestamp,
    });
    return json(route, { flight: currentFlight });
  });
  await page.route("**/api/v1/flights/*", (route) =>
    json(route, flightDetail(currentFlight)),
  );

  await page.goto("/vsas/portal/schedule-requests/new");
  await continueWithoutAnalytics(page);
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
  let currentFlight = flight({
    status: "accepted",
    assignmentConfirmedRevision: 1,
    assignmentConfirmedAt: timestamp,
  });
  let currentRelease: ReturnType<typeof dispatchRelease> | null = null;
  let currentRequest = scheduleRequest({ status: "in_review" });
  await baseFixtures(page);
  await page.route("**/api/v1/schedule-requests/*", (route) =>
    json(route, { request: currentRequest, flights: [] }),
  );
  await page.route("**/api/v1/flights?*", (route) =>
    json(route, { items: [], nextCursor: null }),
  );
  await page.route("**/api/v1/flights/*", (route) =>
    json(route, flightDetail(currentFlight, currentRelease)),
  );
  await page.route("**/api/v1/flights/bulk", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.flights).toHaveLength(1);
    currentRequest = scheduleRequest({ status: "fulfilled" });
    return json(route, { flights: [flight()] }, 201);
  });
  await page.route("**/api/v1/flights/*/status", async (route) => {
    const body = route.request().postDataJSON();
    currentFlight = flight({ ...currentFlight, status: body.status });
    return json(route, { flight: currentFlight });
  });
  await page.route("**/api/v1/flights/*/release", async (route) => {
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({
      operationalRoute: "NEXEN Z711 MONAK",
      alternateIcao: "ESSA",
      cruiseLevel: 350,
      taxiFuel: 200,
      tripFuel: 4_000,
      contingencyFuel: 200,
      alternateFuel: 700,
      finalReserveFuel: 900,
      blockFuel: 6_000,
      plannedPayload: 14_000,
    });
    currentFlight = flight({ ...currentFlight, status: "briefed" });
    currentRelease = dispatchRelease(body);
    return json(route, { flight: currentFlight, release: currentRelease }, 201);
  });
  await page.route("**/api/v1/dispatch/board", (route) =>
    json(route, emptyBoard()),
  );

  await page.goto(`/vsas/dispatch/requests/${currentRequest.id}`);
  await continueWithoutAnalytics(page);
  await page.getByLabel("Flight number").fill("SK201");
  await page.getByLabel("Departure ICAO").fill("EKCH");
  await page.getByLabel("Arrival ICAO").fill("ESSA");
  await page.getByLabel("ETD (UTC)").fill("2026-09-10T10:00");
  await page.getByLabel("ETA (UTC)").fill("2026-09-10T11:10");
  await page.getByRole("button", { name: "Offer complete schedule" }).click();
  await expect(page.getByText("Fulfilled", { exact: true })).toBeVisible();

  await page.goto(`/vsas/dispatch/flights/${currentFlight.id}`);
  await page.getByRole("button", { name: "Prepare dispatch release" }).click();
  const planning = page.getByRole("dialog", {
    name: "Flight planning workspace",
  });
  await planning.getByLabel("Operational route").fill("NEXEN Z711 MONAK");
  await planning.getByLabel("Alternate ICAO").fill("ESSA");
  await planning.getByLabel("Taxi").fill("200");
  await planning.getByLabel("Trip").fill("4000");
  await planning.getByLabel("Contingency").fill("200");
  await planning.getByLabel("Alternate", { exact: true }).fill("700");
  await planning.getByLabel("Final reserve").fill("900");
  await planning.getByLabel("Planned payload").fill("14000");
  await planning
    .getByRole("button", { name: "Publish and schedule flight" })
    .click();
  await expect(planning.getByText("Scheduled", { exact: true })).toBeVisible();
  await planning
    .getByRole("button", { name: "Close planning workspace" })
    .click();
  await page.getByRole("button", { name: "Activate flight" }).click();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Complete flight" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Complete flight" })
    .click();
  await expect(page.getByText("Finished", { exact: true })).toBeVisible();
});

test("dispatcher scans the live board and opens flight planning", async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: "e2e-role", value: "dispatcher", domain: "127.0.0.1", path: "/" },
  ]);
  const accepted = flight({
    status: "accepted",
    assignmentRevision: 2,
    assignmentConfirmedRevision: 1,
    assignmentConfirmedAt: timestamp,
    assignmentConfirmationRequired: true,
  });
  const active = flight({
    id: "55555555-5555-4555-8555-555555555555",
    status: "active",
    flightNumber: "SK480",
    assignmentConfirmedRevision: 1,
    assignmentConfirmedAt: timestamp,
  });
  await baseFixtures(page);
  await page.route("**/api/v1/dispatch/board", (route) => {
    const fixture = emptyBoard();
    return json(route, {
      ...fixture,
      flights: [
        { ...accepted, latestReleaseRevision: null },
        { ...active, latestReleaseRevision: 1 },
      ],
      metrics: {
        ...fixture.metrics,
        activeFlights: {
          ...fixture.metrics.activeFlights,
          value: 1,
        },
        onTimePerformance: {
          ...fixture.metrics.onTimePerformance,
          value: 1,
          onTime: 1,
          tracked: 1,
          eligible: 2,
        },
        scheduledVsFinished: {
          ...fixture.metrics.scheduledVsFinished,
          scheduled: 2,
          finished: 0,
          value: 0,
        },
      },
    });
  });
  await page.route(`**/api/v1/flights/${accepted.id}`, (route) =>
    json(route, flightDetail(accepted)),
  );

  await page.goto("/vsas/dispatch");
  await expect(page.getByText("1/2 departures tracked")).toBeVisible();
  const toSchedule = page.getByRole("region", { name: "To schedule" });
  await expect(
    toSchedule.getByText(/Pilot confirmation pending/),
  ).toBeVisible();
  const activeLane = page.getByRole("region", { name: "Active" });
  await expect(
    activeLane.getByRole("link", { name: "Open ACARS" }),
  ).toHaveAttribute(
    "href",
    new RegExp(`station=SAS101.*flightId=${active.id}`),
  );

  await toSchedule.getByRole("button", { name: "Modify" }).click();
  const planning = page.getByRole("dialog", {
    name: "Flight planning workspace",
  });
  await expect(planning.getByLabel("Aircraft type")).toHaveAttribute(
    "readonly",
    "",
  );
  await expect(planning.getByText("Pilot confirmation required")).toBeVisible();
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
      brand,
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
  await continueWithoutAnalytics(page);
  await page.getByLabel("Recipient station").fill("SAS101");
  await page.getByLabel("Message", { exact: true }).fill("CONTACT DISPATCH");
  await page.getByRole("button", { name: "Send telex" }).click();
  await expect(
    page.getByText(/Hoppie accepted the telex to SAS101/),
  ).toBeVisible();
});

test("dispatcher simulates inbound ACARS with the development adapter", async ({
  page,
  context,
}) => {
  await context.addCookies([
    { name: "e2e-role", value: "dispatcher", domain: "127.0.0.1", path: "/" },
  ]);
  await baseFixtures(page);
  await page.route("**/api/v1/flights?*", (route) =>
    json(route, { items: [], nextCursor: null }),
  );
  await page.route("**/api/v1/dispatch/inbox", (route) =>
    json(route, { items: [], nextCursor: null }),
  );
  await page.route("**/api/v1/acars/simulate", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      from: "SAS404",
      body: "REQUESTING GATE",
      msgType: "telex",
    });
    return json(route, { queued: true, to: "VSAS" }, 201);
  });

  await page.goto("/vsas/dispatch/acars");
  await continueWithoutAnalytics(page);
  await page.getByLabel("Simulated sender").fill("sas404");
  await page.getByLabel("Simulated message").fill("REQUESTING GATE");
  await page.getByRole("button", { name: "Simulate inbound" }).click();

  await expect(
    page.getByText(/simulated inbound message to VSAS is stored/i),
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

  await page.goto("/vsas/settings/organization");
  await continueWithoutAnalytics(page);
  await page.getByLabel("Ground-station callsign").fill("sas");
  await page.getByLabel("Ground-station Hoppie logon").fill("private-logon");
  await page.getByRole("button", { name: "Test and save" }).click();

  await expect(
    page.getByText(/Hoppie accepted the credential test/),
  ).toBeVisible();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
});
