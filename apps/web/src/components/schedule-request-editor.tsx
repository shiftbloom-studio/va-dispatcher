"use client";

import { useQuery } from "@tanstack/react-query";

import { ScheduleRequestForm } from "@/components/schedule-request-form";
import { PageHeading } from "@/components/page-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { apiErrorMessage } from "@/lib/api/http";
import { scheduleRequestDetailResponseSchema } from "@/lib/api/schemas";
import { useApi } from "@/lib/api/use-api";
import Link from "next/link";

export function ScheduleRequestEditor({
  slug,
  requestId,
}: {
  slug: string;
  requestId: string;
}) {
  const api = useApi();
  const request = useQuery({
    queryKey: [slug, "schedule-request", requestId],
    queryFn: () =>
      api(`/schedule-requests/${requestId}`, {
        schema: scheduleRequestDetailResponseSchema,
      }),
  });

  if (request.isPending)
    return <LoadingState label="Loading schedule request editor" />;
  if (request.isError) {
    return (
      <ErrorState
        message={apiErrorMessage(request.error)}
        onRetry={() => void request.refetch()}
      />
    );
  }

  if (request.data.request.status !== "pending") {
    return (
      <>
        <PageHeading
          eyebrow="Pilot portal"
          title="Schedule request locked"
          description="Dispatch has started working on this request, so its availability and requested flight count can no longer be edited."
        />
        <Card className="max-w-2xl p-5">
          <p className="text-sm leading-6 text-slate-700">
            Review the current request, or cancel it using an explicit linked
            flight outcome and submit a new request if your availability has
            changed.
          </p>
          <Link
            className="mt-4 inline-block"
            href={`/${slug}/portal/schedule-requests/${requestId}`}
          >
            <Button>Back to request</Button>
          </Link>
        </Card>
      </>
    );
  }

  return <ScheduleRequestForm slug={slug} request={request.data.request} />;
}
