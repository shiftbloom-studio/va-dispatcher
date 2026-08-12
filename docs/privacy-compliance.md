# Privacy and cookie compliance checklist

This repository provides a privacy-by-default technical baseline. It does not
by itself certify GDPR/DSGVO compliance. The legal controller remains
responsible for validating the notice, lawful bases, contracts, retention, and
operating procedures for the actual deployment with qualified counsel.

## Before production

1. Set every required `LEGAL_*` variable listed in
   `apps/web/.env.example`. Use the controller's real legal identity and a
   serviceable postal address. Production legal pages intentionally fail when
   required values are absent.
2. Determine whether representative, register, VAT ID, phone, or editorial
   responsibility details apply and configure them. The optional operator
   description can state the operator's capacity without replacing the legal
   name. Register name/number and editorially responsible name/address must be
   configured as complete pairs. Do not publish empty or fabricated entries.
3. Review `/impressum` and `/privacy` against the controller's legal form,
   audience, membership terms, and processing records.
4. Name the controller's competent data-protection supervisory authority and
   provide its official HTTPS URL.
5. Confirm that all public domains use HTTPS. Check the HSTS decision before
   adding subdomains or preload.

## Data inventory in this application

| System                | Personal or linkable data                                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clerk                 | User and organization identifiers, login identifier/email, name, authentication/session events, IP/device data                                                   |
| `memberships`         | Clerk user ID, role, display name, pilot callsign, optional SimBrief Pilot ID, Navigraph subject/username, connection and verification times, status, timestamps |
| `schedule_requests`   | Availability windows, preferences, titles/notes, status, rejection reason, timestamps                                                                            |
| `flights`             | Pilot assignment, route and schedule, dispatcher notes, state/reasons, OOOI timestamps                                                                           |
| OAuth transactions    | Short-lived random state lookup ID, encrypted PKCE verifier, member/tenant link, expiry and consumption times                                                    |
| `simbrief_dispatches` | Flight, initiating member, SimBrief Pilot/static/request IDs, dispatch options, generated OFP, errors, timestamps                                                |
| `acars_messages`      | Station identifiers, free-text messages, provider metadata, actor, timestamps                                                                                    |
| `audit_events`        | Actor, action, entity identifiers, metadata, timestamp                                                                                                           |
| Infrastructure        | Request IDs, IP address and HTTP/security logs held by hosting and authentication providers                                                                      |
| Vercel telemetry      | Consent-gated aggregated routes, referrers, coarse location/device categories and Web Vitals; essential BotID challenge and security signals                     |

Free-text fields can contain personal data even when the schema does not ask
for it. Train dispatchers and members not to enter sensitive or unrelated data.

## Processor and transfer controls

- Execute and retain the current data-processing agreements for Clerk, Vercel,
  and Neon. Record their subprocessors, processing locations, deletion terms,
  and incident-notification channels.
- Select EEA deployment/database regions where the contracted product supports
  them. Document any transfer outside the EEA, its adequacy decision or
  Standard Contractual Clauses, and the transfer-impact assessment and
  supplementary measures where required.
- Subscribe to provider subprocessor-change notices and review changes.
- Treat Hoppie's ACARS as an optional external network, not a confidential
  processor. Approve it before configuring a tenant ground station. Hoppie states
  that messages can be visible to others and remain in its queue for 24 hours.
  Never transmit personal, confidential, authentication, or special-category
  data through ACARS.
- Before enabling SimBrief, add Navigraph/SimBrief to the processing records
  and privacy notice. OAuth sends the user to Navigraph and stores the returned
  account subject, preferred username, and connection time; OAuth access,
  refresh, and ID tokens are not retained. Dispatch sends the member's SimBrief
  Pilot ID, flight details, optional names/remarks, and planning options to
  SimBrief and stores the returned OFP. Confirm the applicable terms,
  processing role, retention, transfer mechanism, and user notice. The
  application must never collect a SimBrief/Navigraph password or browser
  session.

## Retention and data-subject requests

The privacy notice uses retention criteria because this repository cannot
choose the controller's legally appropriate periods. Before launch, approve a
written schedule for accounts, operational history, SimBrief dispatches/OFPs,
ACARS copies, audit events, HTTP/security logs, and backups. Configure provider
retention and implement a tested recurring deletion or anonymization process
for each store.

Document and test a request workflow that can:

- verify the requester without collecting excessive new data;
- export the records listed in the inventory above;
- correct member identity and callsign data;
- restrict, object to, or erase processing where the GDPR conditions apply;
- propagate deletion/correction to Clerk and other processors and backups;
- preserve only records subject to a documented legal obligation or claim; and
- respond within the applicable deadline and record the outcome.

## Cookies and browser storage

The current build keeps Vercel Web Analytics and Speed Insights disabled until
the user affirmatively allows anonymous analytics. Web Analytics is
cookie-free, but consent also covers access to browser performance and device
information. The optional clients load only after the first affirmative choice.
They then remain initialized for stable route attribution, while a per-event
consent check blocks every event whenever consent is withdrawn. Preference
changes are also synchronized across open tabs. BotID remains active as a
security control on protected mutations and sends browser challenge proof and
security signals with those requests. The build has no advertising, marketing,
social-media plugin, remote font, map, or embedded-media service.

Before adding any optional client-side service:

1. update the data and cookie inventory, provider contracts, and privacy notice;
2. implement purpose-specific, off-by-default consent with equally accessible
   accept and reject controls;
3. prevent the script, iframe, request, cookie, or local-storage access before
   consent—hiding an already loaded service is insufficient;
4. make withdrawal as easy as consent and stop future optional processing;
5. version the notice so existing users see the changed choice; and
6. verify behavior in a fresh browser profile and after rejection, acceptance,
   withdrawal, and expiry.

## Legal-notice maintenance

- Do not restore the former European Commission ODR-platform link. Regulation
  (EU) 2024/3228 discontinued the platform and repealed its legal basis with
  effect from 20 July 2025.
- Do not add generic “all rights reserved” or “written consent required” copy
  for the application source. The repository is distributed under AGPL-3.0-or-
  later, and the corresponding-source link must remain accurate for deployed
  forks.
- Treat generic liability exclusions as legal advice, not harmless boilerplate.
  Keep the factual flight-simulation limitation and have any broader exclusion
  reviewed for the actual operator and service.

## Organizational safeguards

- Maintain the Article 30 record of processing activities where required and a
  current legitimate-interest assessment for security processing.
- Define least-privilege role ownership, periodic access reviews, offboarding,
  credential rotation, backup restoration tests, and vulnerability management.
- Maintain a breach-response process covering processor escalation, the
  72-hour supervisory-authority assessment, evidence preservation, and user
  notification where required.
- Assess whether a data-protection officer, EU representative, DPIA, or minor
  user safeguards are required for the actual controller and audience.
- Re-run unit, build, browser, header, and cookie-storage checks after every
  authentication, hosting, database, ACARS, or frontend dependency change.
