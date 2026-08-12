"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, ScrollText, UsersRound } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { PageHeading } from "@/components/page-heading";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Label, Select } from "@/components/ui/fields";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ApiError, apiErrorMessage } from "@/lib/api/http";
import {
  memberSyncResponseSchema,
  memberUpdateResponseSchema,
  membersSchema,
  type Member,
} from "@/lib/api/schemas";
import { jsonBody, useApi } from "@/lib/api/use-api";

type Filters = {
  search: string;
  role: "" | Member["role"];
  status: "" | Member["status"];
};

const EMPTY_FILTERS: Filters = { search: "", role: "", status: "" };

export function AdminControlPlane({ slug }: { slug: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [draftFilters, setDraftFilters] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([
    null,
  ]);
  const cursor = cursorHistory.at(-1) ?? null;
  const queryString = useMemo(() => {
    const query = new URLSearchParams({ limit: "50" });
    if (filters.search.trim()) query.set("search", filters.search.trim());
    if (filters.role) query.set("role", filters.role);
    if (filters.status) query.set("status", filters.status);
    if (cursor) query.set("cursor", cursor);
    return query.toString();
  }, [cursor, filters]);

  const members = useQuery({
    queryKey: [slug, "admin-members", filters, cursor],
    queryFn: () => api(`/members?${queryString}`, { schema: membersSchema }),
  });
  const sync = useMutation({
    mutationFn: () =>
      api("/members/sync", {
        method: "POST",
        schema: memberSyncResponseSchema,
      }),
    onSuccess: () => {
      setCursorHistory([null]);
      void queryClient.invalidateQueries({ queryKey: [slug, "admin-members"] });
    },
  });

  return (
    <>
      <PageHeading
        eyebrow="Administration"
        title="Members"
        description="Search the tenant roster, reconcile it with Clerk, and manage application roles, status, ACARS callsigns, and outstanding work safely."
        action={
          <Link
            href={`/${slug}/admin/audit`}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            <ScrollText aria-hidden className="size-4" />
            Audit history
          </Link>
        }
      />

      <Card className="mb-6 overflow-hidden">
        <CardHeader
          title="Directory controls"
          description="Sync pages the complete Clerk organization directory. Partial failures are reported explicitly; absent Clerk members are never disabled automatically."
          action={
            <Button
              variant="secondary"
              disabled={sync.isPending}
              onClick={() => sync.mutate()}
            >
              <RefreshCw
                aria-hidden
                className={`size-4 ${sync.isPending ? "animate-spin" : ""}`}
              />
              {sync.isPending ? "Syncing…" : "Sync Clerk directory"}
            </Button>
          }
        />
        <form
          className="grid gap-4 p-5 md:grid-cols-[minmax(14rem,1fr)_12rem_12rem_auto] md:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            setFilters(draftFilters);
            setCursorHistory([null]);
          }}
        >
          <div>
            <Label htmlFor="member-search">Search members</Label>
            <Input
              id="member-search"
              value={draftFilters.search}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  search: event.target.value,
                }))
              }
              placeholder="Name, callsign, or Clerk user ID"
              maxLength={120}
            />
          </div>
          <div>
            <Label htmlFor="member-role-filter">Role</Label>
            <Select
              id="member-role-filter"
              value={draftFilters.role}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  role: event.target.value as Filters["role"],
                }))
              }
            >
              <option value="">All roles</option>
              <option value="pilot">Pilot</option>
              <option value="dispatcher">Dispatcher</option>
              <option value="admin">Admin</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="member-status-filter">Status</Label>
            <Select
              id="member-status-filter"
              value={draftFilters.status}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  status: event.target.value as Filters["status"],
                }))
              }
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="invited">Invited</option>
              <option value="disabled">Disabled</option>
            </Select>
          </div>
          <Button type="submit">Apply filters</Button>
        </form>
        {sync.data ? (
          <div
            role={sync.data.complete ? "status" : "alert"}
            className={`mx-5 mb-5 rounded-lg p-3 text-sm ${
              sync.data.complete
                ? "bg-emerald-50 text-emerald-900"
                : "bg-amber-50 text-amber-950"
            }`}
          >
            {sync.data.complete
              ? "Directory sync complete."
              : "Directory sync completed with failures."}{" "}
            {sync.data.seen} seen, {sync.data.created} created,{" "}
            {sync.data.updated} updated, {sync.data.unchanged} unchanged,{" "}
            {sync.data.failed} failed.
            {!sync.data.summaryAuditRecorded && !sync.data.note
              ? " The aggregate summary audit could not be recorded; completed member changes remain applied and individually audited."
              : ""}
            {sync.data.note ? ` ${sync.data.note}` : ""}
          </div>
        ) : null}
        {sync.error ? (
          <p
            role="alert"
            className="mx-5 mb-5 rounded-lg bg-red-50 p-3 text-sm text-red-800"
          >
            {apiErrorMessage(sync.error)}
          </p>
        ) : null}
      </Card>

      {members.isPending ? (
        <LoadingState label="Loading members" />
      ) : members.isError ? (
        <ErrorState
          message={apiErrorMessage(members.error)}
          onRetry={() => void members.refetch()}
        />
      ) : members.data.items.length === 0 ? (
        <Card className="p-8 text-center">
          <UsersRound aria-hidden className="mx-auto size-8 text-slate-400" />
          <p className="mt-3 font-semibold text-slate-900">
            No members match these filters.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {members.data.items.map((member) => (
            <MemberEditor
              key={member.id}
              slug={slug}
              member={member}
              replacementOptions={members.data.items.filter(
                (candidate) =>
                  candidate.id !== member.id &&
                  candidate.role === "pilot" &&
                  candidate.status === "active",
              )}
            />
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
              disabled={!members.data.nextCursor}
              onClick={() => {
                if (members.data.nextCursor) {
                  setCursorHistory((history) => [
                    ...history,
                    members.data.nextCursor,
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

function MemberEditor({
  slug,
  member,
  replacementOptions,
}: {
  slug: string;
  member: Member;
  replacementOptions: Member[];
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [role, setRole] = useState(member.role);
  const [status, setStatus] = useState(member.status);
  const [displayName, setDisplayName] = useState(member.displayName ?? "");
  const [pilotCallsign, setPilotCallsign] = useState(
    member.pilotCallsign ?? "",
  );
  const [replacementId, setReplacementId] = useState("");
  const makesIneligible =
    status !== "active" || (member.role === "pilot" && role !== "pilot");
  const outstanding =
    (member.openFlightCount ?? 0) + (member.openScheduleRequestCount ?? 0);
  const mutation = useMutation({
    mutationFn: () =>
      api(`/members/${member.id}`, {
        method: "PATCH",
        schema: memberUpdateResponseSchema,
        ...jsonBody({
          role,
          status,
          displayName: displayName.trim() || null,
          pilotCallsign: pilotCallsign.trim().toUpperCase() || null,
          ...(makesIneligible && replacementId
            ? { reassignToMembershipId: replacementId }
            : {}),
        }),
      }),
    onSuccess: () => {
      setReplacementId("");
      void queryClient.invalidateQueries({ queryKey: [slug, "admin-members"] });
    },
  });
  const conflictDetails =
    mutation.error instanceof ApiError &&
    typeof mutation.error.details === "object" &&
    mutation.error.details !== null
      ? mutation.error.details
      : null;

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={member.displayName ?? member.pilotCallsign ?? "Unnamed member"}
        description={`Clerk user ${member.clerkUserId}`}
        action={
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-slate-700">
            {member.status}
          </span>
        }
      />
      <form
        className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-5"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <div>
          <Label htmlFor={`member-name-${member.id}`}>Display name</Label>
          <Input
            id={`member-name-${member.id}`}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={120}
          />
        </div>
        <div>
          <Label htmlFor={`member-callsign-${member.id}`}>ACARS callsign</Label>
          <Input
            id={`member-callsign-${member.id}`}
            className="uppercase"
            value={pilotCallsign}
            onChange={(event) => setPilotCallsign(event.target.value)}
            maxLength={20}
          />
        </div>
        <div>
          <Label htmlFor={`member-role-${member.id}`}>Role</Label>
          <Select
            id={`member-role-${member.id}`}
            value={role}
            onChange={(event) => setRole(event.target.value as Member["role"])}
          >
            <option value="pilot">Pilot</option>
            <option value="dispatcher">Dispatcher</option>
            <option value="admin">Admin</option>
          </Select>
        </div>
        <div>
          <Label htmlFor={`member-status-${member.id}`}>Status</Label>
          <Select
            id={`member-status-${member.id}`}
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as Member["status"])
            }
          >
            <option value="active">Active</option>
            <option value="invited">Invited</option>
            <option value="disabled">Disabled</option>
          </Select>
        </div>
        <div className="flex items-end">
          <Button
            type="submit"
            disabled={mutation.isPending}
            className="w-full"
          >
            {mutation.isPending ? "Saving…" : "Save member"}
          </Button>
        </div>

        <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700 md:col-span-2 xl:col-span-5">
          Outstanding work: {member.openFlightCount ?? 0}{" "}
          draft/offered/accepted/briefed flight(s),{" "}
          {member.activeFlightCount ?? 0} active flight(s), and{" "}
          {member.openScheduleRequestCount ?? 0} open schedule request(s).
          {(member.terminalRequestLinkedFlightCount ?? 0) > 0
            ? ` ${member.terminalRequestLinkedFlightCount} open flight(s) are linked to terminal request history and block reassignment.`
            : ""}
        </div>
        {makesIneligible && outstanding > 0 ? (
          <div className="md:col-span-2 xl:col-span-3">
            <Label htmlFor={`member-replacement-${member.id}`}>
              Replacement active pilot
            </Label>
            <Input
              id={`member-replacement-${member.id}`}
              list={`member-replacements-${member.id}`}
              value={replacementId}
              required
              onChange={(event) => setReplacementId(event.target.value)}
              placeholder="Active pilot membership UUID"
            />
            <datalist id={`member-replacements-${member.id}`}>
              {replacementOptions.map((replacement) => (
                <option key={replacement.id} value={replacement.id}>
                  {replacement.displayName ??
                    replacement.pilotCallsign ??
                    replacement.id}
                </option>
              ))}
            </datalist>
            <p className="mt-1 text-sm text-slate-500">
              Enter any active pilot membership UUID. Suggestions show active
              pilots on this page. Accepted or briefed flights return to offered
              so the replacement must accept them explicitly. Active flights
              always block this change.
            </p>
          </div>
        ) : null}
        {mutation.data ? (
          <p
            role="status"
            className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 md:col-span-2 xl:col-span-5"
          >
            Member saved. {mutation.data.reassignedFlightCount} flight(s) and{" "}
            {mutation.data.reassignedScheduleRequestCount} request(s)
            reassigned.
          </p>
        ) : null}
        {mutation.error ? (
          <p
            role="alert"
            className="rounded-lg bg-red-50 p-3 text-sm text-red-800 md:col-span-2 xl:col-span-5"
          >
            {apiErrorMessage(mutation.error)}
            {conflictDetails
              ? " Review the outstanding-work counts above."
              : ""}
          </p>
        ) : null}
      </form>
    </Card>
  );
}
