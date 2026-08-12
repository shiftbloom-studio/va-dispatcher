"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useMemo, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { FieldError, Input, Label, Select } from "@/components/ui/fields";
import { ApiError, apiErrorMessage } from "@/lib/api/http";
import { bulkFlightResponseSchema } from "@/lib/api/schemas";
import { jsonBody, useApi } from "@/lib/api/use-api";
import {
  offerBuilderSchema,
  type OfferBuilderValues,
} from "@/lib/offer-builder-schema";
import { utcInputToIso } from "@/lib/utc";

export function OfferBuilder({
  slug,
  requestId,
  desiredFlightCount,
  flightCount = desiredFlightCount,
  expectedRequestVersion,
  onOffered,
}: {
  slug: string;
  requestId: string;
  desiredFlightCount: number;
  flightCount?: number;
  expectedRequestVersion: number;
  onOffered: () => Promise<void>;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [conflict, setConflict] = useState<string | null>(null);
  const [batchSize, setBatchSize] = useState(flightCount);
  const schema = useMemo(() => offerBuilderSchema(batchSize), [batchSize]);
  const form = useForm<OfferBuilderValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      flights: emptyFlightRows(batchSize),
    },
  });
  const rows = useFieldArray({ control: form.control, name: "flights" });
  const mutation = useMutation({
    mutationFn: (values: OfferBuilderValues) =>
      api("/flights/bulk", {
        method: "POST",
        schema: bulkFlightResponseSchema,
        ...jsonBody({
          scheduleRequestId: requestId,
          expectedRequestVersion,
          flights: values.flights.map((flight) => ({
            flightNumber: flight.flightNumber.trim().toUpperCase(),
            depIcao: flight.depIcao.trim().toUpperCase(),
            arrIcao: flight.arrIcao.trim().toUpperCase(),
            etd: utcInputToIso(flight.etd),
            eta: utcInputToIso(flight.eta),
            aircraftType: flight.aircraftType?.trim() || null,
          })),
        }),
      }),
    onSuccess: async () => {
      await Promise.all([
        onOffered(),
        queryClient.invalidateQueries({
          queryKey: [slug, "dispatch", "board"],
        }),
        queryClient.invalidateQueries({
          queryKey: [slug, "dispatch", "requests"],
        }),
      ]);
    },
  });

  async function submit(values: OfferBuilderValues) {
    setConflict(null);
    try {
      await mutation.mutateAsync(values);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setConflict(
          "The request changed while you were building this offer. Current data was reloaded; review it before retrying.",
        );
        await onOffered();
      }
    }
  }

  function changeBatchSize(nextSize: number) {
    if (!Number.isInteger(nextSize) || nextSize < 1 || nextSize > flightCount) {
      return;
    }
    const current = form.getValues("flights");
    if (nextSize < current.length) {
      const discardedRowsContainWork = current
        .slice(nextSize)
        .some((row) => Object.values(row).some((value) => Boolean(value)));
      if (
        discardedRowsContainWork &&
        !window.confirm(
          "Reducing the batch will discard entries in the removed rows. Continue?",
        )
      ) {
        return;
      }
    }
    const nextRows = current.slice(0, nextSize);
    while (nextRows.length < nextSize) nextRows.push(emptyFlightRow());
    setBatchSize(nextSize);
    form.reset({ flights: nextRows });
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={`Offer flight batch`}
        description={`${flightCount} of ${desiredFlightCount} requested flight slots remain. Choose how many to offer now; any remainder stays available for a follow-up batch.`}
      />
      <form
        onSubmit={form.handleSubmit(submit)}
        noValidate
        className="p-4 sm:p-5"
      >
        <div className="mb-5 max-w-xs">
          <Label htmlFor="offer-batch-size">Flights in this batch</Label>
          <Select
            id="offer-batch-size"
            value={batchSize}
            onChange={(event) => changeBatchSize(Number(event.target.value))}
          >
            {Array.from({ length: flightCount }, (_, index) => index + 1).map(
              (size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ),
            )}
          </Select>
          <p className="mt-1 text-xs text-slate-600">
            Choose 1–{flightCount}. The default fills every remaining slot.
          </p>
        </div>
        <div className="space-y-4">
          {rows.fields.map((row, index) => {
            const errors = form.formState.errors.flights?.[index];
            return (
              <fieldset
                key={row.id}
                className="rounded-[2px] border border-slate-200 p-4"
              >
                <legend className="px-1 text-sm font-bold text-slate-700">
                  Flight {index + 1} of {batchSize}
                </legend>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
                  <div>
                    <Label htmlFor={`offer-${index}-flight-number`}>
                      Flight number
                    </Label>
                    <Input
                      id={`offer-${index}-flight-number`}
                      placeholder="SK1234"
                      maxLength={12}
                      className="uppercase"
                      {...form.register(`flights.${index}.flightNumber`)}
                    />
                    <FieldError>{errors?.flightNumber?.message}</FieldError>
                  </div>
                  <div>
                    <Label htmlFor={`offer-${index}-departure`}>
                      Departure ICAO
                    </Label>
                    <Input
                      id={`offer-${index}-departure`}
                      placeholder="EKCH"
                      maxLength={4}
                      className="uppercase"
                      {...form.register(`flights.${index}.depIcao`)}
                    />
                    <FieldError>{errors?.depIcao?.message}</FieldError>
                  </div>
                  <div>
                    <Label htmlFor={`offer-${index}-arrival`}>
                      Arrival ICAO
                    </Label>
                    <Input
                      id={`offer-${index}-arrival`}
                      placeholder="ENGM"
                      maxLength={4}
                      className="uppercase"
                      {...form.register(`flights.${index}.arrIcao`)}
                    />
                    <FieldError>{errors?.arrIcao?.message}</FieldError>
                  </div>
                  <div>
                    <Label htmlFor={`offer-${index}-etd`}>ETD (UTC)</Label>
                    <Input
                      id={`offer-${index}-etd`}
                      type="datetime-local"
                      {...form.register(`flights.${index}.etd`)}
                    />
                    <FieldError>{errors?.etd?.message}</FieldError>
                  </div>
                  <div>
                    <Label htmlFor={`offer-${index}-eta`}>ETA (UTC)</Label>
                    <Input
                      id={`offer-${index}-eta`}
                      type="datetime-local"
                      {...form.register(`flights.${index}.eta`)}
                    />
                    <FieldError>{errors?.eta?.message}</FieldError>
                  </div>
                  <div>
                    <Label htmlFor={`offer-${index}-aircraft`}>
                      Aircraft (optional)
                    </Label>
                    <Input
                      id={`offer-${index}-aircraft`}
                      placeholder="A320"
                      maxLength={20}
                      className="uppercase"
                      {...form.register(`flights.${index}.aircraftType`)}
                    />
                    <FieldError>{errors?.aircraftType?.message}</FieldError>
                  </div>
                </div>
              </fieldset>
            );
          })}
        </div>
        {conflict ? (
          <p
            role="alert"
            className="mt-4 rounded-[2px] bg-amber-50 p-3 text-sm text-amber-900"
          >
            {conflict}
          </p>
        ) : null}
        {mutation.isError && !conflict ? (
          <p
            role="alert"
            className="mt-4 rounded-[2px] bg-red-50 p-3 text-sm text-red-800"
          >
            {apiErrorMessage(mutation.error)}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            Submitting creates exactly {batchSize} offered flight
            {batchSize === 1 ? "" : "s"}. {flightCount - batchSize} will remain
            for a follow-up batch.
          </p>
          <Button type="submit" disabled={mutation.isPending}>
            <Send aria-hidden className="size-4" />{" "}
            {mutation.isPending ? "Offering…" : "Offer flight batch"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function emptyFlightRows(count: number): OfferBuilderValues["flights"] {
  return Array.from({ length: count }, emptyFlightRow);
}

function emptyFlightRow(): OfferBuilderValues["flights"][number] {
  return {
    flightNumber: "",
    depIcao: "",
    arrIcao: "",
    etd: "",
    eta: "",
    aircraftType: "",
  };
}
