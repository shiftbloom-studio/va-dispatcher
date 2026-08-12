# Product and Role Guide

VA Dispatch separates the flying workflow from the dispatch workflow while keeping both inside one Virtual Airline tenant. Roles are hierarchical:

```text
pilot < dispatcher < admin
```

A dispatcher can use dispatcher-protected API operations; an administrator can use both dispatcher and administrator operations. The web application routes a pilot to the portal and a dispatcher or administrator to the dispatcher suite.

## Signing in

The application is tenant-addressed. vSAS uses `/vsas`, including:

- `/vsas/sign-in`
- `/vsas/sign-up`
- `/vsas/tasks/*` for Clerk session tasks
- `/vsas/portal` for pilots
- `/vsas/dispatch` for dispatchers and administrators
- `/vsas/settings` for every active member

The active Clerk organization must have the same slug as the URL. The application also verifies that the organization maps to the same database tenant before it reads operational data. If they do not agree, the user sees an organization-mismatch screen rather than data from another tenant.

## Pilot workflow

### 1. Complete personal settings

Open **My settings** and save:

- an optional display name; and
- the aircraft callsign used by the pilot's Hoppie-capable simulator client;
- the pilot's own verified SimBrief identity and optional Navigraph connection;
  and
- one or more revocable simulator-device credentials for the MSFS client.

The personal Hoppie logon code stays in the simulator client. VA Dispatch never asks pilots or flying dispatchers to store that personal credential in the website.

### 2. Request a schedule

Open **Request schedule** and enter:

- the desired number of flights, from 1 to 50;
- one or more non-overlapping availability intervals;
- an optional title; and
- optional route, aircraft, or other notes.

Every date and time is interpreted as UTC. The detailed intervals are stored in `preferences.availability`; the earliest start and latest end are also stored as the request's overall window.

### 3. Follow the request

The pilot dashboard separates active requests from recent history. An owned
pending request can be edited until dispatch starts review. A partially
fulfilled request stays active for later batches. Cancellation asks whether to
preserve linked flights or cancel eligible pre-departure work.

### 4. Respond to a flight offer

An assigned pilot can:

- accept an `offered` flight;
- decline it, optionally with a reason; or
- cancel their own accepted or briefed flight.

After accepting, the pilot can review the immutable dispatch release, generate
a dispatcher-prepared SimBrief plan through their own account, recover from the
provider callback, and view the OFP. Active flights have a dedicated dashboard
group. Cancellation and operational completion after activation are dispatcher
actions.

## Dispatcher workflow

The dispatcher suite has four work areas.

### Operations

The operations board separates overdue, accepted, briefed, active, and current-
month completed operations. Accepted/briefed rows use a 24-hour overdue through
seven-day upcoming window; active rows remain visible regardless of ETD. It
refreshes every 10 seconds while visible.

Pilot-presence metrics show trusted online, airborne, and stale simulator
receipts. Flight telemetry and OOOI cards provide operational awareness.

### Requests

Dispatchers can:

- filter the request queue by status;
- move a pending request into review;
- inspect all detailed availability intervals and notes;
- reject or cancel an eligible request; and
- choose a partial or complete atomic batch up to remaining capacity; and
- return later to append another batch to a partially fulfilled request.

### Flights

Dispatchers can create a draft or offered ad-hoc flight, filter all flights by
status, version-edit eligible records, publish revisioned dispatch releases,
prepare SimBrief generation, safely replace declined work, correct OOOI, and
apply valid state transitions. Material edits require a reason and reset stale
acceptance/planning state.

### ACARS

Dispatchers can:

- browse the 50 newest inbound and outbound messages;
- group a conversation by remote station;
- send a free-text telex;
- optionally link an outbound telex to a flight; and
- use the inbound simulator when the local mock provider is active.

Production messages use the tenant's shared Hoppie ground station. The UI refreshes stored messages every 10 seconds, while the server normally polls Hoppie once per minute.

## Administrator workflow

An administrator has every dispatcher capability and can open **Organization settings** to manage the shared Hoppie ground station:

1. Enter a ground-station callsign.
2. Enter a separate Virtual Airline Hoppie logon code.
3. Test the credential against Hoppie's `ping` operation.
4. Save it only after the test succeeds.
5. Re-test or remove the stored credential later.

The logon is encrypted before storage and is never returned to the browser. Removing it leaves ACARS unconfigured; production never falls back to the mock adapter.

The admin control plane searches members, updates role/status, synchronizes the
complete Clerk directory, safely reassigns eligible work, and exposes a
redacted audit viewer/export. Privacy operations cover approved retention runs,
subject requests, holds, and external-provider tasks.

## Role and capability matrix

| Capability                                       | Pilot | Dispatcher | Admin |
| ------------------------------------------------ | :---: | :--------: | :---: |
| View or edit own profile and callsign            |  Yes  |    Yes     |  Yes  |
| Manage own SimBrief/Navigraph/device links       |  Yes  |    Yes     |  Yes  |
| Create and view own schedule requests            |  Yes  |     —      |   —   |
| Accept or decline own assigned offers            |  Yes  |     —      |   —   |
| Generate prepared SimBrief plan and view OFP     |  Yes  |     —      |   —   |
| View all tenant requests and flights             |   —   |    Yes     |  Yes  |
| Review, reject, or fulfill requests              |   —   |    Yes     |  Yes  |
| Create, plan, edit, monitor, and advance flights |   —   |    Yes     |  Yes  |
| Use dispatcher ACARS workspace                   |   —   |    Yes     |  Yes  |
| List tenant members                              |   —   |    Yes     |  Yes  |
| Synchronize Clerk members                        |   —   |    Yes     |  Yes  |
| Change member roles/status and audit access      |   —   |     —      |  Yes  |
| Operate privacy lifecycle workflows              |   —   |     —      |  Yes  |
| Configure organization Hoppie credentials        |   —   |     —      |  Yes  |

## Operational language

| Term              | Meaning in this application                                                            |
| ----------------- | -------------------------------------------------------------------------------------- |
| Tenant            | One Virtual Airline and its isolated records                                           |
| Membership        | A Clerk user within one tenant, with role, status, display name, and optional callsign |
| Schedule request  | A pilot's requested count, UTC availability, preferences, and review status            |
| Flight            | The canonical offered or operational flight record                                     |
| Ground station    | The tenant-level Hoppie sender and polling callsign                                    |
| Personal callsign | A member's aircraft/simulator callsign, not a stored personal Hoppie credential        |
| ACARS acceptance  | Hoppie accepted a message for store-and-forward; not proof of delivery or reading      |

Next: [Scheduling and Dispatch](https://github.com/shiftbloom-studio/va-dispatcher/wiki/Scheduling-and-Dispatch), [Flights and State Machines](https://github.com/shiftbloom-studio/va-dispatcher/wiki/Flights-and-State-Machines), and [ACARS and Hoppie](https://github.com/shiftbloom-studio/va-dispatcher/wiki/ACARS-and-Hoppie).
