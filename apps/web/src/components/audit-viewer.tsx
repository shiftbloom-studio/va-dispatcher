"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { PageHeading } from "@/components/page-heading";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/fields";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { apiErrorMessage } from "@/lib/api/http";
import { auditEventPageSchema, auditExportSchema } from "@/lib/api/schemas";
import { useApi } from "@/lib/api/use-api";
import { formatUtc } from "@/lib/utc";

type AuditFilters = {
  action: string;
  entityType: string;
  actorMembershipId: string;
  from: string;
  to: string;
};

const EMPTY_FILTERS: AuditFilters = {
  action: "",
  entityType: "",
  actorMembershipId: "",
  from: "",
  to: "",
};

export function AuditViewer({ slug }: { slug: string }) {
  const api = useApi();
  const [draftFilters, setDraftFilters] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([
    null,
  ]);
  const cursor = cursorHistory.at(-1) ?? null;
  const query = useMemo(
    () => auditQuery(filters, cursor, "50"),
    [cursor, filters],
  );
  const events = useQuery({
    queryKey: [slug, "audit-events", filters, cursor],
    queryFn: () =>
      api(`/audit-events?${query}`, { schema: auditEventPageSchema }),
  });
  const exportEvents = useMutation({
    mutationFn: () =>
      api(`/audit-events/export?${auditQuery(filters, cursor, "500")}`, {
        schema: auditExportSchema,
      }),
    onSuccess: (data) => {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], {
          type: "application/json",
        }),
      );
      const download = document.createElement("a");
      download.href = url;
      download.download = `va-dispatch-audit-${new Date().toISOString().slice(0, 10)}.json`;
      download.click();
      URL.revokeObjectURL(url);
    },
  });

  return (
    <>
      <PageHeading
        eyebrow="Administration"
        title="Audit history"
        description="Review tenant-scoped operational and security changes. Exports are bounded and secret-bearing metadata is redacted by the API."
        action={
          <Link
            href={`/${slug}/admin`}
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            Members
          </Link>
        }
      />

      <Card className="mb-6 p-5">
        <form
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-5"
          onSubmit={(event) => {
            event.preventDefault();
            setFilters(draftFilters);
            setCursorHistory([null]);
          }}
        >
          <AuditInput
            id="audit-action"
            label="Action"
            value={draftFilters.action}
            placeholder="member.updated"
            onChange={(value) =>
              setDraftFilters((current) => ({ ...current, action: value }))
            }
          />
          <AuditInput
            id="audit-entity"
            label="Entity type"
            value={draftFilters.entityType}
            placeholder="membership"
            onChange={(value) =>
              setDraftFilters((current) => ({ ...current, entityType: value }))
            }
          />
          <AuditInput
            id="audit-actor"
            label="Actor membership ID"
            value={draftFilters.actorMembershipId}
            placeholder="UUID"
            onChange={(value) =>
              setDraftFilters((current) => ({
                ...current,
                actorMembershipId: value,
              }))
            }
          />
          <AuditInput
            id="audit-from"
            label="From (UTC)"
            type="datetime-local"
            value={draftFilters.from}
            onChange={(value) =>
              setDraftFilters((current) => ({ ...current, from: value }))
            }
          />
          <AuditInput
            id="audit-to"
            label="To (UTC)"
            type="datetime-local"
            value={draftFilters.to}
            onChange={(value) =>
              setDraftFilters((current) => ({ ...current, to: value }))
            }
          />
          <div className="flex flex-wrap gap-3 md:col-span-2 xl:col-span-5">
            <Button type="submit">Apply filters</Button>
            <Button
              variant="secondary"
              disabled={exportEvents.isPending}
              onClick={() => exportEvents.mutate()}
            >
              <Download aria-hidden className="size-4" />
              {exportEvents.isPending
                ? "Preparing export…"
                : "Export this segment"}
            </Button>
          </div>
          {exportEvents.error ? (
            <p
              role="alert"
              className="rounded-lg bg-red-50 p-3 text-sm text-red-800 md:col-span-2 xl:col-span-5"
            >
              {apiErrorMessage(exportEvents.error)}
            </p>
          ) : null}
        </form>
      </Card>

      {events.isPending ? (
        <LoadingState label="Loading audit history" />
      ) : events.isError ? (
        <ErrorState
          message={apiErrorMessage(events.error)}
          onRetry={() => void events.refetch()}
        />
      ) : events.data.items.length === 0 ? (
        <Card className="p-8 text-center">
          <ShieldCheck aria-hidden className="mx-auto size-8 text-slate-400" />
          <p className="mt-3 font-semibold text-slate-900">
            No audit events match these filters.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {events.data.items.map((event) => (
            <Card key={event.id} className="overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div>
                  <h2 className="font-mono text-sm font-bold text-slate-950">
                    {event.action}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {event.entityType} · {event.entityId}
                  </p>
                </div>
                <time
                  dateTime={event.createdAt}
                  className="text-sm text-slate-600"
                >
                  {formatUtc(event.createdAt)}
                </time>
              </div>
              <div className="grid gap-4 p-5 lg:grid-cols-[14rem_minmax(0,1fr)]">
                <div className="text-sm text-slate-700">
                  <p className="font-semibold text-slate-950">Actor</p>
                  <p className="mt-1">
                    {event.actor?.displayName ??
                      event.actor?.pilotCallsign ??
                      "System or removed member"}
                  </p>
                  {event.actor ? (
                    <p className="mt-1 break-all text-xs text-slate-500">
                      {event.actor.membershipId}
                    </p>
                  ) : null}
                </div>
                <div>
                  <p className="mb-2 text-sm font-semibold text-slate-950">
                    Redacted metadata
                  </p>
                  <pre className="max-h-80 overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-5 text-slate-100">
                    {JSON.stringify(event.meta, null, 2)}
                  </pre>
                </div>
              </div>
            </Card>
          ))}
          <div className="flex justify-between gap-3">
            <Button
              variant="secondary"
              disabled={cursorHistory.length === 1}
              onClick={() =>
                setCursorHistory((history) => history.slice(0, -1))
              }
            >
              Previous page
            </Button>
            <Button
              variant="secondary"
              disabled={!events.data.nextCursor}
              onClick={() => {
                if (events.data.nextCursor) {
                  setCursorHistory((history) => [
                    ...history,
                    events.data.nextCursor,
                  ]);
                }
              }}
            >
              Next page
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function AuditInput({
  id,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        maxLength={120}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function auditQuery(
  filters: AuditFilters,
  cursor: string | null,
  limit: string,
): string {
  const query = new URLSearchParams({ limit });
  if (filters.action.trim()) query.set("action", filters.action.trim());
  if (filters.entityType.trim()) {
    query.set("entityType", filters.entityType.trim());
  }
  if (filters.actorMembershipId.trim()) {
    query.set("actorMembershipId", filters.actorMembershipId.trim());
  }
  if (filters.from) query.set("from", localUtcInputToIso(filters.from));
  if (filters.to) query.set("to", localUtcInputToIso(filters.to));
  if (cursor) query.set("cursor", cursor);
  return query.toString();
}

function localUtcInputToIso(value: string): string {
  return new Date(`${value}:00.000Z`).toISOString();
}
