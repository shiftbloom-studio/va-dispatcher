"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Ban,
  CheckCheck,
  ClipboardCheck,
  Pencil,
  Play,
  Radio,
  Send,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { ConfirmAction, ReasonAction } from "@/components/action-dialog";
import { PageHeading } from "@/components/page-heading";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import {
  FieldError,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui/fields";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ApiError, apiErrorMessage } from "@/lib/api/http";
import {
  flightResponseSchema,
  membersSchema,
  type Flight,
  type Member,
} from "@/lib/api/schemas";
import { jsonBody, useApi } from "@/lib/api/use-api";
import {
  flightEditFormSchema,
  type FlightEditFormValues,
} from "@/lib/flight-form-schema";
import { memberLabel } from "@/lib/member";
import { flightActions } from "@/lib/status";
import { formatUtc, isoToUtcInput, utcInputToIso } from "@/lib/utc";

type DispatchTransition =
  "offer" | "briefed" | "active" | "completed" | "cancelled";

export function DispatcherFlightDetail({
  slug,
  flightId,
}: {
  slug: string;
  flightId: string;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const flight = useQuery({
    queryKey: [slug, "flight", flightId],
    queryFn: () =>
      api(`/flights/${flightId}`, { schema: flightResponseSchema }),
  });
  const members = useQuery({
    queryKey: [slug, "members"],
    queryFn: () => api("/members", { schema: membersSchema }),
    staleTime: Number.POSITIVE_INFINITY,
  });

  async function refreshAll(message?: string) {
    await Promise.all([
      flight.refetch(),
      queryClient.invalidateQueries({ queryKey: [slug, "dispatch", "board"] }),
      queryClient.invalidateQueries({
        queryKey: [slug, "dispatch", "flights"],
      }),
    ]);
    if (message) setNotice(message);
  }

  const transition = useMutation({
    mutationFn: ({
      target,
      reason,
    }: {
      target: DispatchTransition;
      reason?: string;
    }) => {
      if (target === "offer")
        return api(`/flights/${flightId}/offer`, {
          method: "POST",
          schema: flightResponseSchema,
        });
      return api(`/flights/${flightId}/status`, {
        method: "POST",
        schema: flightResponseSchema,
        ...jsonBody({ status: target, reason: reason || undefined }),
      });
    },
    onSuccess: () =>
      refreshAll("Flight state updated from the latest server record."),
  });

  async function advance(target: DispatchTransition, reason?: string) {
    setNotice(null);
    try {
      await transition.mutateAsync({ target, reason });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await refreshAll(
          "This flight changed while you were viewing it. Current state reloaded.",
        );
      }
      throw error;
    }
  }

  if (flight.isPending || members.isPending)
    return <LoadingState label="Loading dispatcher flight workspace" />;
  if (flight.isError || members.isError)
    return (
      <ErrorState
        message={apiErrorMessage(flight.error ?? members.error)}
        onRetry={() => void Promise.all([flight.refetch(), members.refetch()])}
      />
    );

  const item = flight.data.flight;
  const actions = flightActions("dispatcher", item.status);
  const pilot = members.data.items.find(
    (member) => member.id === item.pilotMembershipId,
  );

  return (
    <>
      <Link
        href={`/${slug}/dispatch?view=flights`}
        className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-950"
      >
        <ArrowLeft aria-hidden className="size-4" /> Back to flights
      </Link>
      <PageHeading
        eyebrow="Dispatcher flight"
        title={item.flightNumber}
        description={`${memberLabel(pilot)} · ${item.depIcao} to ${item.arrIcao}`}
        action={<StatusBadge status={item.status} />}
      />
      {notice ? (
        <p
          role="status"
          className="mb-5 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900"
        >
          {notice}
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <div className="bg-slate-950 p-6 text-white sm:p-8">
              <div className="flex items-center justify-between gap-5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                    ETD
                  </p>
                  <p className="mt-1 font-display text-5xl font-semibold">
                    {item.depIcao}
                  </p>
                  <p className="mt-2 text-sm text-slate-300">
                    {formatUtc(item.etd)}
                  </p>
                </div>
                <div className="flex min-w-16 flex-1 items-center gap-3 text-slate-500">
                  <span className="h-px flex-1 bg-slate-700" />
                  <Radio aria-hidden className="size-6" />
                  <span className="h-px flex-1 bg-slate-700" />
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                    ETA
                  </p>
                  <p className="mt-1 font-display text-5xl font-semibold">
                    {item.arrIcao}
                  </p>
                  <p className="mt-2 text-sm text-slate-300">
                    {formatUtc(item.eta)}
                  </p>
                </div>
              </div>
            </div>
            <dl className="grid gap-px bg-slate-200 sm:grid-cols-3">
              <div className="bg-white p-5">
                <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Aircraft
                </dt>
                <dd className="mt-1 font-semibold">
                  {item.aircraftType || "TBA"}
                </dd>
              </div>
              <div className="bg-white p-5">
                <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Pilot
                </dt>
                <dd className="mt-1 font-semibold">{memberLabel(pilot)}</dd>
              </div>
              <div className="bg-white p-5">
                <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Updated
                </dt>
                <dd className="mt-1 font-semibold">
                  {formatUtc(item.updatedAt)}
                </dd>
              </div>
            </dl>
            {item.dispatcherNotes ? (
              <div className="border-t border-slate-100 p-5">
                <h2 className="font-display text-lg font-semibold">
                  Dispatcher notes
                </h2>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                  {item.dispatcherNotes}
                </p>
              </div>
            ) : null}
            {item.declinedReason ? (
              <div className="border-t border-slate-100 bg-red-50 p-5 text-sm text-red-900">
                <strong>Pilot decline reason:</strong> {item.declinedReason}
              </div>
            ) : null}
            {item.cancelReason ? (
              <div className="border-t border-slate-100 bg-red-50 p-5 text-sm text-red-900">
                <strong>Cancellation reason:</strong> {item.cancelReason}
              </div>
            ) : null}
          </Card>
          {editing ? (
            <FlightEditor
              flight={item}
              members={members.data.items}
              onClose={() => setEditing(false)}
              onRefresh={refreshAll}
            />
          ) : null}
        </div>

        <Card className="h-fit overflow-hidden">
          <CardHeader
            title="Operational actions"
            description="State changes are explicit and never drag-and-drop."
          />
          <div className="space-y-3 p-5">
            {actions.includes("edit") ? (
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => setEditing((value) => !value)}
              >
                <Pencil aria-hidden className="size-4" />{" "}
                {editing ? "Close editor" : "Edit flight"}
              </Button>
            ) : null}
            {actions.includes("offer") ? (
              <Button
                className="w-full"
                disabled={transition.isPending}
                onClick={() => void advance("offer").catch(() => undefined)}
              >
                <Send aria-hidden className="size-4" /> Offer to pilot
              </Button>
            ) : null}
            {actions.includes("brief") ? (
              <Button
                className="w-full"
                disabled={transition.isPending}
                onClick={() => void advance("briefed").catch(() => undefined)}
              >
                <ClipboardCheck aria-hidden className="size-4" /> Mark briefed
              </Button>
            ) : null}
            {actions.includes("activate") ? (
              <Button
                className="w-full"
                disabled={transition.isPending}
                onClick={() => void advance("active").catch(() => undefined)}
              >
                <Play aria-hidden className="size-4" /> Activate flight
              </Button>
            ) : null}
            {actions.includes("complete") ? (
              <ConfirmAction
                trigger={
                  <Button className="w-full">
                    <CheckCheck aria-hidden className="size-4" /> Complete
                    flight
                  </Button>
                }
                title="Complete this flight?"
                detail="Completion is terminal and cannot be reversed from the dispatcher UI."
                confirmLabel="Complete flight"
                onConfirm={() => advance("completed")}
              />
            ) : null}
            {actions.includes("cancel") ? (
              <ReasonAction
                trigger={
                  <Button variant="secondary" className="w-full text-red-700">
                    <Ban aria-hidden className="size-4" /> Cancel flight
                  </Button>
                }
                title="Cancel this flight?"
                detail="Cancellation is terminal. Add an optional operational reason."
                confirmLabel="Cancel flight"
                danger
                onConfirm={(reason) => advance("cancelled", reason)}
              />
            ) : null}
            {!actions.length ? (
              <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                This terminal flight is read-only.
              </p>
            ) : null}
            {transition.isError &&
            !(
              transition.error instanceof ApiError &&
              transition.error.status === 409
            ) ? (
              <p
                role="alert"
                className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
              >
                {apiErrorMessage(transition.error)}
              </p>
            ) : null}
          </div>
        </Card>
      </div>
    </>
  );
}

function FlightEditor({
  flight,
  members,
  onClose,
  onRefresh,
}: {
  flight: Flight;
  members: Member[];
  onClose: () => void;
  onRefresh: (message?: string) => Promise<void>;
}) {
  const api = useApi();
  const form = useForm<FlightEditFormValues>({
    resolver: zodResolver(flightEditFormSchema),
    defaultValues: valuesFromFlight(flight),
  });
  useEffect(() => form.reset(valuesFromFlight(flight)), [flight, form]);
  const mutation = useMutation({
    mutationFn: (values: FlightEditFormValues) =>
      api(`/flights/${flight.id}`, {
        method: "PATCH",
        schema: flightResponseSchema,
        ...jsonBody({
          pilotMembershipId: values.pilotMembershipId || null,
          flightNumber: values.flightNumber.trim().toUpperCase(),
          depIcao: values.depIcao.trim().toUpperCase(),
          arrIcao: values.arrIcao.trim().toUpperCase(),
          etd: utcInputToIso(values.etd),
          eta: utcInputToIso(values.eta),
          aircraftType: values.aircraftType?.trim().toUpperCase() || null,
          dispatcherNotes: values.dispatcherNotes?.trim() || null,
        }),
      }),
    onSuccess: async () => {
      await onRefresh("Flight details saved from the current server record.");
      onClose();
    },
  });

  async function submit(values: FlightEditFormValues) {
    try {
      await mutation.mutateAsync(values);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await onRefresh(
          "This flight changed while you were editing it. Current details reloaded.",
        );
      }
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Edit flight details"
        description="Terminal flights cannot be edited. Times remain UTC / Zulu."
      />
      <form
        onSubmit={form.handleSubmit(submit)}
        noValidate
        className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3"
      >
        <div className="md:col-span-2">
          <Label htmlFor="edit-pilot">Pilot</Label>
          <Select id="edit-pilot" {...form.register("pilotMembershipId")}>
            <option value="">Unassigned</option>
            {members
              .filter(
                (member) =>
                  member.role === "pilot" && member.status === "active",
              )
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {memberLabel(member)}
                </option>
              ))}
          </Select>
          <FieldError>
            {form.formState.errors.pilotMembershipId?.message}
          </FieldError>
        </div>
        <div>
          <Label htmlFor="edit-number">Flight number</Label>
          <Input
            id="edit-number"
            className="uppercase"
            maxLength={12}
            {...form.register("flightNumber")}
          />
          <FieldError>{form.formState.errors.flightNumber?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="edit-dep">Departure ICAO</Label>
          <Input
            id="edit-dep"
            className="uppercase"
            maxLength={4}
            {...form.register("depIcao")}
          />
          <FieldError>{form.formState.errors.depIcao?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="edit-arr">Arrival ICAO</Label>
          <Input
            id="edit-arr"
            className="uppercase"
            maxLength={4}
            {...form.register("arrIcao")}
          />
          <FieldError>{form.formState.errors.arrIcao?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="edit-aircraft">Aircraft</Label>
          <Input
            id="edit-aircraft"
            className="uppercase"
            maxLength={20}
            {...form.register("aircraftType")}
          />
        </div>
        <div>
          <Label htmlFor="edit-etd">ETD (UTC)</Label>
          <Input
            id="edit-etd"
            type="datetime-local"
            {...form.register("etd")}
          />
          <FieldError>{form.formState.errors.etd?.message}</FieldError>
        </div>
        <div>
          <Label htmlFor="edit-eta">ETA (UTC)</Label>
          <Input
            id="edit-eta"
            type="datetime-local"
            {...form.register("eta")}
          />
          <FieldError>{form.formState.errors.eta?.message}</FieldError>
        </div>
        <div className="md:col-span-2 xl:col-span-3">
          <Label htmlFor="edit-notes">Dispatcher notes</Label>
          <Textarea
            id="edit-notes"
            maxLength={2000}
            {...form.register("dispatcherNotes")}
          />
        </div>
        {mutation.isError &&
        !(
          mutation.error instanceof ApiError && mutation.error.status === 409
        ) ? (
          <p
            role="alert"
            className="rounded-lg bg-red-50 p-3 text-sm text-red-800 md:col-span-2 xl:col-span-3"
          >
            {apiErrorMessage(mutation.error)}
          </p>
        ) : null}
        <div className="flex gap-2 md:col-span-2 xl:col-span-3">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save details"}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Discard
          </Button>
        </div>
      </form>
    </Card>
  );
}

function valuesFromFlight(flight: Flight): FlightEditFormValues {
  return {
    pilotMembershipId: flight.pilotMembershipId ?? "",
    flightNumber: flight.flightNumber,
    depIcao: flight.depIcao,
    arrIcao: flight.arrIcao,
    etd: isoToUtcInput(flight.etd),
    eta: isoToUtcInput(flight.eta),
    aircraftType: flight.aircraftType || "",
    dispatcherNotes: flight.dispatcherNotes || "",
  };
}
