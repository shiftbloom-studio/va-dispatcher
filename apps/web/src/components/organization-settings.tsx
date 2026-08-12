"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleCheck,
  ExternalLink,
  KeyRound,
  RadioTower,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PageHeading } from "@/components/page-heading";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { HelpText, Input, Label } from "@/components/ui/fields";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { apiErrorMessage } from "@/lib/api/http";
import {
  acarsConfigSchema,
  tenantDetailSchema,
  type TenantDetail,
} from "@/lib/api/schemas";
import { jsonBody, useApi } from "@/lib/api/use-api";
import { formatUtc } from "@/lib/utc";

const HOPPIE_REGISTRATION_URL =
  "https://www.hoppie.nl/acars/system/register.html";
const CALLSIGN_PATTERN = /^[A-Z0-9-]+$/;

export function OrganizationSettings({ slug }: { slug: string }) {
  const api = useApi();
  const tenant = useQuery({
    queryKey: [slug, "organization-settings", "tenant"],
    queryFn: () => api("/tenant", { schema: tenantDetailSchema }),
  });

  if (tenant.isPending) {
    return <LoadingState label="Loading organization settings" />;
  }
  if (tenant.isError) {
    return (
      <ErrorState
        message={apiErrorMessage(tenant.error)}
        onRetry={() => void tenant.refetch()}
      />
    );
  }

  return (
    <>
      <PageHeading
        eyebrow="Administration"
        title="Organization settings"
        description="Connect this Virtual Airline's shared dispatch ground station to Hoppie's ACARS network. Only organization administrators can change this credential."
        action={
          <Link
            href={`/${slug}/settings`}
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            My settings
          </Link>
        }
      />
      <div className="space-y-6">
        <Card className="overflow-hidden">
          <CardHeader
            title="Before connecting"
            description="The ground station uses its own Hoppie logon, separate from every member's simulator logon."
          />
          <div className="flex flex-col gap-4 p-5 text-sm leading-6 text-slate-700 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-3xl">
              Registration is self-service and does not require separate API
              approval. Choose the same network affiliation used by your pilots
              and dispatchers. Never reuse a member&apos;s personal logon here.
            </p>
            <a
              href={HOPPIE_REGISTRATION_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              Request ground-station logon
              <ExternalLink aria-hidden className="size-4" />
            </a>
          </div>
        </Card>
        <HoppieConfigCard slug={slug} tenant={tenant.data} />
      </div>
    </>
  );
}

function HoppieConfigCard({
  slug,
  tenant,
}: {
  slug: string;
  tenant: TenantDetail;
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
      [slug, "organization-settings", "tenant"],
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
        "Hoppie accepted the credential test and the configuration was saved.",
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
      setStatus("Hoppie accepted the credential test.");
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
      <form
        className="grid gap-5 p-5 lg:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          setStatus(null);
          if (stationValid && (tenant.hasHoppieLogon || logon.trim())) {
            save.mutate();
          }
        }}
      >
        <div>
          <Label htmlFor="hoppie-ground-station">Ground-station callsign</Label>
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
                Members must use a Hoppie account with the same network
                affiliation. A successful send means Hoppie accepted the message
                for store-and-forward; it is not a delivery or read receipt.
              </p>
            </div>
          </div>
        </div>
        {tenant.hasHoppieLogon && !tenant.hoppiePollingEnabled ? (
          <p
            role="alert"
            className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 lg:col-span-2"
          >
            The saved Hoppie credential can send messages, but scheduled inbound
            polling is not active. Contact the deployment operator before using
            this ground station live.
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
            {apiErrorMessage(mutationError)} The entered credential is retained
            in this form so you can correct or retry it manually.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3 lg:col-span-2">
          <Button
            type="submit"
            disabled={
              busy || !stationValid || (!tenant.hasHoppieLogon && !logon.trim())
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
    </Card>
  );
}
