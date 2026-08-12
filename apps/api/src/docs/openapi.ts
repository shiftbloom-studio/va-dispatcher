type OpenApiObject = Record<string, unknown>;

const schemaRef = (name: string): OpenApiObject => ({
  $ref: `#/components/schemas/${name}`,
});

const responseRef = (name: string): OpenApiObject => ({
  $ref: `#/components/responses/${name}`,
});

const jsonResponse = (
  description: string,
  schema: OpenApiObject,
): OpenApiObject => ({
  description,
  content: {
    "application/json": { schema },
  },
});

const jsonRequest = (
  schema: OpenApiObject,
  description?: string,
): OpenApiObject => ({
  required: true,
  ...(description ? { description } : {}),
  content: {
    "application/json": { schema },
  },
});

const optionalJsonRequest = (
  schema: OpenApiObject,
  description: string,
): OpenApiObject => ({
  required: false,
  description,
  content: {
    "application/json": { schema },
  },
});

const pathParameter = (name: string, description: string): OpenApiObject => ({
  name,
  in: "path",
  required: true,
  description,
  schema: schemaRef("Uuid"),
});

const queryParameter = (
  name: string,
  description: string,
  schema: OpenApiObject,
): OpenApiObject => ({
  name,
  in: "query",
  required: false,
  description,
  schema,
});

const paginationParameters = [
  queryParameter(
    "cursor",
    "Opaque cursor returned as nextCursor by the previous page.",
    { type: "string" },
  ),
  queryParameter("limit", "Maximum number of items to return.", {
    type: "integer",
    minimum: 1,
    maximum: 100,
    default: 25,
  }),
];

const authenticatedErrors = {
  "400": responseRef("BadRequest"),
  "401": responseRef("Unauthorized"),
  "403": responseRef("Forbidden"),
  "500": responseRef("InternalError"),
  "503": responseRef("ServiceUnavailable"),
};

const resourceErrors = {
  ...authenticatedErrors,
  "404": responseRef("NotFound"),
};

const mutationErrors = {
  ...resourceErrors,
  "409": responseRef("Conflict"),
};

const acarsMutationErrors = {
  ...mutationErrors,
  "422": responseRef("UnprocessableEntity"),
};

const clerkOrDevSecurity = [
  { clerkBearerAuth: [] },
  { devUserId: [], devOrgId: [], devRole: [] },
];

const cronSecurity = [{ cronBearerAuth: [] }];

const schemas = {
  Uuid: {
    type: "string",
    format: "uuid",
  },
  NullableUuid: {
    type: "string",
    format: "uuid",
    nullable: true,
  },
  DateTime: {
    type: "string",
    format: "date-time",
  },
  NullableDateTime: {
    type: "string",
    format: "date-time",
    nullable: true,
  },
  NullableString: {
    type: "string",
    nullable: true,
  },
  ArbitraryObject: {
    type: "object",
    additionalProperties: true,
  },
  AcarsStation: {
    type: "string",
    minLength: 1,
    maxLength: 20,
    pattern: "^[A-Za-z0-9-]+$",
    description:
      "Aircraft or ground-station callsign. The API trims and uppercases the value.",
    example: "SAS123",
  },
  Role: {
    type: "string",
    enum: ["pilot", "dispatcher", "admin"],
  },
  MembershipStatus: {
    type: "string",
    enum: ["active", "invited", "disabled"],
  },
  ScheduleRequestStatus: {
    type: "string",
    enum: [
      "pending",
      "in_review",
      "fulfilled",
      "partially_fulfilled",
      "rejected",
      "cancelled",
    ],
  },
  FlightStatus: {
    type: "string",
    enum: [
      "draft",
      "offered",
      "accepted",
      "declined",
      "briefed",
      "active",
      "completed",
      "cancelled",
    ],
  },
  AcarsDirection: {
    type: "string",
    enum: ["inbound", "outbound"],
  },
  AcarsMessageType: {
    type: "string",
    enum: ["telex", "progress", "cpdlc", "position", "other"],
  },
  AcarsProvider: {
    type: "string",
    enum: ["mock", "hoppie"],
  },
  ErrorCode: {
    type: "string",
    enum: [
      "BAD_REQUEST",
      "UNAUTHORIZED",
      "FORBIDDEN",
      "NOT_FOUND",
      "CONFLICT",
      "INVALID_TRANSITION",
      "UNPROCESSABLE",
      "UPSTREAM",
      "INTERNAL",
    ],
  },
  ErrorResponse: {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["code", "message"],
        properties: {
          code: schemaRef("ErrorCode"),
          message: { type: "string" },
          details: {
            description: "Optional structured error details.",
            nullable: true,
          },
        },
      },
    },
  },
  ValidatorErrorResponse: {
    type: "object",
    required: ["success", "error"],
    properties: {
      success: { type: "boolean", enum: [false] },
      error: {
        type: "object",
        required: ["name", "message"],
        properties: {
          name: { type: "string", example: "ZodError" },
          message: { type: "string" },
        },
      },
    },
  },
  UnavailableResponse: {
    type: "object",
    required: ["ok", "error"],
    properties: {
      ok: { type: "boolean", enum: [false] },
      error: { type: "string", example: "no database" },
    },
  },
  HealthResponse: {
    type: "object",
    required: ["ok", "service", "env", "database", "acarsProvider"],
    properties: {
      ok: { type: "boolean", example: true },
      service: { type: "string", example: "va-dispatch-api" },
      env: { type: "string", example: "development" },
      database: { type: "boolean" },
      acarsProvider: schemaRef("AcarsProvider"),
    },
  },
  MembershipProfile: {
    type: "object",
    required: ["id", "role", "displayName", "pilotCallsign", "status"],
    properties: {
      id: schemaRef("Uuid"),
      role: schemaRef("Role"),
      displayName: schemaRef("NullableString"),
      pilotCallsign: {
        type: "string",
        nullable: true,
        maxLength: 20,
        pattern: "^[A-Za-z0-9-]+$",
      },
      status: schemaRef("MembershipStatus"),
    },
  },
  Member: {
    type: "object",
    required: [
      "id",
      "clerkUserId",
      "role",
      "displayName",
      "pilotCallsign",
      "status",
      "createdAt",
    ],
    properties: {
      id: schemaRef("Uuid"),
      clerkUserId: { type: "string" },
      role: schemaRef("Role"),
      displayName: schemaRef("NullableString"),
      pilotCallsign: {
        type: "string",
        nullable: true,
        maxLength: 20,
        pattern: "^[A-Za-z0-9-]+$",
      },
      status: schemaRef("MembershipStatus"),
      createdAt: schemaRef("DateTime"),
    },
  },
  TenantSummary: {
    type: "object",
    required: ["id", "slug", "name", "hoppieStation"],
    properties: {
      id: schemaRef("Uuid"),
      slug: { type: "string" },
      name: { type: "string" },
      hoppieStation: {
        type: "string",
        nullable: true,
        maxLength: 20,
      },
    },
  },
  AcarsConfig: {
    type: "object",
    required: [
      "hoppieStation",
      "hasHoppieLogon",
      "acarsProvider",
      "hoppiePollingEnabled",
      "hoppieLastTestedAt",
    ],
    properties: {
      hoppieStation: {
        type: "string",
        nullable: true,
        maxLength: 20,
      },
      hasHoppieLogon: { type: "boolean" },
      acarsProvider: schemaRef("AcarsProvider"),
      hoppiePollingEnabled: { type: "boolean" },
      hoppieLastTestedAt: schemaRef("NullableDateTime"),
    },
  },
  Tenant: {
    type: "object",
    required: [
      "id",
      "slug",
      "name",
      "hoppieStation",
      "hasHoppieLogon",
      "acarsProvider",
      "hoppiePollingEnabled",
      "hoppieLastTestedAt",
      "settings",
    ],
    properties: {
      id: schemaRef("Uuid"),
      slug: { type: "string" },
      name: { type: "string" },
      hoppieStation: {
        type: "string",
        nullable: true,
        maxLength: 20,
      },
      hasHoppieLogon: { type: "boolean" },
      acarsProvider: schemaRef("AcarsProvider"),
      hoppiePollingEnabled: { type: "boolean" },
      hoppieLastTestedAt: schemaRef("NullableDateTime"),
      settings: schemaRef("ArbitraryObject"),
    },
  },
  TenantPatchResponse: {
    type: "object",
    required: ["id", "slug", "name", "settings"],
    properties: {
      id: schemaRef("Uuid"),
      slug: { type: "string" },
      name: { type: "string" },
      settings: schemaRef("ArbitraryObject"),
    },
  },
  ScheduleRequest: {
    type: "object",
    required: [
      "id",
      "pilotMembershipId",
      "title",
      "notes",
      "windowStart",
      "windowEnd",
      "desiredFlightCount",
      "preferences",
      "status",
      "rejectReason",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      id: schemaRef("Uuid"),
      pilotMembershipId: schemaRef("Uuid"),
      title: schemaRef("NullableString"),
      notes: schemaRef("NullableString"),
      windowStart: schemaRef("DateTime"),
      windowEnd: schemaRef("DateTime"),
      desiredFlightCount: { type: "integer", minimum: 1, maximum: 50 },
      preferences: schemaRef("ArbitraryObject"),
      status: schemaRef("ScheduleRequestStatus"),
      rejectReason: schemaRef("NullableString"),
      createdAt: schemaRef("DateTime"),
      updatedAt: schemaRef("DateTime"),
    },
  },
  Flight: {
    type: "object",
    required: [
      "id",
      "scheduleRequestId",
      "pilotMembershipId",
      "flightNumber",
      "depIcao",
      "arrIcao",
      "etd",
      "eta",
      "aircraftType",
      "status",
      "cancelReason",
      "declinedReason",
      "dispatcherNotes",
      "outAt",
      "offAt",
      "onAt",
      "inAt",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      id: schemaRef("Uuid"),
      scheduleRequestId: schemaRef("NullableUuid"),
      pilotMembershipId: schemaRef("NullableUuid"),
      flightNumber: { type: "string", minLength: 2, maxLength: 12 },
      depIcao: {
        type: "string",
        minLength: 4,
        maxLength: 4,
        example: "ESSA",
      },
      arrIcao: {
        type: "string",
        minLength: 4,
        maxLength: 4,
        example: "EKCH",
      },
      etd: schemaRef("DateTime"),
      eta: schemaRef("DateTime"),
      aircraftType: schemaRef("NullableString"),
      status: schemaRef("FlightStatus"),
      cancelReason: schemaRef("NullableString"),
      declinedReason: schemaRef("NullableString"),
      dispatcherNotes: schemaRef("NullableString"),
      outAt: schemaRef("NullableDateTime"),
      offAt: schemaRef("NullableDateTime"),
      onAt: schemaRef("NullableDateTime"),
      inAt: schemaRef("NullableDateTime"),
      createdAt: schemaRef("DateTime"),
      updatedAt: schemaRef("DateTime"),
    },
  },
  DispatchFlight: {
    type: "object",
    required: [
      "id",
      "flightNumber",
      "depIcao",
      "arrIcao",
      "etd",
      "eta",
      "status",
      "pilotMembershipId",
      "aircraftType",
    ],
    properties: {
      id: schemaRef("Uuid"),
      flightNumber: { type: "string" },
      depIcao: { type: "string" },
      arrIcao: { type: "string" },
      etd: schemaRef("DateTime"),
      eta: schemaRef("DateTime"),
      status: schemaRef("FlightStatus"),
      pilotMembershipId: schemaRef("NullableUuid"),
      aircraftType: schemaRef("NullableString"),
    },
  },
  AcarsMessage: {
    type: "object",
    required: [
      "id",
      "direction",
      "msgType",
      "fromStation",
      "toStation",
      "body",
      "flightId",
      "provider",
      "createdAt",
    ],
    properties: {
      id: schemaRef("Uuid"),
      direction: schemaRef("AcarsDirection"),
      msgType: schemaRef("AcarsMessageType"),
      fromStation: { type: "string" },
      toStation: { type: "string" },
      body: { type: "string" },
      hoppieRaw: {
        description: "Provider payload, present only on the detail endpoint.",
        nullable: true,
      },
      flightId: schemaRef("NullableUuid"),
      provider: schemaRef("AcarsProvider"),
      createdAt: schemaRef("DateTime"),
      receivedAt: schemaRef("NullableDateTime"),
      sentAt: schemaRef("NullableDateTime"),
    },
  },
  SentAcarsMessage: {
    type: "object",
    required: [
      "id",
      "direction",
      "fromStation",
      "toStation",
      "body",
      "provider",
      "sentAt",
    ],
    properties: {
      id: schemaRef("Uuid"),
      direction: schemaRef("AcarsDirection"),
      fromStation: { type: "string" },
      toStation: { type: "string" },
      body: { type: "string" },
      provider: schemaRef("AcarsProvider"),
      sentAt: schemaRef("NullableDateTime"),
    },
  },
  UpdateProfileInput: {
    type: "object",
    minProperties: 1,
    properties: {
      displayName: {
        type: "string",
        minLength: 1,
        maxLength: 120,
        nullable: true,
      },
      pilotCallsign: {
        type: "string",
        minLength: 1,
        maxLength: 20,
        pattern: "^[A-Za-z0-9-]+$",
        nullable: true,
      },
    },
  },
  UpdateTenantInput: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1, maxLength: 120 },
      settings: schemaRef("ArbitraryObject"),
    },
  },
  AcarsConfigInput: {
    type: "object",
    required: ["hoppieStation"],
    properties: {
      hoppieStation: schemaRef("AcarsStation"),
      hoppieLogon: {
        type: "string",
        format: "password",
        minLength: 1,
        maxLength: 128,
        writeOnly: true,
      },
    },
  },
  UpdateMemberInput: {
    type: "object",
    properties: {
      role: schemaRef("Role"),
      displayName: {
        type: "string",
        minLength: 1,
        maxLength: 120,
        nullable: true,
      },
      pilotCallsign: {
        type: "string",
        minLength: 1,
        maxLength: 20,
        pattern: "^[A-Za-z0-9-]+$",
        nullable: true,
      },
      status: schemaRef("MembershipStatus"),
    },
  },
  CreateScheduleRequestInput: {
    type: "object",
    required: ["windowStart", "windowEnd", "desiredFlightCount"],
    properties: {
      title: { type: "string", maxLength: 200, nullable: true },
      notes: { type: "string", maxLength: 2000, nullable: true },
      windowStart: schemaRef("DateTime"),
      windowEnd: schemaRef("DateTime"),
      desiredFlightCount: { type: "integer", minimum: 1, maximum: 50 },
      preferences: schemaRef("ArbitraryObject"),
    },
  },
  ReasonInput: {
    type: "object",
    properties: {
      reason: { type: "string", maxLength: 500 },
    },
  },
  CreateFlightInput: {
    type: "object",
    required: ["flightNumber", "depIcao", "arrIcao", "etd", "eta"],
    properties: {
      scheduleRequestId: schemaRef("NullableUuid"),
      pilotMembershipId: schemaRef("NullableUuid"),
      flightNumber: { type: "string", minLength: 2, maxLength: 12 },
      depIcao: { type: "string", minLength: 4, maxLength: 4 },
      arrIcao: { type: "string", minLength: 4, maxLength: 4 },
      etd: schemaRef("DateTime"),
      eta: schemaRef("DateTime"),
      aircraftType: { type: "string", maxLength: 20, nullable: true },
      status: { type: "string", enum: ["draft", "offered"] },
      dispatcherNotes: {
        type: "string",
        maxLength: 2000,
        nullable: true,
      },
    },
  },
  BulkFlightInput: {
    type: "object",
    required: ["flightNumber", "depIcao", "arrIcao", "etd", "eta"],
    properties: {
      flightNumber: { type: "string", minLength: 2, maxLength: 12 },
      depIcao: { type: "string", minLength: 4, maxLength: 4 },
      arrIcao: { type: "string", minLength: 4, maxLength: 4 },
      etd: schemaRef("DateTime"),
      eta: schemaRef("DateTime"),
      aircraftType: { type: "string", maxLength: 20, nullable: true },
      pilotMembershipId: schemaRef("NullableUuid"),
    },
  },
  BulkCreateFlightsInput: {
    type: "object",
    required: ["scheduleRequestId", "flights"],
    properties: {
      scheduleRequestId: schemaRef("Uuid"),
      flights: {
        type: "array",
        minItems: 1,
        maxItems: 50,
        items: schemaRef("BulkFlightInput"),
      },
    },
  },
  UpdateFlightInput: {
    type: "object",
    properties: {
      flightNumber: { type: "string", minLength: 2, maxLength: 12 },
      depIcao: { type: "string", minLength: 4, maxLength: 4 },
      arrIcao: { type: "string", minLength: 4, maxLength: 4 },
      etd: schemaRef("DateTime"),
      eta: schemaRef("DateTime"),
      aircraftType: { type: "string", maxLength: 20, nullable: true },
      pilotMembershipId: schemaRef("NullableUuid"),
      dispatcherNotes: {
        type: "string",
        maxLength: 2000,
        nullable: true,
      },
    },
  },
  UpdateFlightStatusInput: {
    type: "object",
    required: ["status"],
    properties: {
      status: {
        type: "string",
        enum: ["briefed", "active", "completed", "cancelled"],
      },
      reason: { type: "string", maxLength: 500 },
    },
  },
  SendAcarsMessageInput: {
    type: "object",
    required: ["to", "body"],
    properties: {
      to: schemaRef("AcarsStation"),
      body: { type: "string", minLength: 1, maxLength: 4000 },
      flightId: schemaRef("NullableUuid"),
    },
  },
  SimulateAcarsInput: {
    type: "object",
    required: ["from", "body"],
    properties: {
      from: schemaRef("AcarsStation"),
      to: schemaRef("AcarsStation"),
      body: { type: "string", minLength: 1, maxLength: 4000 },
      msgType: schemaRef("AcarsMessageType"),
    },
  },
  SeedVsasInput: {
    type: "object",
    properties: {
      clerkOrgId: { type: "string" },
      adminClerkUserId: { type: "string" },
      hoppieStation: { type: "string" },
    },
  },
  MeResponse: {
    type: "object",
    required: ["user", "membership", "tenant"],
    properties: {
      user: {
        type: "object",
        required: ["clerkUserId"],
        properties: { clerkUserId: { type: "string" } },
      },
      membership: {
        allOf: [schemaRef("MembershipProfile")],
        nullable: true,
      },
      tenant: { allOf: [schemaRef("TenantSummary")], nullable: true },
    },
  },
  MembershipResponse: {
    type: "object",
    required: ["membership"],
    properties: { membership: schemaRef("MembershipProfile") },
  },
  MemberListResponse: {
    type: "object",
    required: ["items"],
    properties: {
      items: { type: "array", items: schemaRef("Member") },
    },
  },
  SyncMembersResponse: {
    type: "object",
    required: ["synced"],
    properties: {
      synced: { type: "integer", minimum: 0 },
      note: { type: "string" },
    },
  },
  ScheduleRequestResponse: {
    type: "object",
    required: ["request"],
    properties: { request: schemaRef("ScheduleRequest") },
  },
  ScheduleRequestListResponse: {
    type: "object",
    required: ["items", "nextCursor"],
    properties: {
      items: { type: "array", items: schemaRef("ScheduleRequest") },
      nextCursor: { type: "string", nullable: true },
    },
  },
  ScheduleRequestDetailResponse: {
    type: "object",
    required: ["request", "flights"],
    properties: {
      request: schemaRef("ScheduleRequest"),
      flights: { type: "array", items: schemaRef("Flight") },
    },
  },
  FlightResponse: {
    type: "object",
    required: ["flight"],
    properties: { flight: schemaRef("Flight") },
  },
  FlightListResponse: {
    type: "object",
    required: ["items", "nextCursor"],
    properties: {
      items: { type: "array", items: schemaRef("Flight") },
      nextCursor: { type: "string", nullable: true },
    },
  },
  BulkFlightsResponse: {
    type: "object",
    required: ["flights"],
    properties: {
      flights: { type: "array", items: schemaRef("Flight") },
    },
  },
  DispatchBoardResponse: {
    type: "object",
    required: ["flights", "scheduleRequestCounts"],
    properties: {
      flights: { type: "array", items: schemaRef("DispatchFlight") },
      scheduleRequestCounts: {
        type: "object",
        additionalProperties: { type: "integer", minimum: 0 },
      },
    },
  },
  AcarsMessageListResponse: {
    type: "object",
    required: ["items", "nextCursor"],
    properties: {
      items: { type: "array", items: schemaRef("AcarsMessage") },
      nextCursor: { type: "string", nullable: true },
    },
  },
  AcarsMessageResponse: {
    type: "object",
    required: ["message"],
    properties: { message: schemaRef("AcarsMessage") },
  },
  SentAcarsMessageResponse: {
    type: "object",
    required: ["message"],
    properties: { message: schemaRef("SentAcarsMessage") },
  },
  SimulateAcarsResponse: {
    type: "object",
    required: ["queued", "to"],
    properties: {
      queued: { type: "boolean", example: true },
      to: { type: "string" },
    },
  },
  PollAcarsResponse: {
    type: "object",
    required: ["ok", "tenants", "messages"],
    properties: {
      ok: { type: "boolean", example: true },
      tenants: { type: "integer", minimum: 0 },
      messages: { type: "integer", minimum: 0 },
      skipped: { type: "string", nullable: true },
    },
  },
  SeedVsasResponse: {
    type: "object",
    required: ["ok", "tenant", "adminMembershipId"],
    properties: {
      ok: { type: "boolean", example: true },
      tenant: {
        type: "object",
        required: ["id", "slug", "name", "clerkOrgId", "hoppieStation"],
        properties: {
          id: schemaRef("Uuid"),
          slug: { type: "string" },
          name: { type: "string" },
          clerkOrgId: { type: "string" },
          hoppieStation: { type: "string", nullable: true },
        },
      },
      adminMembershipId: schemaRef("NullableUuid"),
    },
  },
};

const responses = {
  BadRequest: jsonResponse("The request or cursor is invalid.", {
    oneOf: [schemaRef("ErrorResponse"), schemaRef("ValidatorErrorResponse")],
  }),
  Unauthorized: jsonResponse(
    "Authentication is missing or invalid.",
    schemaRef("ErrorResponse"),
  ),
  Forbidden: jsonResponse(
    "The authenticated member does not have access.",
    schemaRef("ErrorResponse"),
  ),
  NotFound: jsonResponse(
    "The requested tenant-scoped resource does not exist.",
    schemaRef("ErrorResponse"),
  ),
  Conflict: jsonResponse(
    "The request conflicts with current state or violates a uniqueness rule.",
    schemaRef("ErrorResponse"),
  ),
  UnprocessableEntity: jsonResponse(
    "The request is valid but cannot be processed with the current configuration.",
    schemaRef("ErrorResponse"),
  ),
  UpstreamError: jsonResponse(
    "The configured upstream ACARS provider rejected or failed the request.",
    schemaRef("ErrorResponse"),
  ),
  InternalError: jsonResponse(
    "An unexpected server error occurred.",
    schemaRef("ErrorResponse"),
  ),
  ServiceUnavailable: jsonResponse(
    "A required service or configuration is unavailable.",
    {
      oneOf: [schemaRef("ErrorResponse"), schemaRef("UnavailableResponse")],
    },
  ),
};

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "VA Dispatch API",
    version: "0.1.0",
    description:
      "Multi-tenant REST API for Virtual Airline scheduling, live dispatch, flights, membership administration, and ACARS messaging. All tenant data is resolved from the authenticated Clerk organization; clients never supply a tenant ID.",
    license: {
      name: "AGPL-3.0-or-later",
      url: "https://www.gnu.org/licenses/agpl-3.0.html",
    },
  },
  externalDocs: {
    description: "VA Dispatch source repository",
    url: "https://github.com/shiftbloom-studio/va-dispatcher",
  },
  servers: [
    {
      url: "/api/v1",
      description: "Public same-origin API",
    },
    {
      url: "/v1",
      description: "Service-scoped alias when the /api prefix is stripped",
    },
  ],
  security: clerkOrDevSecurity,
  tags: [
    {
      name: "Health",
      description: "Service liveness and configuration state.",
    },
    { name: "Profile", description: "Current user and membership profile." },
    {
      name: "Tenant",
      description: "Virtual Airline settings and ACARS configuration.",
    },
    { name: "Members", description: "Tenant membership administration." },
    {
      name: "Schedule requests",
      description: "Pilot schedule demand and dispatcher review.",
    },
    {
      name: "Flights",
      description: "Flight creation, assignment, and lifecycle transitions.",
    },
    { name: "Dispatch", description: "Dispatcher operational views." },
    { name: "ACARS", description: "Tenant-scoped ACARS messaging." },
    {
      name: "Internal",
      description:
        "Secret-authenticated deployment and development operations.",
    },
  ],
  paths: {
    "/health": {
      servers: [
        { url: "/", description: "Direct service path" },
        { url: "/api", description: "Public rewrite-compatible path" },
      ],
      get: {
        tags: ["Health"],
        operationId: "getHealth",
        summary: "Get service health",
        description:
          "Returns liveness plus database availability and the active ACARS adapter. This endpoint does not perform a database round trip.",
        security: [],
        responses: {
          "200": jsonResponse(
            "Current service health.",
            schemaRef("HealthResponse"),
          ),
        },
      },
    },
    "/me": {
      get: {
        tags: ["Profile"],
        operationId: "getCurrentUser",
        summary: "Get the current user context",
        responses: {
          "200": jsonResponse(
            "Resolved user, membership, and tenant.",
            schemaRef("MeResponse"),
          ),
          ...authenticatedErrors,
        },
      },
      patch: {
        tags: ["Profile"],
        operationId: "updateCurrentUser",
        summary: "Update the current member profile",
        description:
          "Updates the caller's display name and/or personal aircraft ACARS callsign.",
        requestBody: jsonRequest(schemaRef("UpdateProfileInput")),
        responses: {
          "200": jsonResponse(
            "Updated membership profile.",
            schemaRef("MembershipResponse"),
          ),
          ...mutationErrors,
        },
      },
    },
    "/tenant": {
      get: {
        tags: ["Tenant"],
        operationId: "getTenant",
        summary: "Get the current tenant",
        responses: {
          "200": jsonResponse(
            "Current Virtual Airline configuration.",
            schemaRef("Tenant"),
          ),
          ...resourceErrors,
        },
      },
      patch: {
        tags: ["Tenant"],
        operationId: "updateTenant",
        summary: "Update tenant settings",
        description: "Requires the admin role.",
        "x-required-role": "admin",
        requestBody: jsonRequest(schemaRef("UpdateTenantInput")),
        responses: {
          "200": jsonResponse(
            "Updated tenant settings.",
            schemaRef("TenantPatchResponse"),
          ),
          ...resourceErrors,
        },
      },
    },
    "/tenant/acars-config": {
      put: {
        tags: ["Tenant"],
        operationId: "configureTenantAcars",
        summary: "Configure and verify Hoppie ACARS",
        description:
          "Requires the admin role. Tests the supplied station/logon before encrypting and storing the logon. Omit hoppieLogon to retain an existing stored secret.",
        "x-required-role": "admin",
        requestBody: jsonRequest(schemaRef("AcarsConfigInput")),
        responses: {
          "200": jsonResponse(
            "Verified ACARS configuration state.",
            schemaRef("AcarsConfig"),
          ),
          ...acarsMutationErrors,
          "502": responseRef("UpstreamError"),
        },
      },
      delete: {
        tags: ["Tenant"],
        operationId: "clearTenantAcars",
        summary: "Clear the stored Hoppie logon",
        description:
          "Requires the admin role. The station name is retained while the encrypted secret and last-tested timestamp are removed.",
        "x-required-role": "admin",
        responses: {
          "200": jsonResponse(
            "Cleared ACARS configuration state.",
            schemaRef("AcarsConfig"),
          ),
          ...resourceErrors,
        },
      },
    },
    "/tenant/acars-config/test": {
      post: {
        tags: ["Tenant"],
        operationId: "testTenantAcars",
        summary: "Test the stored Hoppie configuration",
        description: "Requires the admin role.",
        "x-required-role": "admin",
        responses: {
          "200": jsonResponse(
            "Tested ACARS configuration state.",
            schemaRef("AcarsConfig"),
          ),
          ...acarsMutationErrors,
          "502": responseRef("UpstreamError"),
        },
      },
    },
    "/members": {
      get: {
        tags: ["Members"],
        operationId: "listMembers",
        summary: "List tenant members",
        description: "Requires the dispatcher role or higher.",
        "x-required-role": "dispatcher",
        responses: {
          "200": jsonResponse(
            "Tenant members.",
            schemaRef("MemberListResponse"),
          ),
          ...authenticatedErrors,
        },
      },
    },
    "/members/{id}": {
      patch: {
        tags: ["Members"],
        operationId: "updateMember",
        summary: "Update a tenant member",
        description: "Requires the admin role.",
        "x-required-role": "admin",
        parameters: [pathParameter("id", "Membership ID.")],
        requestBody: jsonRequest(schemaRef("UpdateMemberInput")),
        responses: {
          "200": jsonResponse(
            "Updated member.",
            schemaRef("MembershipProfile"),
          ),
          ...mutationErrors,
        },
      },
    },
    "/members/sync": {
      post: {
        tags: ["Members"],
        operationId: "syncMembers",
        summary: "Synchronize members from Clerk",
        description:
          "Requires the dispatcher role or higher. In local development bypass mode the operation returns without contacting Clerk.",
        "x-required-role": "dispatcher",
        responses: {
          "200": jsonResponse(
            "Synchronization result.",
            schemaRef("SyncMembersResponse"),
          ),
          ...authenticatedErrors,
        },
      },
    },
    "/schedule-requests": {
      post: {
        tags: ["Schedule requests"],
        operationId: "createScheduleRequest",
        summary: "Create a schedule request",
        requestBody: jsonRequest(schemaRef("CreateScheduleRequestInput")),
        responses: {
          "201": jsonResponse(
            "Created schedule request.",
            schemaRef("ScheduleRequestResponse"),
          ),
          ...authenticatedErrors,
        },
      },
      get: {
        tags: ["Schedule requests"],
        operationId: "listScheduleRequests",
        summary: "List visible schedule requests",
        description:
          "Pilots see only their own requests; dispatchers and admins see the tenant queue.",
        parameters: [
          ...paginationParameters,
          queryParameter(
            "status",
            "Filter by lifecycle status.",
            schemaRef("ScheduleRequestStatus"),
          ),
        ],
        responses: {
          "200": jsonResponse(
            "A page of schedule requests.",
            schemaRef("ScheduleRequestListResponse"),
          ),
          ...authenticatedErrors,
        },
      },
    },
    "/schedule-requests/{id}": {
      get: {
        tags: ["Schedule requests"],
        operationId: "getScheduleRequest",
        summary: "Get a schedule request and linked flights",
        parameters: [pathParameter("id", "Schedule request ID.")],
        responses: {
          "200": jsonResponse(
            "Schedule request detail.",
            schemaRef("ScheduleRequestDetailResponse"),
          ),
          ...resourceErrors,
        },
      },
    },
    "/schedule-requests/{id}/cancel": {
      post: {
        tags: ["Schedule requests"],
        operationId: "cancelScheduleRequest",
        summary: "Cancel a schedule request",
        description:
          "The owning pilot may cancel their request; dispatchers and admins may cancel any tenant request.",
        parameters: [pathParameter("id", "Schedule request ID.")],
        responses: {
          "200": jsonResponse(
            "Cancelled schedule request.",
            schemaRef("ScheduleRequestResponse"),
          ),
          ...mutationErrors,
        },
      },
    },
    "/schedule-requests/{id}/review": {
      post: {
        tags: ["Schedule requests"],
        operationId: "reviewScheduleRequest",
        summary: "Move a schedule request into review",
        description: "Requires the dispatcher role or higher.",
        "x-required-role": "dispatcher",
        parameters: [pathParameter("id", "Schedule request ID.")],
        responses: {
          "200": jsonResponse(
            "Schedule request in review.",
            schemaRef("ScheduleRequestResponse"),
          ),
          ...mutationErrors,
        },
      },
    },
    "/schedule-requests/{id}/reject": {
      post: {
        tags: ["Schedule requests"],
        operationId: "rejectScheduleRequest",
        summary: "Reject a schedule request",
        description: "Requires the dispatcher role or higher.",
        "x-required-role": "dispatcher",
        parameters: [pathParameter("id", "Schedule request ID.")],
        requestBody: optionalJsonRequest(
          schemaRef("ReasonInput"),
          "Optional rejection reason.",
        ),
        responses: {
          "200": jsonResponse(
            "Rejected schedule request.",
            schemaRef("ScheduleRequestResponse"),
          ),
          ...mutationErrors,
        },
      },
    },
    "/flights": {
      post: {
        tags: ["Flights"],
        operationId: "createFlight",
        summary: "Create a flight",
        description: "Requires the dispatcher role or higher.",
        "x-required-role": "dispatcher",
        requestBody: jsonRequest(schemaRef("CreateFlightInput")),
        responses: {
          "201": jsonResponse("Created flight.", schemaRef("FlightResponse")),
          ...mutationErrors,
        },
      },
      get: {
        tags: ["Flights"],
        operationId: "listFlights",
        summary: "List visible flights",
        description:
          "Pilots see only assigned flights; dispatchers and admins see all tenant flights.",
        parameters: [
          ...paginationParameters,
          queryParameter("status", "Comma-separated flight statuses.", {
            type: "string",
            example: "offered,accepted",
          }),
          queryParameter(
            "fromEtd",
            "Earliest estimated departure time.",
            schemaRef("DateTime"),
          ),
          queryParameter(
            "toEtd",
            "Latest estimated departure time.",
            schemaRef("DateTime"),
          ),
          queryParameter(
            "scheduleRequestId",
            "Filter by linked schedule request.",
            schemaRef("Uuid"),
          ),
        ],
        responses: {
          "200": jsonResponse(
            "A page of flights.",
            schemaRef("FlightListResponse"),
          ),
          ...authenticatedErrors,
        },
      },
    },
    "/flights/bulk": {
      post: {
        tags: ["Flights"],
        operationId: "bulkCreateFlights",
        summary: "Create offered flights for a schedule request",
        description: "Requires the dispatcher role or higher.",
        "x-required-role": "dispatcher",
        requestBody: jsonRequest(schemaRef("BulkCreateFlightsInput")),
        responses: {
          "201": jsonResponse(
            "Created flights.",
            schemaRef("BulkFlightsResponse"),
          ),
          ...mutationErrors,
        },
      },
    },
    "/flights/{id}": {
      get: {
        tags: ["Flights"],
        operationId: "getFlight",
        summary: "Get a flight",
        parameters: [pathParameter("id", "Flight ID.")],
        responses: {
          "200": jsonResponse("Flight detail.", schemaRef("FlightResponse")),
          ...resourceErrors,
        },
      },
      patch: {
        tags: ["Flights"],
        operationId: "updateFlight",
        summary: "Update a flight",
        description: "Requires the dispatcher role or higher.",
        "x-required-role": "dispatcher",
        parameters: [pathParameter("id", "Flight ID.")],
        requestBody: jsonRequest(schemaRef("UpdateFlightInput")),
        responses: {
          "200": jsonResponse("Updated flight.", schemaRef("FlightResponse")),
          ...mutationErrors,
        },
      },
    },
    "/flights/{id}/offer": {
      post: {
        tags: ["Flights"],
        operationId: "offerFlight",
        summary: "Offer a flight to its assigned pilot",
        description: "Requires the dispatcher role or higher.",
        "x-required-role": "dispatcher",
        parameters: [pathParameter("id", "Flight ID.")],
        responses: {
          "200": jsonResponse("Offered flight.", schemaRef("FlightResponse")),
          ...mutationErrors,
        },
      },
    },
    "/flights/{id}/accept": {
      post: {
        tags: ["Flights"],
        operationId: "acceptFlight",
        summary: "Accept an assigned flight",
        description: "Only the assigned pilot can accept the flight.",
        parameters: [pathParameter("id", "Flight ID.")],
        responses: {
          "200": jsonResponse("Accepted flight.", schemaRef("FlightResponse")),
          ...mutationErrors,
        },
      },
    },
    "/flights/{id}/decline": {
      post: {
        tags: ["Flights"],
        operationId: "declineFlight",
        summary: "Decline an assigned flight",
        description: "Only the assigned pilot can decline the flight.",
        parameters: [pathParameter("id", "Flight ID.")],
        requestBody: optionalJsonRequest(
          schemaRef("ReasonInput"),
          "Optional decline reason.",
        ),
        responses: {
          "200": jsonResponse("Declined flight.", schemaRef("FlightResponse")),
          ...mutationErrors,
        },
      },
    },
    "/flights/{id}/cancel": {
      post: {
        tags: ["Flights"],
        operationId: "cancelFlight",
        summary: "Cancel a flight",
        description:
          "Dispatchers and admins may cancel tenant flights. An assigned pilot may cancel only in an allowed lifecycle state.",
        parameters: [pathParameter("id", "Flight ID.")],
        requestBody: optionalJsonRequest(
          schemaRef("ReasonInput"),
          "Optional cancellation reason.",
        ),
        responses: {
          "200": jsonResponse("Cancelled flight.", schemaRef("FlightResponse")),
          ...mutationErrors,
        },
      },
    },
    "/flights/{id}/status": {
      post: {
        tags: ["Flights"],
        operationId: "updateFlightStatus",
        summary: "Advance the operational flight status",
        description: "Requires the dispatcher role or higher.",
        "x-required-role": "dispatcher",
        parameters: [pathParameter("id", "Flight ID.")],
        requestBody: jsonRequest(schemaRef("UpdateFlightStatusInput")),
        responses: {
          "200": jsonResponse(
            "Updated flight status.",
            schemaRef("FlightResponse"),
          ),
          ...mutationErrors,
        },
      },
    },
    "/dispatch/board": {
      get: {
        tags: ["Dispatch"],
        operationId: "getDispatchBoard",
        summary: "Get the live dispatch board",
        description: "Requires the dispatcher role or higher.",
        "x-required-role": "dispatcher",
        responses: {
          "200": jsonResponse(
            "Flights and schedule-request counts.",
            schemaRef("DispatchBoardResponse"),
          ),
          ...authenticatedErrors,
        },
      },
    },
    "/dispatch/inbox": {
      get: {
        tags: ["Dispatch"],
        operationId: "getDispatchInbox",
        summary: "Get the latest ACARS inbox page",
        description: "Requires the dispatcher role or higher.",
        "x-required-role": "dispatcher",
        responses: {
          "200": jsonResponse(
            "Latest ACARS messages.",
            schemaRef("AcarsMessageListResponse"),
          ),
          ...authenticatedErrors,
        },
      },
    },
    "/acars/messages": {
      get: {
        tags: ["ACARS"],
        operationId: "listAcarsMessages",
        summary: "List ACARS messages",
        description: "Requires the dispatcher role or higher.",
        "x-required-role": "dispatcher",
        parameters: [
          ...paginationParameters,
          queryParameter(
            "direction",
            "Filter by message direction.",
            schemaRef("AcarsDirection"),
          ),
          queryParameter(
            "flightId",
            "Filter by linked flight.",
            schemaRef("Uuid"),
          ),
          queryParameter(
            "station",
            "Match either the sender or recipient station.",
            { type: "string" },
          ),
        ],
        responses: {
          "200": jsonResponse(
            "A page of ACARS messages.",
            schemaRef("AcarsMessageListResponse"),
          ),
          ...authenticatedErrors,
        },
      },
      post: {
        tags: ["ACARS"],
        operationId: "sendAcarsMessage",
        summary: "Send an ACARS telex",
        description:
          "Requires the dispatcher role or higher. Messages are persisted only after the configured provider accepts the send.",
        "x-required-role": "dispatcher",
        requestBody: jsonRequest(schemaRef("SendAcarsMessageInput")),
        responses: {
          "201": jsonResponse(
            "Sent ACARS message.",
            schemaRef("SentAcarsMessageResponse"),
          ),
          ...acarsMutationErrors,
          "502": responseRef("UpstreamError"),
        },
      },
    },
    "/acars/messages/{id}": {
      get: {
        tags: ["ACARS"],
        operationId: "getAcarsMessage",
        summary: "Get an ACARS message",
        description: "Requires the dispatcher role or higher.",
        "x-required-role": "dispatcher",
        parameters: [pathParameter("id", "ACARS message ID.")],
        responses: {
          "200": jsonResponse(
            "ACARS message detail.",
            schemaRef("AcarsMessageResponse"),
          ),
          ...resourceErrors,
        },
      },
    },
    "/acars/simulate": {
      post: {
        tags: ["ACARS"],
        operationId: "simulateAcarsMessage",
        summary: "Simulate an inbound ACARS message",
        description:
          "Development/test fixture for the mock ACARS adapter. Requires the dispatcher role or higher and returns 404 in production or when the mock adapter is disabled.",
        "x-required-role": "dispatcher",
        requestBody: jsonRequest(schemaRef("SimulateAcarsInput")),
        responses: {
          "201": jsonResponse(
            "Queued and synchronously ingested mock message.",
            schemaRef("SimulateAcarsResponse"),
          ),
          ...resourceErrors,
        },
      },
    },
    "/internal/cron/acars-poll": {
      get: {
        tags: ["Internal"],
        operationId: "pollAcarsGet",
        summary: "Poll configured Hoppie tenants",
        description:
          "Vercel cron-compatible GET form. Authenticate with CRON_SECRET as a bearer token.",
        security: cronSecurity,
        responses: {
          "200": jsonResponse(
            "Polling summary.",
            schemaRef("PollAcarsResponse"),
          ),
          "401": responseRef("Unauthorized"),
          "500": responseRef("InternalError"),
          "503": responseRef("ServiceUnavailable"),
        },
      },
      post: {
        tags: ["Internal"],
        operationId: "pollAcarsPost",
        summary: "Poll configured Hoppie tenants",
        description:
          "Manual POST form. Authenticate with CRON_SECRET as a bearer token.",
        security: cronSecurity,
        responses: {
          "200": jsonResponse(
            "Polling summary.",
            schemaRef("PollAcarsResponse"),
          ),
          "401": responseRef("Unauthorized"),
          "500": responseRef("InternalError"),
          "503": responseRef("ServiceUnavailable"),
        },
      },
    },
    "/internal/seed/vsas": {
      post: {
        tags: ["Internal"],
        operationId: "seedVsas",
        summary: "Seed or repair the vSAS development tenant",
        description:
          "Authenticate with CRON_SECRET. Local non-production development may instead use AUTH_DEV_BYPASS.",
        security: [
          ...cronSecurity,
          { devUserId: [], devOrgId: [], devRole: [] },
        ],
        requestBody: optionalJsonRequest(
          schemaRef("SeedVsasInput"),
          "Optional seed overrides.",
        ),
        responses: {
          "200": jsonResponse(
            "Seeded tenant and optional admin membership.",
            schemaRef("SeedVsasResponse"),
          ),
          "400": responseRef("BadRequest"),
          "401": responseRef("Unauthorized"),
          "500": responseRef("InternalError"),
          "503": responseRef("ServiceUnavailable"),
        },
      },
    },
  },
  components: {
    securitySchemes: {
      clerkBearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "Production Clerk session JWT with an active Organization claim.",
      },
      devUserId: {
        type: "apiKey",
        in: "header",
        name: "X-Dev-User-Id",
        description:
          "Local development identity. Used only when AUTH_DEV_BYPASS=true outside production.",
      },
      devOrgId: {
        type: "apiKey",
        in: "header",
        name: "X-Dev-Org-Id",
        description: "Local development Clerk Organization ID.",
      },
      devRole: {
        type: "apiKey",
        in: "header",
        name: "X-Dev-Role",
        description: "Local development role: pilot, dispatcher, or admin.",
      },
      cronBearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "CRON_SECRET for internal deployment operations.",
      },
    },
    schemas,
    responses,
  },
} as const;
