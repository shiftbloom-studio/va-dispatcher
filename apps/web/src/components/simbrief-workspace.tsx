"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileCheck2, RefreshCw, Save } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { apiErrorMessage } from "@/lib/api/http";
import {
  simbriefConnectionResponseSchema,
  simbriefDispatchListSchema,
  simbriefDispatchResponseSchema,
  simbriefGenerateResponseSchema,
  type DispatchRelease,
  type Flight,
  type SimbriefDispatch,
} from "@/lib/api/schemas";
import { jsonBody, useApi } from "@/lib/api/use-api";
import { formatUtc } from "@/lib/utc";

export function SimbriefWorkspace({
  slug,
  flight,
  release,
  mode,
}: {
  slug: string;
  flight: Flight;
  release: DispatchRelease | null;
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
  const latestMatchesCurrent = Boolean(
    latest &&
    release &&
    latest.flightVersion === flight.version &&
    latest.assignmentRevision === flight.assignmentRevision &&
    latest.releaseId === release.id &&
    latest.releaseRevision === release.revision,
  );

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
          release ? (
            <PreparationAction
              flight={flight}
              release={release}
              onPrepared={async () => {
                await queryClient.invalidateQueries({ queryKey: historyKey });
                setNotice(
                  `SimBrief preparation saved from immutable release R${release.revision}.`,
                );
              }}
            />
          ) : (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              Publish a dispatch release before preparing SimBrief.
            </p>
          )
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
            canGenerate={
              isConnected &&
              latest.status === "prepared" &&
              latestMatchesCurrent
            }
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
        {mode === "pilot" &&
        latest?.status === "prepared" &&
        !latestMatchesCurrent ? (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            The flight assignment or dispatch release changed after this
            preparation. Dispatch must prepare the current release before you
            can open SimBrief.
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

function PreparationAction({
  flight,
  release,
  onPrepared,
}: {
  flight: Flight;
  release: DispatchRelease;
  onPrepared: () => Promise<void>;
}) {
  const api = useApi();
  const prepare = useMutation({
    mutationFn: () =>
      api(`/flights/${flight.id}/simbrief/dispatches`, {
        method: "POST",
        schema: simbriefDispatchResponseSchema,
        ...jsonBody({
          expectedFlightVersion: flight.version,
          expectedAssignmentRevision: flight.assignmentRevision,
          releaseId: release.id,
          releaseRevision: release.revision,
        }),
      }),
    onSuccess: onPrepared,
  });

  return (
    <form
      className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        prepare.mutate();
      }}
    >
      <p className="font-semibold text-emerald-950">
        Prepare immutable release R{release.revision}
      </p>
      <p className="mt-1 text-sm leading-6 text-emerald-900">
        Route, alternate, cruise level, units, and dispatcher remarks are copied
        from the release above. The pilot reviews the SimBrief-specific
        passenger and freight split before generation. Dispatcher attribution
        comes from your authenticated account.
      </p>
      {prepare.isError ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {apiErrorMessage(prepare.error)}
        </p>
      ) : null}
      <div className="mt-4">
        <Button type="submit" disabled={prepare.isPending}>
          <Save aria-hidden className="size-4" />
          {prepare.isPending
            ? "Preparing…"
            : `Prepare SimBrief from R${release.revision}`}
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
          {dispatch.releaseRevision && dispatch.flightVersion ? (
            <p className="mt-1 text-xs font-medium text-slate-600">
              Dispatch release R{dispatch.releaseRevision} · flight revision{" "}
              {dispatch.flightVersion} · assignment revision{" "}
              {dispatch.assignmentRevision ?? "unknown"}
            </p>
          ) : (
            <p className="mt-1 text-xs font-medium text-amber-700">
              Legacy preparation · dispatch must prepare the current release
            </p>
          )}
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
