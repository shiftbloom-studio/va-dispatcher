# Architecture

VA Dispatch is a TypeScript pnpm monorepo with two deployable applications and one shared lint package.

```text
apps/
├── api/                  Hono REST API, domain services, Drizzle repositories
└── web/                  Next.js App Router user interface
packages/
└── eslint-config/        Shared Next.js ESLint configuration
docs/                     Operational, privacy, and maintainer documents
wiki/                     Reviewable source mirror of this GitHub Wiki
vercel.ts                 Multi-service deployment and ACARS cron
```

## Runtime topology

```mermaid
flowchart TB
    subgraph Browser
      UI["Next.js client components"]
      CK["Clerk session cookies"]
      BT["BotID browser proof"]
      PP["Local privacy preference"]
    end

    subgraph Vercel
      WEB["web service<br/>Next.js 16 App Router"]
      API["api service<br/>Hono /api/v1"]
      CRON["ACARS + privacy<br/>authenticated crons"]
    end

    CLERK["Clerk organizations"]
    DB["Neon PostgreSQL"]
    HOPPIE["Hoppie's ACARS"]
    SIMBRIEF["SimBrief / Navigraph"]
    MSFS["MSFS client<br/>device token"]

    UI --> WEB
    CK --> WEB
    BT --> API
    WEB -->|"server identity calls"| API
    UI -->|"same-origin typed JSON"| API
    WEB --> CLERK
    API --> CLERK
    API --> DB
    API --> HOPPIE
    API --> SIMBRIEF
    MSFS --> API
    CRON --> API
    PP -. "gates optional telemetry" .-> WEB
```

`vercel.ts` routes `/api/*` to the API service and all other requests to the web service. It injects the API service URL into the web service as `API_INTERNAL_URL`. A two-project deployment is also supported by setting `API_ORIGIN` on the web project; the Next.js rewrite preserves same-origin browser calls.

## Web application layers

### Route and identity layer

The Next.js App Router uses a tenant segment at `/:slug`.

- The root layout owns public privacy controls and optional telemetry.
- The tenant layout configures Clerk's sign-in, sign-up, fallback, and task routes inside the current slug.
- The protected layout rejects unknown slugs, resolves identity, checks tenant agreement, and renders the shared application shell.
- Portal and dispatch layouts enforce the role-specific user experience.

`getServerIdentity()` performs the important three-way agreement:

1. URL tenant slug;
2. active Clerk organization slug; and
3. tenant returned by authenticated API calls.

No business data is requested until those values agree.

### Client data layer

Client components use TanStack Query for fetch state, caching, invalidation, and polling. `useApi()` obtains the current Clerk token and calls same-origin `/api/v1/*`. Every consumed response is parsed through a Zod schema in `apps/web/src/lib/api/schemas.ts`.

This means a successful HTTP response with a drifted shape fails as `INVALID_RESPONSE` rather than being trusted by the UI.

### Forms and UTC handling

React Hook Form and Zod validate schedule and flight forms. `datetime-local` values are deliberately interpreted as UTC rather than the browser's local timezone. Keep conversions inside `apps/web/src/lib/utc.ts`; do not use implicit `Date` parsing in forms.

## API application layers

```mermaid
flowchart LR
    R["Hono routes<br/>HTTP and Zod"] --> S["Domain services<br/>authorization and workflows"]
    S --> P["Repositories<br/>tenant-scoped Drizzle queries"]
    P --> D["Neon PostgreSQL"]
    S --> A["ACARS provider interface"]
    A --> H["Hoppie or local mock"]
    S --> AU["Audit repository"]
```

### Middleware order

At the application level:

1. A request ID is accepted or generated and returned as `X-Request-Id`.
2. Security headers and configured CORS are applied.
3. Errors are normalized into the public JSON envelope.
4. Public docs and health routes are mounted.
5. Secret-authenticated internal routes are mounted before business middleware.
6. BotID protects browser mutations under the versioned business API.
7. Each route group authenticates with Clerk and applies role requirements.

### Route layer

Routes define method, path, Zod input contract, role middleware, response serialization, and status code. The versioned business API is mounted at both `/api/v1` and `/v1` because a service rewrite may strip the `/api` prefix.

### Domain layer

Domain services own workflow checks that do not belong in transport or SQL code:

- role checks;
- record ownership;
- schedule and flight state transitions;
- audit events;
- provider error translation; and
- cross-entity validation such as assignment eligibility, availability,
  planning revision, and linked-flight tenant coherence.

### Repository layer

Repositories create tenant-scoped Drizzle queries and atomic mutation/audit
statements. Tenant scoping is part of the repository or service call, not a UI
filter. General lists seek by `{sortAt, id}`; flight lists use a strict versioned
`{etd, id}` contract. All cursors are opaque to clients.

### Provider layer

The ACARS provider interface has Hoppie and DB-backed mock implementations. Production selection is fail-closed: it always resolves to Hoppie regardless of a stale `ACARS_PROVIDER=mock` value.

## Data and consistency model

The schema lives in `apps/api/src/db/schema.ts`. All operational tables carry `tenant_id`, and repository calls receive a tenant identifier from authenticated context.

The application uses the Neon HTTP driver and does not maintain a persistent
connection pool, supporting scale-to-zero operation. `schema.ts` is canonical
while this Shiftbloom project is pre-production. Deployments create an empty
database and apply it with `db:push`; the command must never target data that
needs preserving. See [Data Model](https://github.com/shiftbloom-studio/va-dispatcher/wiki/Data-Model).

## Security boundaries

- **Identity boundary:** Clerk JWT and active organization claims.
- **Tenant boundary:** Clerk organization maps to exactly one database tenant; all reads and mutations scope by it.
- **Authorization boundary:** role hierarchy plus resource ownership checks.
- **Automation boundary:** BotID for browser mutations and `CRON_SECRET` for internal jobs.
- **Secret boundary:** tenant Hoppie logons encrypted with AES-256-GCM using `TENANT_SECRETS_KEY`.
- **Contract boundary:** Zod at API input and web response consumption.
- **Privacy boundary:** optional analytics is off until affirmative browser consent; legal pages are public and Clerk-free.

## Design decisions

### Path-based tenancy

The URL exposes the active Virtual Airline and lets branding, Clerk organization selection, and backend tenant identity be checked together. The backend is tenant-capable, but the current static web tenant registry contains only vSAS.

### Scale to zero

Neon HTTP, Vercel functions, and Clerk avoid an always-on application server. No Redis or external queue is required for the current workload. The one-minute Hoppie cron is the only regular production wake-up.

### Explicit state machines

Flights and schedule requests cannot jump arbitrarily between statuses. UI action matrices mirror backend transition tables. When adding a state, update schema enums, backend transitions and routes, serializers, frontend schemas, action matrices, views, OpenAPI, tests, and Wiki diagrams together.

### Record uncertain provider outcomes

Outbound Hoppie rows are reserved before provider I/O and end as accepted,
rejected, ambiguous, or visibly pending. Uncertain sends are never retried
automatically. Inbound replay protection is bounded so a legitimate repeated
message can be stored later.

## Canonical code map

| Concern                  | Primary location                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| Database schema          | `apps/api/src/db/schema.ts`                                                                      |
| Authentication and roles | `apps/api/src/middleware/auth.ts`, `apps/api/src/domain/members/roles.ts`                        |
| BotID policy             | `apps/api/src/middleware/botid.ts`, `apps/web/src/instrumentation-client.ts`                     |
| Schedule workflows       | `apps/api/src/domain/schedule-requests/`                                                         |
| Flight workflows         | `apps/api/src/domain/flights/`                                                                   |
| Dispatch releases        | `apps/api/src/db/repositories/dispatch-releases.ts`                                              |
| SimBrief/Navigraph       | `apps/api/src/domain/simbrief/`, `apps/api/src/db/repositories/simbrief.ts`                      |
| Simulator telemetry      | `apps/api/src/domain/telemetry/`, `apps/api/src/db/repositories/telemetry.ts`                    |
| Hoppie/provider behavior | `apps/api/src/acars/`, `apps/api/src/domain/acars/`                                              |
| Admin and audit          | `apps/api/src/domain/members/`, `apps/api/src/domain/audit/`                                     |
| Privacy lifecycle        | `apps/api/src/domain/privacy/`, `apps/api/src/db/repositories/privacy.ts`                        |
| HTTP contracts           | `apps/api/src/routes/`, `apps/api/src/docs/openapi.ts`                                           |
| Web response contracts   | `apps/web/src/lib/api/schemas.ts`                                                                |
| Tenant identity          | `apps/web/src/lib/server-identity.ts`                                                            |
| Legal/privacy controls   | `apps/web/src/lib/legal.ts`, `apps/web/src/lib/privacy-storage.ts`, `docs/privacy-compliance.md` |
| Deployment topology      | `vercel.ts`, `apps/web/next.config.ts`                                                           |
