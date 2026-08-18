"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MailPlus,
  RefreshCw,
  ScrollText,
  Trash2,
  UserCheck,
  UserX,
  UsersRound,
} from "lucide-react";
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
  memberKickResponseSchema,
  memberUpdateResponseSchema,
  membersSchema,
  organizationInvitationMutationSchema,
  organizationInvitationsSchema,
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
  const syncNeedsAttention = Boolean(
    sync.data &&
    (!sync.data.complete || sync.data.skipped > 0 || sync.data.note),
  );
  const sampledMissingUserIdCount =
    sync.data?.failures.filter((failure) => failure.code === "missing_user_id")
      .length ?? 0;
  const sampledLocalReviewCount =
    sync.data?.failures.filter(
      (failure) => failure.code === "local_status_requires_review",
    ).length ?? 0;
  const sampledOtherSyncIssueCount = Math.max(
    0,
    (sync.data?.failures.length ?? 0) -
      sampledMissingUserIdCount -
      sampledLocalReviewCount,
  );

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

      <InvitationManager slug={slug} />
      <ApplicationQueue slug={slug} />

      <Card className="mb-6 overflow-hidden">
        <CardHeader
          title="Directory controls"
          description="Sync pages accepted Clerk organization members. Pending invitations are excluded, partial failures require review, and absent Clerk members are never disabled automatically."
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
            role={syncNeedsAttention ? "alert" : "status"}
            className={`mx-5 mb-5 rounded-lg p-3 text-sm ${
              syncNeedsAttention
                ? "bg-amber-50 text-amber-950"
                : "bg-emerald-50 text-emerald-900"
            }`}
          >
            {sync.data.note
              ? sync.data.note
              : syncNeedsAttention
                ? "Directory sync needs attention."
                : "Directory sync complete."}{" "}
            {sync.data.seen} seen, {sync.data.created} created,{" "}
            {sync.data.updated} updated, {sync.data.unchanged} unchanged,{" "}
            {sync.data.skipped} skipped, {sync.data.failed} failed.
            {sync.data.failures.length > 0
              ? " Issue details are a bounded sample."
              : ""}
            {sampledMissingUserIdCount > 0
              ? ` The sample includes ${sampledMissingUserIdCount} ${sampledMissingUserIdCount === 1 ? "entry" : "entries"} Clerk returned without a user ID; none was written.`
              : ""}
            {sampledLocalReviewCount > 0
              ? ` The sample includes ${sampledLocalReviewCount} local ${sampledLocalReviewCount === 1 ? "membership that needs explicit application or disabled-member review and was not reactivated" : "memberships that need explicit application or disabled-member review and were not reactivated"}. Use the Status filter to review Invited and Disabled members.`
              : ""}
            {sampledOtherSyncIssueCount > 0
              ? ` The sample includes ${sampledOtherSyncIssueCount} additional ${sampledOtherSyncIssueCount === 1 ? "sync issue" : "sync issues"}; no failed item was written.`
              : ""}
            {!sync.data.summaryAuditRecorded && !sync.data.note
              ? " The aggregate summary audit could not be recorded; completed member changes remain applied and individually audited."
              : ""}
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
          {members.data.items.map((member) =>
            member.status === "invited" ? (
              <Card key={member.id} className="overflow-hidden">
                <CardHeader
                  title={member.displayName ?? "Unnamed applicant"}
                  description="Pending application — use the review queue above to approve or reject this request."
                  action={
                    <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-900">
                      {member.requestedRole ?? "pilot"}
                    </span>
                  }
                />
              </Card>
            ) : (
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
            ),
          )}
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

function InvitationManager({ slug }: { slug: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [emailAddress, setEmailAddress] = useState("");
  const [role, setRole] = useState<"pilot" | "dispatcher">("pilot");
  const [offset, setOffset] = useState(0);
  const invitationPageSize = 50;
  const invitations = useQuery({
    queryKey: [slug, "organization-invitations", offset],
    queryFn: () =>
      api(
        `/members/invitations?limit=${invitationPageSize}${offset ? `&offset=${offset}` : ""}`,
        { schema: organizationInvitationsSchema },
      ),
  });
  const create = useMutation({
    mutationFn: () =>
      api("/members/invitations", {
        method: "POST",
        schema: organizationInvitationMutationSchema,
        ...jsonBody({ emailAddress: emailAddress.trim(), role }),
      }),
    onSuccess: () => {
      setEmailAddress("");
      setOffset(0);
      void queryClient.invalidateQueries({
        queryKey: [slug, "organization-invitations"],
      });
    },
  });
  const revoke = useMutation({
    mutationFn: (invitationId: string) =>
      api(`/members/invitations/${invitationId}`, {
        method: "DELETE",
        schema: organizationInvitationMutationSchema,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: [slug, "organization-invitations"],
      }),
  });
  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader
        title="Invite pilots and dispatchers"
        description="Clerk sends a tenant invitation. After acceptance, VA Dispatch can create a member when no local application or disabled record already exists."
        action={<MailPlus aria-hidden className="size-5 text-slate-700" />}
      />
      <form
        className="grid gap-4 border-b border-slate-200 p-5 md:grid-cols-[minmax(14rem,1fr)_12rem_auto] md:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          revoke.reset();
          create.mutate();
        }}
      >
        <div>
          <Label htmlFor="invitation-email">Email address</Label>
          <Input
            id="invitation-email"
            type="email"
            required
            autoComplete="email"
            maxLength={320}
            value={emailAddress}
            onChange={(event) => setEmailAddress(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="invitation-role">Tenant role</Label>
          <Select
            id="invitation-role"
            value={role}
            onChange={(event) =>
              setRole(event.target.value as "pilot" | "dispatcher")
            }
          >
            <option value="pilot">Pilot</option>
            <option value="dispatcher">Dispatcher</option>
          </Select>
        </div>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Sending…" : "Send invitation"}
        </Button>
      </form>
      <div className="p-5">
        <p className="mb-4 text-sm leading-6 text-slate-600">
          Pending tenant invitations are not organization members and cannot be
          imported by directory sync. After acceptance, first tenant access or
          directory sync creates a new local member; an existing Invited or
          Disabled record requires explicit administrator review. An
          account-only invitation sent from Clerk Dashboard must instead be
          followed by a request at{" "}
          <code className="font-semibold text-slate-800">/{slug}/join</code> and
          administrator approval.
        </p>
        <h3 className="text-sm font-bold text-slate-950">
          Pending invitations
        </h3>
        {invitations.isError ? (
          <p
            role="alert"
            className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800"
          >
            {invitations.data
              ? "Pending invitations could not be refreshed; the last known list remains visible. "
              : "Invitations could not be loaded. "}
            {apiErrorMessage(invitations.error)}
          </p>
        ) : null}
        {invitations.isPending ? (
          <p className="mt-3 text-sm text-slate-600">Loading invitations…</p>
        ) : invitations.data?.items.length ? (
          <ul className="mt-3 divide-y divide-slate-200 border-y border-slate-200">
            {invitations.data.items.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-semibold text-slate-950">
                    {invitation.emailAddress}
                  </p>
                  <p className="text-sm text-slate-600">
                    {invitation.role.replace(/^org:/, "")} · expires{" "}
                    {new Date(invitation.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Revoke invitation for ${invitation.emailAddress}`}
                  disabled={revoke.isPending}
                  onClick={() => {
                    create.reset();
                    revoke.mutate(invitation.id);
                  }}
                >
                  <Trash2 aria-hidden className="size-4" /> Revoke
                </Button>
              </li>
            ))}
          </ul>
        ) : invitations.data ? (
          <p className="mt-3 text-sm text-slate-600">
            No invitations are waiting for acceptance.
          </p>
        ) : null}
        {invitations.data && invitations.data.totalCount > 0 ? (
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              Showing {offset + 1}–
              {Math.min(
                offset + invitations.data.items.length,
                invitations.data.totalCount,
              )}{" "}
              of {invitations.data.totalCount}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={offset === 0}
                onClick={() =>
                  setOffset((current) =>
                    Math.max(0, current - invitationPageSize),
                  )
                }
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={
                  offset + invitations.data.items.length >=
                  invitations.data.totalCount
                }
                onClick={() =>
                  setOffset((current) => current + invitationPageSize)
                }
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
        {create.error ? (
          <p
            role="alert"
            className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800"
          >
            {invitationMutationError("send", create.error)}
          </p>
        ) : null}
        {revoke.error ? (
          <p
            role="alert"
            className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800"
          >
            {invitationMutationError("revoke", revoke.error)}
          </p>
        ) : null}
        {create.data ? (
          <p
            role={create.data.auditRecorded ? "status" : "alert"}
            className={`mt-3 rounded-lg p-3 text-sm ${
              create.data.auditRecorded
                ? "bg-emerald-50 text-emerald-900"
                : "bg-amber-50 text-amber-950"
            }`}
          >
            Invitation sent. It remains pending until the recipient accepts it;
            first tenant access or directory sync then creates a new local
            member unless an Invited or Disabled record already requires
            administrator review.
            {!create.data.auditRecorded
              ? " Clerk applied the change, but its application audit could not be recorded. Refresh pending invitations and inspect Audit history; do not retry blindly."
              : ""}
          </p>
        ) : null}
        {revoke.data ? (
          <p
            role={revoke.data.auditRecorded ? "status" : "alert"}
            className={`mt-3 rounded-lg p-3 text-sm ${
              revoke.data.auditRecorded
                ? "bg-emerald-50 text-emerald-900"
                : "bg-amber-50 text-amber-950"
            }`}
          >
            Invitation revoked.
            {!revoke.data.auditRecorded
              ? " Clerk applied the change, but its application audit could not be recorded. Refresh pending invitations and inspect Audit history; do not retry blindly."
              : ""}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function invitationMutationError(
  action: "send" | "revoke",
  error: unknown,
): string {
  const detail = apiErrorMessage(error);
  const definitiveFailure =
    error instanceof ApiError &&
    error.code !== "INVALID_RESPONSE" &&
    error.status >= 400 &&
    error.status < 500;

  if (definitiveFailure) {
    return action === "send"
      ? `Invitation was not sent. ${detail}`
      : `Invitation was not revoked. ${detail}`;
  }

  return `Could not confirm whether Clerk ${action === "send" ? "sent" : "revoked"} the invitation. ${detail} Refresh pending invitations before retrying.`;
}

function ApplicationQueue({ slug }: { slug: string }) {
  const api = useApi();
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([
    null,
  ]);
  const cursor = cursorHistory.at(-1) ?? null;
  const applications = useQuery({
    queryKey: [slug, "membership-applications", cursor],
    queryFn: () =>
      api(
        `/members?status=invited&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        { schema: membersSchema },
      ),
  });

  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader
        title="Membership applications"
        description="Applicants remain outside the tenant until an administrator approves a pilot or dispatcher role."
        action={<UserCheck aria-hidden className="size-5 text-slate-700" />}
      />
      <div className="space-y-4 p-5">
        {applications.isPending ? (
          <p className="text-sm text-slate-600">Loading applications…</p>
        ) : applications.isError ? (
          <p
            role="alert"
            className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
          >
            {apiErrorMessage(applications.error)}
          </p>
        ) : applications.data.items.length ? (
          applications.data.items.map((member) => (
            <ApplicationDecision key={member.id} slug={slug} member={member} />
          ))
        ) : (
          <p className="text-sm text-slate-600">
            No applications are waiting for review.
          </p>
        )}
        {applications.data ? (
          <div className="flex justify-between gap-3 border-t border-slate-200 pt-4">
            <Button
              size="sm"
              variant="secondary"
              disabled={cursorHistory.length === 1}
              onClick={() =>
                setCursorHistory((history) => history.slice(0, -1))
              }
            >
              Previous applications
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!applications.data.nextCursor}
              onClick={() => {
                if (applications.data.nextCursor) {
                  setCursorHistory((history) => [
                    ...history,
                    applications.data.nextCursor,
                  ]);
                }
              }}
            >
              Next applications
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function ApplicationDecision({
  slug,
  member,
}: {
  slug: string;
  member: Member;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [role, setRole] = useState<"pilot" | "dispatcher">(
    member.requestedRole === "dispatcher" ? "dispatcher" : "pilot",
  );
  const [replacementId, setReplacementId] = useState("");
  const outstanding =
    (member.openFlightCount ?? 0) + (member.openScheduleRequestCount ?? 0);
  const replacementRequired = role !== "pilot" && outstanding > 0;
  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: [slug, "membership-applications"],
    });
    void queryClient.invalidateQueries({ queryKey: [slug, "admin-members"] });
  };
  const approve = useMutation({
    mutationFn: () =>
      api(`/members/${member.id}/application/approve`, {
        method: "POST",
        schema: memberUpdateResponseSchema,
        ...jsonBody({
          role,
          ...(replacementId ? { reassignToMembershipId: replacementId } : {}),
        }),
      }),
    onSuccess: refresh,
  });
  const reject = useMutation({
    mutationFn: () =>
      api(`/members/${member.id}/application/reject`, {
        method: "POST",
        schema: memberUpdateResponseSchema,
      }),
    onSuccess: refresh,
  });
  const error = approve.error ?? reject.error;

  return (
    <div className="border border-slate-200 p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-950">
            {member.displayName ?? "Unnamed applicant"}
          </p>
          <p className="break-all text-sm text-slate-600">
            Clerk user {member.clerkUserId}
          </p>
        </div>
        <div className="w-full lg:w-48">
          <Label htmlFor={`application-role-${member.id}`}>Approved role</Label>
          <Select
            id={`application-role-${member.id}`}
            value={role}
            onChange={(event) =>
              setRole(event.target.value as "pilot" | "dispatcher")
            }
          >
            <option value="pilot">Pilot</option>
            <option value="dispatcher">Dispatcher</option>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button
            disabled={
              approve.isPending ||
              reject.isPending ||
              (replacementRequired && !replacementId)
            }
            onClick={() => approve.mutate()}
          >
            <UserCheck aria-hidden className="size-4" /> Approve
          </Button>
          <Button
            variant="secondary"
            disabled={approve.isPending || reject.isPending}
            onClick={() => reject.mutate()}
          >
            <UserX aria-hidden className="size-4" /> Reject
          </Button>
        </div>
      </div>
      {replacementRequired ? (
        <div className="mt-4">
          <Label htmlFor={`application-replacement-${member.id}`}>
            Replacement active pilot membership UUID
          </Label>
          <Input
            id={`application-replacement-${member.id}`}
            value={replacementId}
            onChange={(event) => setReplacementId(event.target.value)}
            required
          />
          <p className="mt-1 text-sm text-slate-600">
            This returning member still owns {outstanding} open item(s), which
            must be reassigned before approving a dispatcher role.
          </p>
        </div>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          {apiErrorMessage(error)}
        </p>
      ) : null}
    </div>
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
  const kickNeedsReplacement =
    member.status !== "disabled" && member.role === "pilot" && outstanding > 0;
  const showReplacement =
    outstanding > 0 && (makesIneligible || kickNeedsReplacement);
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
  const kick = useMutation({
    mutationFn: () =>
      api(`/members/${member.id}`, {
        method: "DELETE",
        schema: memberKickResponseSchema,
        ...jsonBody({
          ...(replacementId ? { reassignToMembershipId: replacementId } : {}),
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
        {showReplacement ? (
          <div className="md:col-span-2 xl:col-span-3">
            <Label htmlFor={`member-replacement-${member.id}`}>
              Replacement active pilot
            </Label>
            <Input
              id={`member-replacement-${member.id}`}
              list={`member-replacements-${member.id}`}
              value={replacementId}
              required={makesIneligible}
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
            {!mutation.data.clerkSynchronized
              ? " Clerk synchronization is still required."
              : ""}
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
        <div className="border-t border-slate-200 pt-4 md:col-span-2 xl:col-span-5">
          <Button
            variant="danger"
            disabled={
              mutation.isPending ||
              kick.isPending ||
              (kickNeedsReplacement && !replacementId)
            }
            onClick={() => {
              if (
                window.confirm(
                  "Remove this person from the Clerk organization and disable their VA Dispatch membership?",
                )
              ) {
                kick.mutate();
              }
            }}
          >
            <UserX aria-hidden className="size-4" />
            {kick.isPending ? "Removing…" : "Remove from organization"}
          </Button>
          {kick.data ? (
            <p
              role={kick.data.clerkSynchronized ? "status" : "alert"}
              className={`mt-3 rounded-lg p-3 text-sm ${
                kick.data.clerkSynchronized
                  ? "bg-emerald-50 text-emerald-900"
                  : "bg-amber-50 text-amber-950"
              }`}
            >
              {kick.data.clerkSynchronized
                ? "Member removed from the organization and disabled locally."
                : "VA Dispatch access is disabled, but Clerk removal failed. Retry this action to finish synchronization."}
            </p>
          ) : null}
          {kick.error ? (
            <p
              role="alert"
              className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800"
            >
              {apiErrorMessage(kick.error)}
            </p>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
