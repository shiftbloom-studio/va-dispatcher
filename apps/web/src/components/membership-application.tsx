"use client";

import { OrganizationList, SignOutButton } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Clock3, ShieldCheck, UserPlus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Label, Select } from "@/components/ui/fields";
import { apiErrorMessage } from "@/lib/api/http";
import { membershipApplicationSchema } from "@/lib/api/schemas";
import { jsonBody, useApi } from "@/lib/api/use-api";

export function MembershipApplication({
  slug,
  tenantName,
}: {
  slug: string;
  tenantName: string;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [requestedRole, setRequestedRole] = useState<"pilot" | "dispatcher">(
    "pilot",
  );
  const queryKey = [slug, "membership-application"] as const;
  const application = useQuery({
    queryKey,
    queryFn: () =>
      api(`/membership-application?tenantSlug=${encodeURIComponent(slug)}`, {
        schema: membershipApplicationSchema,
      }),
  });
  const effectiveRequestedRole = application.data?.allowedRoles.includes(
    requestedRole,
  )
    ? requestedRole
    : (application.data?.allowedRoles[0] ?? requestedRole);
  const submit = useMutation({
    mutationFn: () =>
      api("/membership-application", {
        method: "POST",
        schema: membershipApplicationSchema,
        ...jsonBody({
          tenantSlug: slug,
          requestedRole: effectiveRequestedRole,
        }),
      }),
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
  });
  const cancel = useMutation({
    mutationFn: () =>
      api(`/membership-application?tenantSlug=${encodeURIComponent(slug)}`, {
        method: "DELETE",
        schema: membershipApplicationSchema,
      }),
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
  });

  const state = application.data?.application?.state;
  const busy = submit.isPending || cancel.isPending;
  const error = submit.error ?? cancel.error ?? application.error;

  return (
    <div className="space-y-5">
      <div className="text-center">
        <div className="mx-auto grid size-12 place-items-center bg-[var(--brand-faint)] text-[var(--brand-action)]">
          <ShieldCheck aria-hidden className="size-6" />
        </div>
        <h1 className="mt-4 font-display text-3xl font-semibold">
          Join {tenantName}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Every pilot and dispatcher is approved by a tenant administrator
          before operational data becomes available.
        </p>
      </div>

      {application.isPending ? (
        <Card className="p-5 text-sm text-slate-600">
          Loading your membership status…
        </Card>
      ) : state === "pending" ? (
        <Card className="overflow-hidden">
          <CardHeader
            title="Application pending"
            description={`Your ${application.data?.application?.requestedRole ?? "membership"} request is waiting for manual review.`}
            action={<Clock3 aria-hidden className="size-5 text-amber-700" />}
          />
          <div className="space-y-4 p-5 text-sm leading-6 text-slate-600">
            <p>
              You can return to this page later. Selecting the organization
              below will work as soon as an administrator approves the request.
            </p>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => cancel.mutate()}
            >
              {cancel.isPending ? "Cancelling…" : "Cancel application"}
            </Button>
          </div>
        </Card>
      ) : state === "active" ? (
        <Card className="overflow-hidden">
          <CardHeader
            title="Membership approved"
            description="Select the organization below to open VA Dispatch."
            action={
              <CircleCheck aria-hidden className="size-5 text-emerald-700" />
            }
          />
          <div className="p-5">
            <a
              href={`/${slug}`}
              className="inline-flex min-h-11 items-center bg-[var(--brand-action)] px-4 py-2 text-sm font-semibold text-[var(--brand-on-action)] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              Open VA Dispatch
            </a>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardHeader
            title={
              state === "closed" ? "Request access again" : "Apply for access"
            }
            description={
              state === "closed"
                ? "Your previous access request or membership is closed. A new request requires another administrator review."
                : "Choose the tenant role you need. This choice does not grant access until an administrator approves it."
            }
            action={<UserPlus aria-hidden className="size-5 text-slate-700" />}
          />
          <form
            className="space-y-4 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              submit.mutate();
            }}
          >
            {application.data?.applicationsEnabled &&
            application.data.allowedRoles.length > 0 ? (
              <>
                <div>
                  <Label htmlFor="requested-role">Requested role</Label>
                  <Select
                    id="requested-role"
                    value={effectiveRequestedRole}
                    onChange={(event) =>
                      setRequestedRole(
                        event.target.value as "pilot" | "dispatcher",
                      )
                    }
                  >
                    {application.data.allowedRoles.includes("pilot") ? (
                      <option value="pilot">Pilot</option>
                    ) : null}
                    {application.data.allowedRoles.includes("dispatcher") ? (
                      <option value="dispatcher">Dispatcher</option>
                    ) : null}
                  </Select>
                </div>
                <Button className="w-full" type="submit" disabled={busy}>
                  {submit.isPending ? "Submitting…" : "Submit application"}
                </Button>
              </>
            ) : (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
                Membership applications are currently closed. A tenant
                administrator can still send you a direct invitation.
              </p>
            )}
          </form>
        </Card>
      )}

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          {apiErrorMessage(error)}
        </p>
      ) : null}

      <div className="overflow-hidden border border-slate-200 bg-white p-2">
        <OrganizationList hidePersonal afterSelectOrganizationUrl="/:slug" />
      </div>
      <div className="text-center text-sm text-slate-600">
        Using the wrong account?{" "}
        <SignOutButton redirectUrl={`/${slug}/sign-in`}>
          <button className="font-semibold text-[var(--brand-action)] underline underline-offset-4">
            Sign out
          </button>
        </SignOutButton>
      </div>
    </div>
  );
}
