# VA Dispatch UI Elevation — Implementation Brief

Elevate VA Dispatch into a modern, professional, multi-tenant airline operations product. Use the [selected visual direction](/Users/fzwork/.codex/generated_images/019ff5de-a35a-7c22-b7f2-f20e8275df95/exec-a9b46587-2081-435f-b392-03157b038da0.png) as the primary reference.

## Visual direction

- Adopt the selected rectilinear, typography-led operations-dashboard style.
- Keep the interface light-first; do not add dark mode in this scope.
- Avoid large radii, pill-shaped navigation, playful visuals, and "rounded boxes inside rounded boxes."
- Prefer crisp dividers, structured whitespace, strong data typography, square or nearly square controls, and flat status lanes.
- Make the product distinctive through airline identity, typographic hierarchy, operational data, and subtle wayfinding motifs—not decorative clutter.
- Animation should be restrained and functional: state changes, hover and focus feedback, board updates, and directional movement. Respect reduced-motion preferences.
- Apply the elevation across the whole tenant journey: authentication, dispatcher workspace, pilot portal, settings, forms, dialogs, empty, loading, and error states, and responsive navigation.
- The reference image supplies the visual composition, not a requirement to add its invented navigation items or placeholder data.

## Effortless airline branding

Every Virtual Airline must be able to individualize the application with almost no setup:

- The only required image is one square organization logo. Reuse an existing organization or Clerk logo when available, or let the admin upload it once in organization settings.
- The admin selects one seed brand color.
- Add one simple **Brand presence** choice with three previews: **Restrained**, **Balanced**, and **High visibility**; default to **Balanced**.
- Everything else must be intelligently derived: complementary tones, backgrounds, selection treatments, focus appearance, identity rail, subtle motif strength, and fallback organization initials.
- Do not ask admins for separate wordmarks, compact marks, hero artwork, multiple theme colors, or complex design configuration.
- Branding configuration belongs in VA Dispatch organization settings and must include an immediate realistic preview.

## Dispatcher operations board

Make the selected Kanban-style board the central dispatcher planning workspace. It should show assigned flights by operational status:

- `Accepted` is presented as **To schedule**.
- `Briefed` is presented as **Scheduled**, meaning the dispatch release and flight plan are complete and ready.
- `Active` contains flights currently being operated.
- `Completed` is presented as **Finished**.
- `Offered` is deliberately not a board column; offers remain in the existing offer and flight-management workflow until accepted.

The board must optimize fast scanning and planning:

- Sort and present flights clearly by operational time.
- Each flight card shows the route, flight number, times, aircraft, assigned pilot, status, and confirmation warnings.
- A modify action at the top-left of the card opens quick editing.
- Pilot assignment uses a searchable selector.
- Dispatchers can modify assignment, scheduled time, flight number, route, and related planning information from the card workspace.
- Aircraft type becomes immutable after the flight is created.
- Non-time edits leave a Scheduled flight scheduled.
- Changing the scheduled time requires the pilot to accept the revised assignment again.
- Reassigning the pilot also creates a pending confirmation.
- Pending confirmation does not remove the flight from its current lane or block starting it, but the card must be visibly and unmistakably highlighted.
- The dispatcher must receive a clear warning before making a change that requires pilot reconfirmation.
- The pilot can confirm the current assignment in VA Dispatch. If they start without doing so, the Hoppie or flight-init interaction should communicate the current assignment and release.

An Active card must provide a direct action for opening the ACARS conversation with that flight's assigned pilot.

## Dispatch release and flight plan

**Scheduled** requires a complete in-app dispatch release, not merely a manually selected status. It should cover:

- Operational route
- SID and STAR
- Cruise level
- Alternate
- Detailed fuel breakdown
- Fuel and payload units
- Planned payload
- Live weather information and briefing context
- Release notes and dispatcher remarks
- Clear release readiness and revision information

Pilots must be able to review the current release. Changes must remain visible and auditable, especially when they affect pilot confirmation.

## Flight tracking and ACARS

Use layered status tracking:

- Automatically interpret supported Hoppie and aircraft progress interactions when they can be matched safely to the assigned flight.
- Provide pilot-facing web controls as a fallback.
- Retain explicit, audited dispatcher controls when automation is unavailable or incorrect.
- Investigate the actual behavior of FlyByWire A32NX, Fenix A320, and Hoppie before deciding what `FLT INIT` represents.
- If the relevant Hoppie implementation really transmits a usable `FLT INIT`, receiving it should confirm the current assignment and activate the flight immediately.
- Otherwise, do not build critical behavior around `FLT INIT`; use the other progress events and manual fallbacks.
- Finished status should likewise be derived from supported completion or progress interaction when possible, with pilot and dispatcher fallbacks.
- Never present a sent Hoppie message as a guaranteed delivery or read confirmation.

## Operational KPIs

The dashboard KPI strip should contain:

- **Active flights** — live current count.
- **On-time performance** — based on actual tracked departure information, not manual status changes or placeholder data.
- **Scheduled vs Finished** — month-to-date progress for the current UTC calendar month.

All definitions must be visible to users and based on real data. Missing tracking coverage should be disclosed rather than silently counted as late or on time.

## Product outcome

The finished application should feel like a dedicated airline operations tool rather than a generic SaaS template. A dispatcher should be able to understand the operation, schedule flights, edit assignments, recognize pending pilot confirmation, open ACARS, and monitor monthly progress from one coherent workspace. Pilots should receive a consistent branded experience, review complete dispatch releases, confirm changes, and drive flight progress through supported web or ACARS interactions.
