"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm } from "react-hook-form";

import { PageHeading } from "@/components/page-heading";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import {
  FieldError,
  HelpText,
  Input,
  Label,
  Textarea,
} from "@/components/ui/fields";
import { apiErrorMessage } from "@/lib/api/http";
import { scheduleRequestResponseSchema } from "@/lib/api/schemas";
import { jsonBody, useApi } from "@/lib/api/use-api";
import {
  scheduleRequestFormSchema,
  type ScheduleRequestFormValues,
} from "@/lib/schedule-form-schema";
import { utcInputToIso } from "@/lib/utc";

export function ScheduleRequestForm({ slug }: { slug: string }) {
  const api = useApi();
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<ScheduleRequestFormValues>({
    resolver: zodResolver(scheduleRequestFormSchema),
    defaultValues: {
      title: "",
      notes: "",
      desiredFlightCount: 1,
      availability: [{ startAt: "", endAt: "" }],
    },
  });
  const intervals = useFieldArray({
    control: form.control,
    name: "availability",
  });
  const mutation = useMutation({
    mutationFn: async (values: ScheduleRequestFormValues) => {
      const availability = values.availability
        .map((interval) => ({
          startAt: utcInputToIso(interval.startAt),
          endAt: utcInputToIso(interval.endAt),
        }))
        .sort((left, right) => left.startAt.localeCompare(right.startAt));
      return api("/schedule-requests", {
        method: "POST",
        schema: scheduleRequestResponseSchema,
        ...jsonBody({
          title: values.title || null,
          notes: values.notes || null,
          desiredFlightCount: values.desiredFlightCount,
          windowStart: availability[0].startAt,
          windowEnd: availability.at(-1)!.endAt,
          preferences: { availability },
        }),
      });
    },
    onSuccess: async ({ request }) => {
      await queryClient.invalidateQueries({
        queryKey: [slug, "pilot", "schedule-requests"],
      });
      router.push(`/${slug}/portal/schedule-requests/${request.id}`);
    },
  });

  return (
    <>
      <PageHeading
        eyebrow="Pilot portal"
        title="Request a schedule"
        description="Tell dispatch how many flights you want and when you are available. Every date and time below is UTC / Zulu."
      />
      <form
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        noValidate
      >
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Card className="overflow-hidden">
            <CardHeader
              title="Availability"
              description="Add one or more non-overlapping UTC intervals."
            />
            <div className="space-y-4 p-5">
              {intervals.fields.map((field, index) => {
                const startError =
                  form.formState.errors.availability?.[index]?.startAt?.message;
                const endError =
                  form.formState.errors.availability?.[index]?.endAt?.message;
                return (
                  <fieldset
                    key={field.id}
                    className="rounded-xl border border-slate-200 p-4"
                  >
                    <legend className="px-1 text-sm font-bold text-slate-700">
                      Interval {index + 1}
                    </legend>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <Label htmlFor={`availability-${index}-start`}>
                          Start (UTC)
                        </Label>
                        <Input
                          id={`availability-${index}-start`}
                          type="datetime-local"
                          aria-describedby={
                            startError
                              ? `availability-${index}-start-error`
                              : undefined
                          }
                          aria-invalid={Boolean(startError)}
                          {...form.register(`availability.${index}.startAt`)}
                        />
                        <FieldError id={`availability-${index}-start-error`}>
                          {startError}
                        </FieldError>
                      </div>
                      <div>
                        <Label htmlFor={`availability-${index}-end`}>
                          End (UTC)
                        </Label>
                        <Input
                          id={`availability-${index}-end`}
                          type="datetime-local"
                          aria-describedby={
                            endError
                              ? `availability-${index}-end-error`
                              : undefined
                          }
                          aria-invalid={Boolean(endError)}
                          {...form.register(`availability.${index}.endAt`)}
                        />
                        <FieldError id={`availability-${index}-end-error`}>
                          {endError}
                        </FieldError>
                      </div>
                    </div>
                    {intervals.fields.length > 1 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-3 text-red-700"
                        onClick={() => intervals.remove(index)}
                      >
                        <Trash2 aria-hidden className="size-4" /> Remove
                        interval
                      </Button>
                    ) : null}
                  </fieldset>
                );
              })}
              <Button
                variant="secondary"
                onClick={() => intervals.append({ startAt: "", endAt: "" })}
              >
                <Plus aria-hidden className="size-4" /> Add interval
              </Button>
              <FieldError>
                {form.formState.errors.availability?.root?.message}
              </FieldError>
            </div>
          </Card>

          <div className="space-y-6">
            <Card className="overflow-hidden">
              <CardHeader title="Request details" />
              <div className="space-y-4 p-5">
                <div>
                  <Label htmlFor="desiredFlightCount">Number of flights</Label>
                  <Input
                    id="desiredFlightCount"
                    type="number"
                    min={1}
                    max={50}
                    inputMode="numeric"
                    aria-invalid={Boolean(
                      form.formState.errors.desiredFlightCount,
                    )}
                    {...form.register("desiredFlightCount", {
                      valueAsNumber: true,
                    })}
                  />
                  <FieldError>
                    {form.formState.errors.desiredFlightCount?.message}
                  </FieldError>
                  <HelpText>
                    Dispatch will propose exactly this many flights.
                  </HelpText>
                </div>
                <div>
                  <Label htmlFor="title">Title (optional)</Label>
                  <Input
                    id="title"
                    placeholder="September regional flying"
                    maxLength={120}
                    {...form.register("title")}
                  />
                  <FieldError>
                    {form.formState.errors.title?.message}
                  </FieldError>
                </div>
                <div>
                  <Label htmlFor="notes">Notes (optional)</Label>
                  <Textarea
                    id="notes"
                    placeholder="Preferred aircraft, routes, or constraints…"
                    maxLength={2000}
                    {...form.register("notes")}
                  />
                  <FieldError>
                    {form.formState.errors.notes?.message}
                  </FieldError>
                </div>
              </div>
            </Card>
            {mutation.isError ? (
              <div
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
              >
                {apiErrorMessage(mutation.error)}
              </div>
            ) : null}
            <div className="flex gap-3">
              <Button
                type="submit"
                disabled={mutation.isPending}
                className="flex-1"
              >
                <CalendarPlus aria-hidden className="size-4" />{" "}
                {mutation.isPending ? "Submitting…" : "Submit request"}
              </Button>
              <Button variant="secondary" onClick={() => router.back()}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </form>
    </>
  );
}
