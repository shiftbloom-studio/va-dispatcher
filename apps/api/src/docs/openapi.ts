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

const requiredQueryParameter = (
  name: string,
  description: string,
  schema: OpenApiObject,
): OpenApiObject => ({
  name,
  in: "query",
  required: true,
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
  SimbriefDispatchStatus: {
    type: "string",
    enum: ["pending", "ready"],
  },
  BrandPresence: {
    type: "string",
    enum: ["restrained", "balanced", "high"],
  },
  DispatchUnit: {
    type: "string",
    enum: ["kg", "lb"],
  },
  TenantBrand: {
    type: "object",
    required: ["seedColor", "presence", "logoUrl"],
    properties: {
      seedColor: {
        type: "string",
        pattern: "^#[0-9a-f]{6}$",
        example: "#e64646",
      },
      presence: schemaRef("BrandPresence"),
      logoUrl: { type: "string", format: "uri", nullable: true },
    },
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
      "brand",
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
      brand: schemaRef("TenantBrand"),
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
  TenantBrandResponse: {
    type: "object",
    required: ["brand"],
    properties: { brand: schemaRef("TenantBrand") },
  },
  PublicTenantResponse: {
    type: "object",
    required: ["slug", "name", "brand"],
    properties: {
      slug: { type: "string" },
      name: { type: "string" },
      brand: schemaRef("TenantBrand"),
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
      "assignmentRevision",
      "assignmentConfirmedRevision",
      "assignmentConfirmedAt",
      "assignmentConfirmationRequired",
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
      assignmentRevision: { type: "integer", minimum: 1 },
      assignmentConfirmedRevision: {
        type: "integer",
        minimum: 1,
        nullable: true,
      },
      assignmentConfirmedAt: schemaRef("NullableDateTime"),
      assignmentConfirmationRequired: { type: "boolean" },
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
      "assignmentConfirmationRequired",
      "latestReleaseRevision",
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
      dispatcherNotes: schemaRef("NullableString"),
      assignmentRevision: { type: "integer", minimum: 1 },
      assignmentConfirmedRevision: {
        type: "integer",
        nullable: true,
      },
      assignmentConfirmedAt: schemaRef("NullableDateTime"),
      assignmentConfirmationRequired: { type: "boolean" },
      latestReleaseRevision: { type: "integer", minimum: 1, nullable: true },
      outAt: schemaRef("NullableDateTime"),
      inAt: schemaRef("NullableDateTime"),
    },
  },
  DispatchRelease: {
    type: "object",
    required: [
      "id",
      "flightId",
      "revision",
      "operationalRoute",
      "sid",
      "star",
      "cruiseLevel",
      "alternateIcao",
      "fuelUnit",
      "payloadUnit",
      "taxiFuel",
      "tripFuel",
      "contingencyFuel",
      "alternateFuel",
      "finalReserveFuel",
      "additionalFuel",
      "blockFuel",
      "plannedPayload",
      "weatherSnapshot",
      "releaseNotes",
      "dispatcherRemarks",
      "releasedByMembershipId",
      "releasedAt",
    ],
    properties: {
      id: schemaRef("Uuid"),
      flightId: schemaRef("Uuid"),
      revision: { type: "integer", minimum: 1 },
      operationalRoute: { type: "string" },
      sid: schemaRef("NullableString"),
      star: schemaRef("NullableString"),
      cruiseLevel: { type: "integer", minimum: 10, maximum: 600 },
      alternateIcao: { type: "string", minLength: 4, maxLength: 4 },
      fuelUnit: schemaRef("DispatchUnit"),
      payloadUnit: schemaRef("DispatchUnit"),
      taxiFuel: { type: "integer", minimum: 0 },
      tripFuel: { type: "integer", minimum: 1 },
      contingencyFuel: { type: "integer", minimum: 0 },
      alternateFuel: { type: "integer", minimum: 0 },
      finalReserveFuel: { type: "integer", minimum: 0 },
      additionalFuel: { type: "integer", minimum: 0 },
      blockFuel: {
        type: "integer",
        minimum: 1,
        description: "Exact sum of every fuel breakdown field.",
      },
      plannedPayload: { type: "integer", minimum: 0 },
      weatherSnapshot: schemaRef("ArbitraryObject"),
      releaseNotes: schemaRef("NullableString"),
      dispatcherRemarks: schemaRef("NullableString"),
      releasedByMembershipId: schemaRef("NullableUuid"),
      releasedAt: schemaRef("DateTime"),
    },
  },
  FlightOperationalEvent: {
    type: "object",
    required: [
      "id",
      "kind",
      "source",
      "occurredAt",
      "actorMembershipId",
      "acarsMessageId",
      "meta",
    ],
    properties: {
      id: schemaRef("Uuid"),
      kind: {
        type: "string",
        enum: [
          "flt_init",
          "out",
          "off",
          "on",
          "in",
          "manual_start",
          "manual_finish",
          "assignment_confirmed",
        ],
      },
      source: {
        type: "string",
        enum: ["hoppie", "pilot_web", "dispatcher"],
      },
      occurredAt: schemaRef("DateTime"),
      actorMembershipId: schemaRef("NullableUuid"),
      acarsMessageId: schemaRef("NullableUuid"),
      meta: schemaRef("ArbitraryObject"),
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
  SimbriefConnection: {
    type: "object",
    required: ["connected", "userId", "verified", "verifiedAt", "oauth"],
    properties: {
      connected: { type: "boolean" },
      userId: {
        type: "string",
        nullable: true,
        pattern: "^[1-9]\\d{1,11}$",
        description: "Numeric SimBrief Pilot ID.",
      },
      verified: { type: "boolean" },
      verifiedAt: schemaRef("NullableDateTime"),
      oauth: {
        type: "object",
        required: ["configured", "connected", "username", "connectedAt"],
        properties: {
          configured: { type: "boolean" },
          connected: { type: "boolean" },
          username: schemaRef("NullableString"),
          connectedAt: schemaRef("NullableDateTime"),
        },
      },
    },
  },
  SimbriefDispatch: {
    type: "object",
    required: [
      "id",
      "flightId",
      "createdByMembershipId",
      "staticId",
      "status",
      "request",
      "ofp",
      "simbriefRequestId",
      "generatedAt",
      "syncedAt",
      "lastError",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      id: schemaRef("Uuid"),
      flightId: schemaRef("Uuid"),
      createdByMembershipId: schemaRef("NullableUuid"),
      staticId: { type: "string", example: "VAD_0123456789abcdef" },
      status: schemaRef("SimbriefDispatchStatus"),
      request: {
        type: "object",
        additionalProperties: { type: "string" },
        description:
          "Normalized dispatch parameters. SimBrief user identifiers are omitted from API responses.",
      },
      ofp: {
        type: "object",
        nullable: true,
        additionalProperties: true,
        description:
          "Untrusted SimBrief operational flight-plan JSON. Sanitize plan_html before rendering it in a UI.",
      },
      simbriefRequestId: schemaRef("NullableString"),
      generatedAt: schemaRef("NullableDateTime"),
      syncedAt: schemaRef("NullableDateTime"),
      lastError: schemaRef("NullableString"),
      createdAt: schemaRef("DateTime"),
      updatedAt: schemaRef("DateTime"),
    },
  },
  SimbriefCallbackDispatch: {
    type: "object",
    required: ["id", "flightId", "status", "generatedAt"],
    properties: {
      id: schemaRef("Uuid"),
      flightId: schemaRef("Uuid"),
      status: schemaRef("SimbriefDispatchStatus"),
      generatedAt: schemaRef("NullableDateTime"),
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
  UpdateTenantBrandInput: {
    type: "object",
    required: ["seedColor", "presence"],
    properties: {
      seedColor: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
      presence: schemaRef("BrandPresence"),
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
      pilotMembershipId: schemaRef("NullableUuid"),
      expectedUpdatedAt: {
        ...schemaRef("DateTime"),
        description:
          "Last observed flight update time used to prevent lost dispatcher edits.",
      },
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
        enum: ["active", "completed", "cancelled"],
      },
      reason: { type: "string", maxLength: 500 },
    },
  },
  DispatchReleaseInput: {
    type: "object",
    required: [
      "operationalRoute",
      "cruiseLevel",
      "alternateIcao",
      "fuelUnit",
      "payloadUnit",
      "taxiFuel",
      "tripFuel",
      "contingencyFuel",
      "alternateFuel",
      "finalReserveFuel",
      "blockFuel",
      "plannedPayload",
    ],
    properties: {
      operationalRoute: { type: "string", minLength: 1, maxLength: 1000 },
      sid: { type: "string", maxLength: 40, nullable: true },
      star: { type: "string", maxLength: 40, nullable: true },
      cruiseLevel: { type: "integer", minimum: 10, maximum: 600 },
      alternateIcao: { type: "string", minLength: 4, maxLength: 4 },
      fuelUnit: schemaRef("DispatchUnit"),
      payloadUnit: schemaRef("DispatchUnit"),
      taxiFuel: { type: "integer", minimum: 0 },
      tripFuel: { type: "integer", minimum: 1 },
      contingencyFuel: { type: "integer", minimum: 0 },
      alternateFuel: { type: "integer", minimum: 0 },
      finalReserveFuel: { type: "integer", minimum: 0 },
      additionalFuel: { type: "integer", minimum: 0, default: 0 },
      blockFuel: {
        type: "integer",
        minimum: 1,
        description: "Must equal the sum of every fuel breakdown field.",
      },
      plannedPayload: { type: "integer", minimum: 0 },
      releaseNotes: { type: "string", maxLength: 4000, nullable: true },
      dispatcherRemarks: {
        type: "string",
        maxLength: 4000,
        nullable: true,
      },
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
  ConnectSimbriefInput: {
    type: "object",
    required: ["userId"],
    additionalProperties: false,
    properties: {
      userId: {
        type: "string",
        pattern: "^[1-9]\\d{1,11}$",
        description: "Numeric SimBrief Pilot ID, not a username.",
        example: "123456",
      },
    },
  },
  CreateSimbriefDispatchInput: {
    type: "object",
    additionalProperties: false,
    properties: {
      aircraftType: {
        type: "string",
        minLength: 2,
        maxLength: 64,
        pattern: "^[A-Za-z0-9_-]+$",
        description:
          "ICAO aircraft type or SimBrief airframe Internal ID. Defaults to the flight aircraft type.",
      },
      airline: { type: "string", minLength: 1, maxLength: 3 },
      flightNumber: { type: "string", minLength: 1, maxLength: 12 },
      callsign: {
        type: "string",
        minLength: 2,
        maxLength: 12,
        pattern: "^[A-Za-z0-9]+$",
      },
      route: { type: "string", maxLength: 2000 },
      alternate: { type: "string", minLength: 4, maxLength: 4 },
      flightLevel: {
        oneOf: [
          { type: "integer", minimum: 0, maximum: 60000 },
          { type: "string", pattern: "^(?:FL)?\\d{2,5}$" },
        ],
      },
      registration: { type: "string", minLength: 1, maxLength: 16 },
      passengers: { type: "integer", minimum: 0, maximum: 1000 },
      cargo: { type: "number", minimum: 0, maximum: 9999 },
      captainName: { type: "string", minLength: 1, maxLength: 120 },
      dispatcherName: { type: "string", minLength: 1, maxLength: 120 },
      customRemarks: { type: "string", maxLength: 2000 },
      units: { type: "string", enum: ["KGS", "LBS"], default: "KGS" },
      planFormat: { type: "string", minLength: 1, maxLength: 32 },
      costIndex: {
        oneOf: [
          { type: "integer", minimum: 0, maximum: 999 },
          { type: "string", enum: ["AUTO"] },
        ],
      },
      taxiOutMinutes: { type: "integer", minimum: 0, maximum: 180 },
      taxiInMinutes: { type: "integer", minimum: 0, maximum: 180 },
      reserveMinutes: { type: "integer", minimum: 0, maximum: 600 },
      navlog: { type: "boolean" },
      etops: { type: "boolean" },
      stepClimbs: { type: "boolean" },
      runwayAnalysis: { type: "boolean" },
      notams: { type: "boolean" },
      firNotams: { type: "boolean" },
      omitSids: { type: "boolean" },
      omitStars: { type: "boolean" },
      maps: { type: "string", enum: ["detail", "simple", "none"] },
      sidStarPreference: { type: "string", enum: ["R", "C"] },
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
  FlightDetailResponse: {
    type: "object",
    required: ["flight", "release", "releaseRevisions", "events"],
    properties: {
      flight: schemaRef("Flight"),
      release: { allOf: [schemaRef("DispatchRelease")], nullable: true },
      releaseRevisions: {
        type: "array",
        items: schemaRef("DispatchRelease"),
      },
      events: {
        type: "array",
        items: schemaRef("FlightOperationalEvent"),
      },
    },
  },
  DispatchReleaseResponse: {
    type: "object",
    required: ["flight", "release"],
    properties: {
      flight: schemaRef("Flight"),
      release: schemaRef("DispatchRelease"),
    },
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
  SimbriefConnectionResponse: {
    type: "object",
    required: ["connection"],
    properties: { connection: schemaRef("SimbriefConnection") },
  },
  NavigraphOauthStartResponse: {
    type: "object",
    required: ["authorizationUrl", "redirectUri", "expiresAt"],
    properties: {
      authorizationUrl: {
        type: "string",
        format: "uri",
        description:
          "One-time Navigraph Authorization Code URL with S256 PKCE. Open it in the user's browser before expiresAt.",
      },
      redirectUri: {
        type: "string",
        format: "uri",
        example:
          "https://www.va-dispatcher.world/api/v1/simbrief/oauth/callback",
      },
      expiresAt: schemaRef("DateTime"),
    },
  },
  SimbriefDispatchResponse: {
    type: "object",
    required: ["dispatch"],
    properties: { dispatch: schemaRef("SimbriefDispatch") },
  },
  CreateSimbriefDispatchResponse: {
    type: "object",
    required: ["dispatch", "dispatchUrl"],
    properties: {
      dispatch: schemaRef("SimbriefDispatch"),
      dispatchUrl: {
        type: "string",
        format: "uri",
        description:
          "Signed SimBrief Dispatch Redirect URL. Open it directly in the user's browser; do not proxy it through the API.",
      },
    },
  },
  SimbriefCallbackResponse: {
    type: "object",
    required: ["dispatch"],
    properties: { dispatch: schemaRef("SimbriefCallbackDispatch") },
  },
  DispatchBoardResponse: {
    type: "object",
    required: ["flights", "metrics", "scheduleRequestCounts"],
    properties: {
      flights: { type: "array", items: schemaRef("DispatchFlight") },
      metrics: {
        type: "object",
        required: [
          "window",
          "activeFlights",
          "onTimePerformance",
          "scheduledVsFinished",
        ],
        properties: {
          window: {
            type: "object",
            required: ["from", "toExclusive", "label"],
            properties: {
              from: schemaRef("DateTime"),
              toExclusive: schemaRef("DateTime"),
              label: { type: "string" },
            },
          },
          activeFlights: {
            type: "object",
            required: ["value", "definition"],
            properties: {
              value: { type: "integer", minimum: 0 },
              definition: { type: "string" },
            },
          },
          onTimePerformance: {
            type: "object",
            required: ["value", "onTime", "tracked", "eligible", "definition"],
            properties: {
              value: {
                type: "number",
                minimum: 0,
                maximum: 1,
                nullable: true,
              },
              onTime: { type: "integer", minimum: 0 },
              tracked: { type: "integer", minimum: 0 },
              eligible: { type: "integer", minimum: 0 },
              definition: { type: "string" },
            },
          },
          scheduledVsFinished: {
            type: "object",
            required: ["scheduled", "finished", "value", "definition"],
            properties: {
              scheduled: { type: "integer", minimum: 0 },
              finished: { type: "integer", minimum: 0 },
              value: {
                type: "number",
                minimum: 0,
                maximum: 1,
                nullable: true,
              },
              definition: { type: "string" },
            },
          },
        },
      },
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
    "A configured upstream provider rejected or failed the request.",
    schemaRef("ErrorResponse"),
  ),
  TooManyRequests: jsonResponse(
    "The upstream provider is rate-limiting requests.",
    schemaRef("ErrorResponse"),
  ),
  GatewayTimeout: jsonResponse(
    "The upstream provider did not respond before the timeout.",
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
      "Multi-tenant REST API for Virtual Airline scheduling, live dispatch, flights, SimBrief flight planning, membership administration, and ACARS messaging. All tenant data is resolved from the authenticated Clerk organization; clients never supply a tenant ID.",
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
    {
      name: "SimBrief",
      description:
        "Navigraph account linking and tenant-scoped SimBrief flight-plan dispatches.",
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
    "/public/tenants/{slug}": {
      get: {
        tags: ["Tenant"],
        operationId: "getPublicTenantBrand",
        summary: "Get public tenant identity",
        description:
          "Returns only the name and visual identity needed before sign-in.",
        security: [],
        parameters: [
          {
            name: "slug",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": jsonResponse(
            "Public tenant identity.",
            schemaRef("PublicTenantResponse"),
          ),
          "404": responseRef("NotFound"),
          "500": responseRef("InternalError"),
          "503": responseRef("ServiceUnavailable"),
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
    "/tenant/brand": {
      patch: {
        tags: ["Tenant"],
        operationId: "updateTenantBrand",
        summary: "Update the derived tenant theme",
        description:
          "Requires admin. The server stores one seed color and one presence level; clients derive all supporting tones.",
        "x-required-role": "admin",
        requestBody: jsonRequest(schemaRef("UpdateTenantBrandInput")),
        responses: {
          "200": jsonResponse(
            "Updated tenant identity.",
            schemaRef("TenantBrandResponse"),
          ),
          ...resourceErrors,
          "422": responseRef("UnprocessableEntity"),
        },
      },
    },
    "/tenant/brand/logo": {
      post: {
        tags: ["Tenant"],
        operationId: "uploadTenantLogo",
        summary: "Upload the tenant square logo",
        description:
          "Requires admin. Accepts one PNG, JPEG, or WebP logo up to 1 MB and replaces the previous Vercel Blob asset.",
        "x-required-role": "admin",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["logo"],
                properties: {
                  logo: { type: "string", format: "binary" },
                },
              },
            },
          },
        },
        responses: {
          "201": jsonResponse(
            "Updated tenant identity.",
            schemaRef("TenantBrandResponse"),
          ),
          ...acarsMutationErrors,
          "502": responseRef("UpstreamError"),
        },
      },
      delete: {
        tags: ["Tenant"],
        operationId: "clearTenantLogo",
        summary: "Remove the uploaded tenant logo",
        description:
          "Requires admin. The generated initials fallback becomes active.",
        "x-required-role": "admin",
        responses: {
          "200": jsonResponse(
            "Updated tenant identity.",
            schemaRef("TenantBrandResponse"),
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
        description:
          "Requires the dispatcher role or higher. ETA must be later than ETD; the selected pilot must be active in this tenant.",
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
          "200": jsonResponse(
            "Flight, current release, immutable release revisions, and progress events.",
            schemaRef("FlightDetailResponse"),
          ),
          ...resourceErrors,
        },
      },
      patch: {
        tags: ["Flights"],
        operationId: "updateFlight",
        summary: "Update a flight",
        description:
          "Requires dispatcher. Aircraft type is immutable. Pilot or time changes create a new assignment revision; expectedUpdatedAt prevents lost concurrent edits.",
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
        description:
          "Requires dispatcher. Active and completed are audited fallback transitions; a flight becomes Scheduled only by publishing a complete release.",
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
    "/simbrief/oauth/callback": {
      get: {
        tags: ["SimBrief"],
        operationId: "completeNavigraphOauth",
        summary: "Complete Navigraph account authorization",
        description:
          "Public Authorization Code callback registered with Navigraph. Exactly one of code or error must be supplied with the one-time state. The server consumes the state, exchanges the code with S256 PKCE, and stores only the stable account identity.",
        security: [],
        parameters: [
          requiredQueryParameter(
            "state",
            "One-time OAuth state returned by Navigraph.",
            {
              type: "string",
              pattern: "^v1\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}$",
            },
          ),
          queryParameter(
            "code",
            "Authorization code returned after consent. Mutually exclusive with error.",
            { type: "string", minLength: 1, maxLength: 4096 },
          ),
          queryParameter(
            "error",
            "OAuth error returned when authorization is denied. Mutually exclusive with code.",
            {
              type: "string",
              pattern: "^[A-Za-z0-9_]{1,64}$",
            },
          ),
        ],
        responses: {
          "200": jsonResponse(
            "Connected Navigraph identity and SimBrief account state.",
            schemaRef("SimbriefConnectionResponse"),
          ),
          "400": responseRef("BadRequest"),
          "401": responseRef("Unauthorized"),
          "409": responseRef("Conflict"),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("InternalError"),
          "502": responseRef("UpstreamError"),
          "503": responseRef("ServiceUnavailable"),
          "504": responseRef("GatewayTimeout"),
        },
      },
    },
    "/simbrief/callback": {
      get: {
        tags: ["SimBrief"],
        operationId: "completeSimbriefDispatch",
        summary: "Complete a SimBrief dispatch redirect",
        description:
          "Public, one-time callback reached after SimBrief generation. The server verifies the callback token, fetches the OFP by static ID, checks its pilot and route identifiers, and stores the result.",
        security: [],
        parameters: [
          requiredQueryParameter(
            "dispatchId",
            "Pending SimBrief dispatch ID.",
            schemaRef("Uuid"),
          ),
          requiredQueryParameter(
            "token",
            "One-time callback token embedded in the signed Dispatch Redirect URL.",
            {
              type: "string",
              pattern: "^[A-Za-z0-9_-]{43}$",
            },
          ),
        ],
        responses: {
          "200": jsonResponse(
            "Completed dispatch summary.",
            schemaRef("SimbriefCallbackResponse"),
          ),
          "400": responseRef("BadRequest"),
          "401": responseRef("Unauthorized"),
          "409": responseRef("Conflict"),
          "429": responseRef("TooManyRequests"),
          "500": responseRef("InternalError"),
          "502": responseRef("UpstreamError"),
          "504": responseRef("GatewayTimeout"),
        },
      },
    },
    "/simbrief/connection": {
      get: {
        tags: ["SimBrief"],
        operationId: "getSimbriefConnection",
        summary: "Get the current member's SimBrief connection",
        description:
          "Reports the separate numeric SimBrief Pilot ID and Navigraph OAuth identity states without exposing the Navigraph subject or any OAuth token.",
        responses: {
          "200": jsonResponse(
            "Current connection state.",
            schemaRef("SimbriefConnectionResponse"),
          ),
          ...resourceErrors,
        },
      },
      put: {
        tags: ["SimBrief"],
        operationId: "connectSimbriefPilotId",
        summary: "Connect a numeric SimBrief Pilot ID",
        description:
          "Stores the member's numeric SimBrief Pilot ID. The ID becomes verified only after a generated OFP returns with the same account identifier.",
        requestBody: jsonRequest(schemaRef("ConnectSimbriefInput")),
        responses: {
          "200": jsonResponse(
            "Updated connection state.",
            schemaRef("SimbriefConnectionResponse"),
          ),
          ...mutationErrors,
        },
      },
      delete: {
        tags: ["SimBrief"],
        operationId: "disconnectSimbriefAccount",
        summary: "Disconnect SimBrief and Navigraph account data",
        description:
          "Clears the current member's SimBrief Pilot ID, verification state, and Navigraph identity link. Existing flight-plan records remain subject to the configured retention policy.",
        responses: {
          "200": jsonResponse(
            "Disconnected connection state.",
            schemaRef("SimbriefConnectionResponse"),
          ),
          ...resourceErrors,
        },
      },
    },
    "/simbrief/oauth/start": {
      post: {
        tags: ["SimBrief"],
        operationId: "startNavigraphOauth",
        summary: "Start Navigraph account authorization",
        description:
          "Creates short-lived, single-use, server-authenticated OAuth state and an encrypted S256 PKCE verifier record. Open the returned authorizationUrl in the user's browser. Requires configured Navigraph credentials and TENANT_SECRETS_KEY.",
        responses: {
          "200": jsonResponse(
            "One-time Navigraph authorization URL.",
            schemaRef("NavigraphOauthStartResponse"),
          ),
          ...resourceErrors,
        },
      },
    },
    "/flights/{flightId}/simbrief/dispatches": {
      post: {
        tags: ["SimBrief"],
        operationId: "createSimbriefDispatch",
        summary: "Create a SimBrief flight-plan dispatch",
        description:
          "The assigned pilot may create a plan for their own flight; dispatchers and admins may create one for any tenant flight. The creator must have a connected numeric SimBrief Pilot ID. Open the returned signed dispatchUrl directly in a browser so SimBrief can authenticate the person generating the plan.",
        parameters: [pathParameter("flightId", "Flight ID.")],
        requestBody: optionalJsonRequest(
          schemaRef("CreateSimbriefDispatchInput"),
          "Optional SimBrief planning overrides. Omitted fields are derived from the flight or use SimBrief defaults.",
        ),
        responses: {
          "201": jsonResponse(
            "Created pending dispatch and signed browser URL.",
            schemaRef("CreateSimbriefDispatchResponse"),
          ),
          ...mutationErrors,
          "422": responseRef("UnprocessableEntity"),
        },
      },
    },
    "/flights/{flightId}/simbrief": {
      get: {
        tags: ["SimBrief"],
        operationId: "getLatestSimbriefDispatch",
        summary: "Get the latest SimBrief dispatch for a flight",
        description:
          "Returns the latest pending or ready dispatch and its stored OFP. Pilots can read their own assigned flight; dispatchers and admins can read any tenant flight.",
        parameters: [pathParameter("flightId", "Flight ID.")],
        responses: {
          "200": jsonResponse(
            "Latest SimBrief dispatch.",
            schemaRef("SimbriefDispatchResponse"),
          ),
          ...resourceErrors,
        },
      },
    },
    "/flights/{flightId}/simbrief/dispatches/{dispatchId}": {
      get: {
        tags: ["SimBrief"],
        operationId: "getSimbriefDispatch",
        summary: "Get a SimBrief dispatch",
        parameters: [
          pathParameter("flightId", "Flight ID."),
          pathParameter("dispatchId", "SimBrief dispatch ID."),
        ],
        responses: {
          "200": jsonResponse(
            "SimBrief dispatch detail.",
            schemaRef("SimbriefDispatchResponse"),
          ),
          ...resourceErrors,
        },
      },
    },
    "/flights/{flightId}/simbrief/dispatches/{dispatchId}/sync": {
      post: {
        tags: ["SimBrief"],
        operationId: "syncSimbriefDispatch",
        summary: "Retry fetching a generated SimBrief OFP",
        description:
          "Idempotently fetches and verifies the OFP when the browser callback was interrupted after generation.",
        parameters: [
          pathParameter("flightId", "Flight ID."),
          pathParameter("dispatchId", "SimBrief dispatch ID."),
        ],
        responses: {
          "200": jsonResponse(
            "Ready SimBrief dispatch, or the already stored result.",
            schemaRef("SimbriefDispatchResponse"),
          ),
          ...mutationErrors,
          "429": responseRef("TooManyRequests"),
          "502": responseRef("UpstreamError"),
          "504": responseRef("GatewayTimeout"),
        },
      },
    },
    "/flights/{id}/confirm-assignment": {
      post: {
        tags: ["Flights"],
        operationId: "confirmFlightAssignment",
        summary: "Confirm the current assignment revision",
        description:
          "Only the assigned pilot can confirm the current revision.",
        parameters: [pathParameter("id", "Flight ID.")],
        responses: {
          "200": jsonResponse(
            "Confirmed assignment.",
            schemaRef("FlightResponse"),
          ),
          ...mutationErrors,
        },
      },
    },
    "/flights/{id}/release": {
      post: {
        tags: ["Flights"],
        operationId: "publishDispatchRelease",
        summary: "Publish an immutable dispatch release revision",
        description:
          "Requires dispatcher. Fetches and stores a live AviationWeather.gov snapshot. The initial release moves Accepted to Scheduled (stored internally as briefed).",
        "x-required-role": "dispatcher",
        parameters: [pathParameter("id", "Flight ID.")],
        requestBody: jsonRequest(schemaRef("DispatchReleaseInput")),
        responses: {
          "200": jsonResponse(
            "Published release and current flight.",
            schemaRef("DispatchReleaseResponse"),
          ),
          ...acarsMutationErrors,
        },
      },
    },
    "/flights/{id}/start": {
      post: {
        tags: ["Flights"],
        operationId: "startFlight",
        summary: "Record a web flight start",
        description:
          "The assigned pilot may start a scheduled flight; dispatchers retain an audited fallback. Pilot start confirms the current assignment revision.",
        parameters: [pathParameter("id", "Flight ID.")],
        responses: {
          "200": jsonResponse("Active flight.", schemaRef("FlightResponse")),
          ...mutationErrors,
        },
      },
    },
    "/flights/{id}/finish": {
      post: {
        tags: ["Flights"],
        operationId: "finishFlight",
        summary: "Record a web flight finish",
        description:
          "The assigned pilot may finish an active flight; dispatchers retain an audited fallback.",
        parameters: [pathParameter("id", "Flight ID.")],
        responses: {
          "200": jsonResponse("Finished flight.", schemaRef("FlightResponse")),
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
