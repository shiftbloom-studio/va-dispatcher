"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleCheck,
  ExternalLink,
  KeyRound,
  RadioTower,
  Save,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { useState } from "react";

import { PageHeading } from "@/components/page-heading";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { HelpText, Input, Label } from "@/components/ui/fields";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { apiErrorMessage } from "@/lib/api/http";
import {
  acarsConfigSchema,
  meSchema,
  meUpdateResponseSchema,
  tenantDetailSchema,
  type Me,
  type TenantDetail,
} from "@/lib/api/schemas";
import { jsonBody, useApi } from "@/lib/api/use-api";
import { formatUtc } from "@/lib/utc";

const HOPPIE_REGISTRATION_URL =
  "https://www.hoppie.nl/acars/system/register.html";
const CALLSIGN_PATTERN = /^[A-Z0-9-]+$/;

export function AccountSettings({ slug }: { slug: string }) {
  const api = useApi();
  const me = useQuery({
    queryKey: [slug, "settings", "me"],
    queryFn: () => api("/me", { schema: meSchema }),
  });
  const tenant = useQuery({
    queryKey: [slug, "settings", "tenant"],
    queryFn: () => api("/tenant", { schema: tenantDetailSchema }),
  });

  if (me.isPending || tenant.isPending) {
    return <LoadingState label="Loading account settings" />;
  }
  if (me.isError || tenant.isError) {
    return (
      <ErrorState
        message={apiErrorMessage(me.error ?? tenant.error)}
        onRetry={() => void Promise.all([me.refetch(), tenant.refetch()])}
      />
    );
  }
  if (!me.data.membership) {
    return <ErrorState message="No active Virtual Airline membership found." />;
  }

  return (
    <>
      <PageHeading
        eyebrow="Account"
        title="Settings"
        description="Manage your member profile and ACARS identity. Virtual Airline administrators can also connect the dispatch station to Hoppie's ACARS."
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <ProfileCard slug={slug} me={me.data} />
        <HoppieGuide />
        <div className="xl:col-span-2">
          <HoppieConfigCard
            slug={slug}
            tenant={tenant.data}
            isAdmin={me.data.membership.role === "admin"}
          />
        </div>
      </div>
    </>
  );
}

function ProfileCard({ slug, me }: { slug: string; me: Me }) {
  const membership = me.membership!;
  const api = useApi();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(membership.displayName ?? "");
  const [pilotCallsign, setPilotCallsign] = useState(
    membership.pilotCallsign ?? "",
  );
  const [success, setSuccess] = useState<string | null>(null);
  const normalizedCallsign = pilotCallsign.trim().toUpperCase();
  const callsignValid =
    !normalizedCallsign ||
    (normalizedCallsign.length <= 20 &&
      CALLSIGN_PATTERN.test(normalizedCallsign));
  const save = useMutation({
    mutationFn: () =>
      api("/me", {
        method: "PATCH",
        schema: meUpdateResponseSchema,
        ...jsonBody({
          displayName: displayName.trim() || null,
          pilotCallsign: normalizedCallsign || null,
        }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData<Me>([slug, "settings", "me"], (current) =>
        current ? { ...current, membership: data.membership } : current,
      );
      setPilotCallsign(data.membership.pilotCallsign ?? "");
      setSuccess("Your account settings were saved.");
    },
  });

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Member profile"
        description="These details are scoped to this Virtual Airline."
      />
      <form
        className="space-y-5 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          setSuccess(null);
          if (callsignValid) save.mutate();
        }}
      >
        <div>
          <Label htmlFor="settings-display-name">Display name</Label>
          <Input
            id="settings-display-name"
            maxLength={120}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Your name"
          />
        </div>
        <div>
          <Label htmlFor="settings-callsign">Your ACARS callsign</Label>
          <Input
            id="settings-callsign"
            maxLength={20}
            className="uppercase"
            value={pilotCallsign}
            onChange={(event) => setPilotCallsign(event.target.value)}
            aria-invalid={!callsignValid}
            aria-describedby="settings-callsign-help"
            placeholder="SAS123"
          />
          <p
            id="settings-callsign-help"
            className={`mt-1 text-sm ${callsignValid ? "text-slate-500" : "font-medium text-red-700"}`}
          >
            {callsignValid
              ? "Use the same callsign as your active Hoppie-enabled simulator client. Letters, numbers, and hyphens only."
              : "Use no more than 20 letters, numbers, or hyphens."}
          </p>
        </div>
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-950">
          <p className="font-semibold">
            Your personal logon code stays private
          </p>
          <p className="mt-1">
            Enter your own Hoppie logon only in the ACARS client connected to
            your simulator. This website needs your callsign, never your
            personal logon code.
          </p>
        </div>
        {success ? (
          <p role="status" className="text-sm font-medium text-emerald-700">
            {success}
          </p>
        ) : null}
        {save.isError ? (
          <p role="alert" className="text-sm font-medium text-red-700">
            {apiErrorMessage(save.error)}
          </p>
        ) : null}
        <Button type="submit" disabled={save.isPending || !callsignValid}>
          <Save aria-hidden className="size-4" />
          {save.isPending ? "Saving…" : "Save profile"}
        </Button>
      </form>
    </Card>
  );
}

function HoppieGuide() {
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Connect your simulator"
        description="Hoppie's ACARS logon registration is self-service and free."
      />
      <div className="space-y-5 p-5 text-sm leading-6 text-slate-700">
        <ol className="space-y-4">
          <GuideStep number="1" title="Request a Hoppie logon">
            Accept Hoppie&apos;s usage rules and request the code with a working
            email address. No separate API approval is required. Accounts that
            remain unused for 120 days expire.
          </GuideStep>
          <GuideStep number="2" title="Configure your ACARS client">
            Add the logon code and use the same flight callsign saved in your
            member profile above.
          </GuideStep>
          <GuideStep number="3" title="Match the network affiliation">
            The pilot and Virtual Airline ground-station logons must use the
            same Hoppie network, such as VATSIM, IVAO, or None.
          </GuideStep>
          <GuideStep number="4" title="Bring the aircraft online">
            Many simulator clients appear online only after sending their first
            request. Dispatch messages are store-and-forward, not instant
            delivery receipts.
          </GuideStep>
        </ol>
        <a
          href={HOPPIE_REGISTRATION_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          Request a Hoppie logon
          <ExternalLink aria-hidden className="size-4" />
        </a>
      </div>
    </Card>
  );
}

function GuideStep({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white">
        {number}
      </span>
      <div>
        <p className="font-semibold text-slate-950">{title}</p>
        <p>{children}</p>
      </div>
    </li>
  );
}

function HoppieConfigCard({
  slug,
  tenant,
  isAdmin,
}: {
  slug: string;
  tenant: TenantDetail;
  isAdmin: boolean;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [station, setStation] = useState(tenant.hoppieStation ?? "");
  const [logon, setLogon] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const normalizedStation = station.trim().toUpperCase();
  const stationValid =
    normalizedStation.length > 0 &&
    normalizedStation.length <= 20 &&
    CALLSIGN_PATTERN.test(normalizedStation);

  function applyConfig(data: ReturnType<typeof acarsConfigSchema.parse>) {
    queryClient.setQueryData<TenantDetail>(
      [slug, "settings", "tenant"],
      (current) => (current ? { ...current, ...data } : current),
    );
  }

  const save = useMutation({
    mutationFn: () =>
      api("/tenant/acars-config", {
        method: "PUT",
        schema: acarsConfigSchema,
        ...jsonBody({
          hoppieStation: normalizedStation,
          ...(logon.trim() ? { hoppieLogon: logon.trim() } : {}),
        }),
      }),
    onSuccess: (data) => {
      applyConfig(data);
      setLogon("");
      setStatus(
        "Hoppie accepted the connection test and the configuration is live.",
      );
    },
  });
  const test = useMutation({
    mutationFn: () =>
      api("/tenant/acars-config/test", {
        method: "POST",
        schema: acarsConfigSchema,
      }),
    onSuccess: (data) => {
      applyConfig(data);
      setStatus("Hoppie accepted the connection test.");
    },
  });
  const disconnect = useMutation({
    mutationFn: () =>
      api("/tenant/acars-config", {
        method: "DELETE",
        schema: acarsConfigSchema,
      }),
    onSuccess: (data) => {
      applyConfig(data);
      setLogon("");
      setStatus("Hoppie credentials were removed. ACARS is now unconfigured.");
    },
  });
  const mutationError = save.error ?? test.error ?? disconnect.error;
  const busy = save.isPending || test.isPending || disconnect.isPending;

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Virtual Airline ground station"
        description="One encrypted ground-station credential sends and receives Hoppie traffic for this tenant."
        action={
          <span
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
              tenant.hasHoppieLogon
                ? "bg-emerald-100 text-emerald-800"
                : "bg-slate-100 text-slate-700"
            }`}
          >
            {tenant.hasHoppieLogon ? (
              <CircleCheck aria-hidden className="size-4" />
            ) : (
              <RadioTower aria-hidden className="size-4" />
            )}
            {tenant.hasHoppieLogon ? "Connected" : "Not configured"}
          </span>
        }
      />
      <div className="p-5">
        {!isAdmin ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
            <p className="font-semibold text-slate-950">
              An administrator manages this connection
            </p>
            <p className="mt-1">
              Current station: {tenant.hoppieStation ?? "not configured"}. Your
              own simulator setup only needs the callsign saved in your member
              profile.
            </p>
          </div>
        ) : (
          <form
            className="grid gap-5 lg:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              setStatus(null);
              if (stationValid && (tenant.hasHoppieLogon || logon.trim())) {
                save.mutate();
              }
            }}
          >
            <div>
              <Label htmlFor="hoppie-ground-station">
                Ground-station callsign
              </Label>
              <Input
                id="hoppie-ground-station"
                required
                maxLength={20}
                className="uppercase"
                value={station}
                onChange={(event) => setStation(event.target.value)}
                aria-invalid={!stationValid}
                aria-describedby="hoppie-station-help"
                placeholder="SAS"
              />
              <p
                id="hoppie-station-help"
                className={`mt-1 text-sm ${stationValid ? "text-slate-500" : "font-medium text-red-700"}`}
              >
                Normally the airline&apos;s three-letter designator. Letters,
                numbers, and hyphens only.
              </p>
            </div>
            <div>
              <Label htmlFor="hoppie-ground-logon">
                Ground-station Hoppie logon
              </Label>
              <Input
                id="hoppie-ground-logon"
                type="password"
                autoComplete="new-password"
                maxLength={128}
                value={logon}
                onChange={(event) => setLogon(event.target.value)}
                placeholder={
                  tenant.hasHoppieLogon
                    ? "Leave blank to keep current logon"
                    : "Paste the Hoppie logon code"
                }
              />
              <HelpText>
                The API tests the code before encrypting it. The saved value is
                never returned to the browser.
              </HelpText>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 lg:col-span-2">
              <div className="flex gap-3">
                <ShieldCheck
                  aria-hidden
                  className="mt-0.5 size-5 shrink-0 text-emerald-700"
                />
                <div>
                  <p className="font-semibold text-slate-950">
                    Tenant-scoped and encrypted
                  </p>
                  <p>
                    Dispatch sends from {normalizedStation || "this station"}.
                    Pilots must use a Hoppie account with the same network
                    affiliation. A successful send means Hoppie accepted the
                    message for store-and-forward; it is not a delivery or read
                    receipt.
                  </p>
                </div>
              </div>
            </div>
            {tenant.hasHoppieLogon && !tenant.hoppiePollingEnabled ? (
              <p
                role="alert"
                className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 lg:col-span-2"
              >
                The saved Hoppie credential can send messages, but scheduled
                inbound polling is not active. Contact the deployment operator
                before using this ground station live.
              </p>
            ) : null}
            {tenant.hoppieLastTestedAt ? (
              <p className="text-sm text-slate-600 lg:col-span-2">
                Last successful connection test:{" "}
                <time dateTime={tenant.hoppieLastTestedAt}>
                  {formatUtc(tenant.hoppieLastTestedAt)}
                </time>
              </p>
            ) : null}
            {status ? (
              <p
                role="status"
                className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 lg:col-span-2"
              >
                {status}
              </p>
            ) : null}
            {mutationError ? (
              <p
                role="alert"
                className="rounded-lg bg-red-50 p-3 text-sm text-red-800 lg:col-span-2"
              >
                {apiErrorMessage(mutationError)} The entered credential is
                retained in this form so you can correct or retry it manually.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3 lg:col-span-2">
              <Button
                type="submit"
                disabled={
                  busy ||
                  !stationValid ||
                  (!tenant.hasHoppieLogon && !logon.trim())
                }
              >
                <KeyRound aria-hidden className="size-4" />
                {save.isPending ? "Testing and saving…" : "Test and save"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setStatus(null);
                  test.mutate();
                }}
                disabled={busy || !tenant.hasHoppieLogon}
              >
                <RadioTower aria-hidden className="size-4" />
                {test.isPending ? "Testing…" : "Test saved connection"}
              </Button>
              {tenant.hasHoppieLogon ? (
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => {
                    setStatus(null);
                    disconnect.mutate();
                  }}
                  disabled={busy}
                >
                  <Unplug aria-hidden className="size-4" />
                  {disconnect.isPending ? "Removing…" : "Remove credentials"}
                </Button>
              ) : null}
            </div>
          </form>
        )}
      </div>
    </Card>
  );
}
