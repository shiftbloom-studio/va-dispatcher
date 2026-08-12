"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlaneTakeoff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  FieldError,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui/fields";
import { apiErrorMessage } from "@/lib/api/http";
import { flightResponseSchema, type Member } from "@/lib/api/schemas";
import { jsonBody, useApi } from "@/lib/api/use-api";
import {
  flightFormSchema,
  type FlightFormValues,
} from "@/lib/flight-form-schema";
import { memberLabel } from "@/lib/member";
import { utcInputToIso } from "@/lib/utc";

export function AdHocFlightForm({
  slug,
  members,
}: {
  slug: string;
  members: Member[];
}) {
  const api = useApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<FlightFormValues>({
    resolver: zodResolver(flightFormSchema),
    defaultValues: {
      pilotMembershipId: "",
      flightNumber: "",
      depIcao: "",
      arrIcao: "",
      etd: "",
      eta: "",
      aircraftType: "",
      dispatcherNotes: "",
      status: "draft",
    },
  });
  const mutation = useMutation({
    mutationFn: (values: FlightFormValues) =>
      api("/flights", {
        method: "POST",
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
          status: values.status,
        }),
      }),
    onSuccess: async ({ flight }) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: [slug, "dispatch", "flights"],
        }),
        queryClient.invalidateQueries({
          queryKey: [slug, "dispatch", "board"],
        }),
      ]);
      router.push(`/${slug}/dispatch/flights/${flight.id}`);
    },
  });

  return (
    <form
      onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      noValidate
      className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4"
    >
      <div className="md:col-span-2">
        <Label htmlFor="adhoc-pilot">Pilot (required when offered)</Label>
        <Select id="adhoc-pilot" {...form.register("pilotMembershipId")}>
          <option value="">Unassigned draft</option>
          {members
            .filter(
              (member) => member.role === "pilot" && member.status === "active",
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
        <Label htmlFor="adhoc-number">Flight number</Label>
        <Input
          id="adhoc-number"
          className="uppercase"
          maxLength={12}
          placeholder="SK1234"
          {...form.register("flightNumber")}
        />
        <FieldError>{form.formState.errors.flightNumber?.message}</FieldError>
      </div>
      <div>
        <Label htmlFor="adhoc-status">Initial status</Label>
        <Select id="adhoc-status" {...form.register("status")}>
          <option value="draft">Draft</option>
          <option value="offered">Offered</option>
        </Select>
      </div>
      <div>
        <Label htmlFor="adhoc-dep">Departure ICAO</Label>
        <Input
          id="adhoc-dep"
          className="uppercase"
          maxLength={4}
          placeholder="EKCH"
          {...form.register("depIcao")}
        />
        <FieldError>{form.formState.errors.depIcao?.message}</FieldError>
      </div>
      <div>
        <Label htmlFor="adhoc-arr">Arrival ICAO</Label>
        <Input
          id="adhoc-arr"
          className="uppercase"
          maxLength={4}
          placeholder="ENGM"
          {...form.register("arrIcao")}
        />
        <FieldError>{form.formState.errors.arrIcao?.message}</FieldError>
      </div>
      <div>
        <Label htmlFor="adhoc-etd">ETD (UTC)</Label>
        <Input id="adhoc-etd" type="datetime-local" {...form.register("etd")} />
        <FieldError>{form.formState.errors.etd?.message}</FieldError>
      </div>
      <div>
        <Label htmlFor="adhoc-eta">ETA (UTC)</Label>
        <Input id="adhoc-eta" type="datetime-local" {...form.register("eta")} />
        <FieldError>{form.formState.errors.eta?.message}</FieldError>
      </div>
      <div>
        <Label htmlFor="adhoc-aircraft">Aircraft (optional)</Label>
        <Input
          id="adhoc-aircraft"
          className="uppercase"
          maxLength={20}
          placeholder="A320"
          {...form.register("aircraftType")}
        />
        <FieldError>{form.formState.errors.aircraftType?.message}</FieldError>
      </div>
      <div className="md:col-span-2 xl:col-span-3">
        <Label htmlFor="adhoc-notes">Dispatcher notes (optional)</Label>
        <Textarea
          id="adhoc-notes"
          className="min-h-20"
          maxLength={2000}
          {...form.register("dispatcherNotes")}
        />
        <FieldError>
          {form.formState.errors.dispatcherNotes?.message}
        </FieldError>
      </div>
      <div className="flex items-end">
        <Button type="submit" className="w-full" disabled={mutation.isPending}>
          <PlaneTakeoff aria-hidden className="size-4" />{" "}
          {mutation.isPending ? "Creating…" : "Create flight"}
        </Button>
      </div>
      {mutation.isError ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-800 md:col-span-2 xl:col-span-4"
        >
          {apiErrorMessage(mutation.error)}
        </p>
      ) : null}
    </form>
  );
}
