"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileCheck2, RefreshCw, Save } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/fields";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { apiErrorMessage } from "@/lib/api/http";
import {
  simbriefConnectionResponseSchema,
  simbriefDispatchListSchema,
  simbriefDispatchResponseSchema,
  simbriefGenerateResponseSchema,
  type Flight,
  type SimbriefDispatch,
} from "@/lib/api/schemas";
import { jsonBody, useApi } from "@/lib/api/use-api";
import { formatUtc } from "@/lib/utc";

export function SimbriefWorkspace({
  slug,
  flight,
  mode,
}: {
  slug: string;
  flight: Flight;
  mode: "pilot" | "dispatcher";
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const historyKey = [slug, "flight", flight.id, "simbrief"] as const;
  const history = useQuery({
    queryKey: historyKey,
    queryFn: () =>
      api(`/flights/${flight.id}/simbrief/dispatches`, {
        schema: simbriefDispatchListSchema,
      }),
  });
  const connection = useQuery({
    queryKey: [slug, "simbrief", "connection"],
    queryFn: () =>
      api("/simbrief/connection", {
        schema: simbriefConnectionResponseSchema,
      }),
    enabled: mode === "pilot",
  });
  const [notice, setNotice] = useState<string | null>(null);

  const generate = useMutation({
    mutationFn: (dispatchId: string) =>
      api(`/flights/${flight.id}/simbrief/dispatches/${dispatchId}/generate`, {
        method: "POST",
        schema: simbriefGenerateResponseSchema,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(historyKey, (current: unknown) => {
        const parsed = simbriefDispatchListSchema.safeParse(current);
        if (!parsed.success) return current;
        return {
          items: parsed.data.items.map((item) =>
            item.id === data.dispatch.id ? data.dispatch : item,
          ),
        };
      });
      window.location.assign(data.dispatchUrl);
    },
  });
  const sync = useMutation({
    mutationFn: (dispatchId: string) =>
      api(`/flights/${flight.id}/simbrief/dispatches/${dispatchId}/sync`, {
        method: "POST",
        schema: simbriefDispatchResponseSchema,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: historyKey });
      setNotice("The latest SimBrief status and OFP were synchronized.");
    },
  });

  if (history.isPending || (mode === "pilot" && connection.isPending)) {
    return <LoadingState label="Loading SimBrief planning" />;
  }
  if (history.isError || (mode === "pilot" && connection.isError)) {
    return (
      <ErrorState
        message={apiErrorMessage(history.error ?? connection.error)}
        onRetry={() =>
          void Promise.all([history.refetch(), connection.refetch()])
        }
      />
    );
  }

  const revisions = history.data.items;
  const latest = revisions[0];
  const isConnected = connection.data?.connection.connected ?? false;

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="SimBrief flight plan"
        description={
          mode === "dispatcher"
            ? "Prepare canonical planning inputs. The assigned pilot launches the plan in their own SimBrief account."
            : "Review dispatch planning, generate in your own SimBrief account, and import the resulting OFP."
        }
      />
      <div className="space-y-5 p-5">
        {mode === "dispatcher" ? (
          <PreparationForm
            flight={flight}
            onPrepared={async () => {
              await queryClient.invalidateQueries({ queryKey: historyKey });
              setNotice(
                "A new immutable planning revision was saved for the pilot.",
              );
            }}
          />
        ) : (
          <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-950">
            <p className="font-semibold">Generation belongs to your account</p>
            <p className="mt-1">
              Launching opens SimBrief with the dispatcher&apos;s prepared route
              and remarks. SimBrief may create or replace an OFP under your
              connected Pilot ID. Review the values there before generating.
            </p>
          </div>
        )}

        {notice ? (
          <p
            role="status"
            className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"
          >
            {notice}
          </p>
        ) : null}

        {latest ? (
          <Revision
            dispatch={latest}
            mode={mode}
            canGenerate={isConnected && latest.status === "prepared"}
            busy={generate.isPending || sync.isPending}
            onGenerate={() => generate.mutate(latest.id)}
            onSync={() => sync.mutate(latest.id)}
          />
        ) : (
          <EmptyState
            title="No SimBrief preparation yet"
            detail={
              mode === "dispatcher"
                ? "Save the first planning revision for the assigned pilot."
                : "Dispatch has not prepared a flight plan for this sector."
            }
          />
        )}

        {mode === "pilot" && latest?.status === "prepared" && !isConnected ? (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            Connect a numeric SimBrief Pilot ID in My settings before opening
            this preparation.
          </p>
        ) : null}
        {generate.isError || sync.isError ? (
          <p role="alert" className="text-sm font-medium text-red-700">
            {apiErrorMessage(generate.error ?? sync.error)}
          </p>
        ) : null}

        {revisions.length > 1 ? (
          <details className="rounded-xl border border-slate-200 p-4">
            <summary className="cursor-pointer font-semibold text-slate-950">
              Earlier planning revisions ({revisions.length - 1})
            </summary>
            <div className="mt-4 space-y-3">
              {revisions.slice(1).map((dispatch) => (
                <Revision
                  key={dispatch.id}
                  dispatch={dispatch}
                  mode={mode}
                  canGenerate={false}
                  busy={false}
                  onGenerate={() => undefined}
                  onSync={() => undefined}
                  compact
                />
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </Card>
  );
}

function PreparationForm({
  flight,
  onPrepared,
}: {
  flight: Flight;
  onPrepared: () => Promise<void>;
}) {
  const api = useApi();
  const [route, setRoute] = useState("");
  const [alternate, setAlternate] = useState("");
  const [flightLevel, setFlightLevel] = useState("");
  const [registration, setRegistration] = useState("");
  const [remarks, setRemarks] = useState(flight.dispatcherNotes ?? "");
  const [units, setUnits] = useState<"KGS" | "LBS">("KGS");
  const prepare = useMutation({
    mutationFn: () =>
      api(`/flights/${flight.id}/simbrief/dispatches`, {
        method: "POST",
        schema: simbriefDispatchResponseSchema,
        ...jsonBody({
          aircraftType: flight.aircraftType || undefined,
          route: route.trim() || undefined,
          alternate: alternate.trim().toUpperCase() || undefined,
          flightLevel: flightLevel.trim().toUpperCase() || undefined,
          registration: registration.trim().toUpperCase() || undefined,
          customRemarks: remarks.trim() || undefined,
          units,
          notams: true,
          navlog: true,
        }),
      }),
    onSuccess: onPrepared,
  });

  return (
    <form
      className="grid gap-4 md:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        prepare.mutate();
      }}
    >
      <div className="md:col-span-2">
        <Label htmlFor="simbrief-route">Route</Label>
        <Textarea
          id="simbrief-route"
          maxLength={2000}
          value={route}
          onChange={(event) => setRoute(event.target.value)}
          placeholder="Leave empty to let SimBrief suggest a route"
        />
      </div>
      <div>
        <Label htmlFor="simbrief-alternate">Alternate ICAO</Label>
        <Input
          id="simbrief-alternate"
          maxLength={4}
          className="uppercase"
          value={alternate}
          onChange={(event) => setAlternate(event.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="simbrief-flight-level">Cruise level</Label>
        <Input
          id="simbrief-flight-level"
          maxLength={7}
          value={flightLevel}
          onChange={(event) => setFlightLevel(event.target.value)}
          placeholder="FL390"
        />
      </div>
      <div>
        <Label htmlFor="simbrief-registration">Registration</Label>
        <Input
          id="simbrief-registration"
          maxLength={16}
          className="uppercase"
          value={registration}
          onChange={(event) => setRegistration(event.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="simbrief-units">Units</Label>
        <Select
          id="simbrief-units"
          value={units}
          onChange={(event) => setUnits(event.target.value as "KGS" | "LBS")}
        >
          <option value="KGS">Kilograms</option>
          <option value="LBS">Pounds</option>
        </Select>
      </div>
      <div className="md:col-span-2">
        <Label htmlFor="simbrief-remarks">Dispatcher remarks</Label>
        <Textarea
          id="simbrief-remarks"
          maxLength={2000}
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
        />
        <p className="mt-1 text-xs text-slate-500">
          The server snapshots your authenticated member name separately; this
          field cannot change dispatcher attribution.
        </p>
      </div>
      {prepare.isError ? (
        <p role="alert" className="text-sm text-red-700 md:col-span-2">
          {apiErrorMessage(prepare.error)}
        </p>
      ) : null}
      <div className="md:col-span-2">
        <Button type="submit" disabled={prepare.isPending}>
          <Save aria-hidden className="size-4" />
          {prepare.isPending ? "Saving…" : "Save planning revision"}
        </Button>
      </div>
    </form>
  );
}

function Revision({
  dispatch,
  mode,
  canGenerate,
  busy,
  onGenerate,
  onSync,
  compact = false,
}: {
  dispatch: SimbriefDispatch;
  mode: "pilot" | "dispatcher";
  canGenerate: boolean;
  busy: boolean;
  onGenerate: () => void;
  onSync: () => void;
  compact?: boolean;
}) {
  return (
    <article className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-950">
            Revision {dispatch.revision} · {dispatch.status}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Prepared by {dispatch.dispatcherName} ·{" "}
            {formatUtc(dispatch.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {mode === "pilot" && dispatch.status === "prepared" ? (
            <Button
              type="button"
              disabled={!canGenerate || busy}
              onClick={onGenerate}
            >
              <ExternalLink aria-hidden className="size-4" /> Open SimBrief
            </Button>
          ) : null}
          {dispatch.status === "pending" ? (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={onSync}
            >
              <RefreshCw aria-hidden className="size-4" /> Sync / retry import
            </Button>
          ) : null}
        </div>
      </div>
      {dispatch.dispatcherRemarks ? (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
          <p className="font-semibold text-slate-950">Dispatcher remarks</p>
          <p className="mt-1 whitespace-pre-wrap">
            {dispatch.dispatcherRemarks}
          </p>
        </div>
      ) : null}
      {dispatch.lastError ? (
        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          Last import error: {dispatch.lastError}
        </p>
      ) : null}
      {!compact && dispatch.status === "ready" && dispatch.ofp ? (
        <details className="mt-3 rounded-lg bg-emerald-50 p-3">
          <summary className="flex cursor-pointer items-center gap-2 font-semibold text-emerald-900">
            <FileCheck2 aria-hidden className="size-4" /> Latest imported OFP
          </summary>
          <p className="mt-2 text-xs text-emerald-800">
            SimBrief request {dispatch.simbriefRequestId || "unknown"}
            {dispatch.generatedAt
              ? ` · generated ${formatUtc(dispatch.generatedAt)}`
              : ""}
          </p>
          <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white p-3 text-xs text-slate-800">
            {JSON.stringify(dispatch.ofp, null, 2)}
          </pre>
        </details>
      ) : null}
    </article>
  );
}
