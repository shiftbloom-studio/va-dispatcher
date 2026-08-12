"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, MapPin } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/fields";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { apiErrorMessage } from "@/lib/api/http";
import {
  flightTelemetryResponseSchema,
  oooiCorrectionResponseSchema,
  type FlightOooi,
} from "@/lib/api/schemas";
import { jsonBody, useApi } from "@/lib/api/use-api";
import { formatUtc, isoToUtcInput, utcInputToIso } from "@/lib/utc";

type OooiField = "outAt" | "offAt" | "onAt" | "inAt";
type OooiInputs = Record<OooiField, string>;

const oooiFields = [
  ["outAt", "OUT · off blocks"],
  ["offAt", "OFF · airborne"],
  ["onAt", "ON · landed"],
  ["inAt", "IN · on blocks"],
] as const satisfies ReadonlyArray<readonly [OooiField, string]>;

function oooiInputs(value?: Partial<Omit<FlightOooi, "id">>): OooiInputs {
  return {
    outAt: value?.outAt ? isoToUtcInput(value.outAt) : "",
    offAt: value?.offAt ? isoToUtcInput(value.offAt) : "",
    onAt: value?.onAt ? isoToUtcInput(value.onAt) : "",
    inAt: value?.inAt ? isoToUtcInput(value.inAt) : "",
  };
}

export function FlightTelemetryStatus({
  slug,
  flightId,
  mode,
  initialOooi,
  onOooiUpdated,
}: {
  slug: string;
  flightId: string;
  mode: "pilot" | "dispatcher";
  initialOooi?: Partial<Omit<FlightOooi, "id">>;
  onOooiUpdated?: () => void | Promise<void>;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const telemetryQueryKey = [slug, "flight", flightId, "telemetry"] as const;
  const [inputs, setInputs] = useState<OooiInputs>(() =>
    oooiInputs(initialOooi),
  );
  const [touched, setTouched] = useState<Set<OooiField>>(() => new Set());
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const telemetry = useQuery({
    queryKey: telemetryQueryKey,
    queryFn: () =>
      api(`/flights/${flightId}/telemetry?trackLimit=0`, {
        schema: flightTelemetryResponseSchema,
      }),
    refetchInterval: 10_000,
  });
  const correction = useMutation({
    mutationFn: (body: Record<string, string | null>) =>
      api(`/flights/${flightId}/oooi`, {
        method: "PATCH",
        schema: oooiCorrectionResponseSchema,
        ...jsonBody(body),
      }),
    onSuccess: async (data) => {
      setInputs(oooiInputs(data.flight));
      setTouched(new Set());
      setReason("");
      setFormError(null);
      setNotice("OOOI timestamps and provenance were updated.");
      await queryClient.invalidateQueries({ queryKey: telemetryQueryKey });
      await onOooiUpdated?.();
    },
  });

  async function submitCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    if (!touched.size) {
      setFormError("Change or clear at least one OOOI timestamp.");
      return;
    }
    if (!reason.trim()) {
      setFormError("Enter the operational reason for this correction.");
      return;
    }

    try {
      const payload: Record<string, string | null> = { reason: reason.trim() };
      for (const field of touched) {
        payload[field] = inputs[field] ? utcInputToIso(inputs[field]) : null;
      }
      setFormError(null);
      await correction.mutateAsync(payload);
    } catch (error) {
      if (!(error instanceof Error && "status" in error)) {
        setFormError(apiErrorMessage(error));
      }
    }
  }

  if (telemetry.isPending)
    return <LoadingState label="Loading simulator connection" />;
  if (telemetry.isError)
    return (
      <ErrorState
        message={apiErrorMessage(telemetry.error)}
        onRetry={() => void telemetry.refetch()}
      />
    );

  const current = telemetry.data.current;
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="MSFS 2024 connection"
        description="Simulator telemetry is operational awareness only, not a real-world safety service."
      />
      <div className="space-y-5 p-5">
        <div>
          <p className="flex items-center gap-2 font-semibold text-slate-950">
            <span
              aria-hidden
              className={`size-2.5 rounded-full ${
                telemetry.data.presence === "online"
                  ? "bg-emerald-500"
                  : telemetry.data.presence === "stale"
                    ? "bg-amber-500"
                    : "bg-slate-400"
              }`}
            />
            {telemetry.data.presence === "online"
              ? "Simulator online"
              : telemetry.data.presence === "stale"
                ? "Simulator heartbeat stale"
                : "Simulator disconnected"}
          </p>
          {current ? (
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Phase</dt>
                <dd className="font-semibold text-slate-950">
                  <Activity aria-hidden className="mr-1 inline size-4" />
                  {current.phase.replace("_", " ")}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Last sample</dt>
                <dd className="font-semibold text-slate-950">
                  {formatUtc(current.sampleAt)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Position</dt>
                <dd className="font-semibold text-slate-950">
                  <MapPin aria-hidden className="mr-1 inline size-4" />
                  {current.latitude.toFixed(3)}, {current.longitude.toFixed(3)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Aircraft state</dt>
                <dd className="font-semibold text-slate-950">
                  {current.altitudeFeet.toLocaleString()} ft ·{" "}
                  {current.groundSpeedKnots} kt ·{" "}
                  {Math.round(current.headingDegrees)}°
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-slate-600">
              No heartbeat has been received for this assigned flight. Create a
              device token in My settings and configure it in the simulator
              client.
            </p>
          )}
        </div>

        <section aria-labelledby={`oooi-history-${flightId}`}>
          <h3
            id={`oooi-history-${flightId}`}
            className="font-display font-semibold text-slate-950"
          >
            OOOI provenance
          </h3>
          {telemetry.data.oooiEvents.length ? (
            <ol className="mt-3 space-y-2">
              {telemetry.data.oooiEvents.slice(0, 8).map((event) => (
                <li
                  key={event.id}
                  className="rounded-lg border border-slate-200 p-3 text-sm"
                >
                  <p className="font-semibold uppercase text-slate-950">
                    {event.eventType} · {event.source}
                  </p>
                  <p className="mt-1 text-slate-600">
                    {event.occurredAt
                      ? formatUtc(event.occurredAt)
                      : "Timestamp cleared"}
                    {event.reason ? ` · ${event.reason}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-sm text-slate-600">
              No automatic or manual OOOI event has been recorded.
            </p>
          )}
        </section>

        {mode === "dispatcher" ? (
          <form
            className="border-t border-slate-200 pt-5"
            onSubmit={(event) => void submitCorrection(event)}
          >
            <fieldset>
              <legend className="font-display font-semibold text-slate-950">
                Correct OOOI timestamps
              </legend>
              <p className="mt-1 text-sm text-slate-600">
                Times are UTC. Editing or clearing a field creates permanent
                manual provenance with your authenticated membership.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {oooiFields.map(([field, label]) => (
                  <div key={field}>
                    <Label htmlFor={`${flightId}-${field}`}>{label}</Label>
                    <Input
                      id={`${flightId}-${field}`}
                      type="datetime-local"
                      value={inputs[field]}
                      onChange={(event) => {
                        setInputs((currentInputs) => ({
                          ...currentInputs,
                          [field]: event.target.value,
                        }));
                        setTouched((currentTouched) =>
                          new Set(currentTouched).add(field),
                        );
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <Label htmlFor={`${flightId}-oooi-reason`}>
                  Correction reason
                </Label>
                <Textarea
                  id={`${flightId}-oooi-reason`}
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Operational reason for changing these timestamps"
                />
              </div>
            </fieldset>
            {formError || correction.isError ? (
              <p role="alert" className="mt-3 text-sm font-medium text-red-700">
                {formError ?? apiErrorMessage(correction.error)}
              </p>
            ) : null}
            {notice ? (
              <p role="status" className="mt-3 text-sm text-emerald-800">
                {notice}
              </p>
            ) : null}
            <Button
              type="submit"
              className="mt-4"
              disabled={correction.isPending}
            >
              Save OOOI correction
            </Button>
          </form>
        ) : null}
      </div>
    </Card>
  );
}
