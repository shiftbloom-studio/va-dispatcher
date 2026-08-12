"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Save } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PageHeading } from "@/components/page-heading";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/fields";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { apiErrorMessage } from "@/lib/api/http";
import { meSchema, meUpdateResponseSchema, type Me } from "@/lib/api/schemas";
import { jsonBody, useApi } from "@/lib/api/use-api";

const HOPPIE_REGISTRATION_URL =
  "https://www.hoppie.nl/acars/system/register.html";
const CALLSIGN_PATTERN = /^[A-Z0-9-]+$/;

export function AccountSettings({ slug }: { slug: string }) {
  const api = useApi();
  const me = useQuery({
    queryKey: [slug, "account-settings", "me"],
    queryFn: () => api("/me", { schema: meSchema }),
  });

  if (me.isPending) {
    return <LoadingState label="Loading your settings" />;
  }
  if (me.isError) {
    return (
      <ErrorState
        message={apiErrorMessage(me.error)}
        onRetry={() => void me.refetch()}
      />
    );
  }
  if (!me.data.membership) {
    return <ErrorState message="No active Virtual Airline membership found." />;
  }

  return (
    <>
      <PageHeading
        eyebrow="Account"
        title="My settings"
        description="Manage your tenant-scoped member profile and the personal ACARS callsign used by your simulator. This is available to pilots, dispatchers, and administrators."
        action={
          me.data.membership.role === "admin" ? (
            <Link
              href={`/${slug}/settings/organization`}
              className="inline-flex min-h-11 items-center rounded-[2px] border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              Organization settings
            </Link>
          ) : null
        }
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <ProfileCard slug={slug} membership={me.data.membership} />
        <HoppieGuide />
      </div>
    </>
  );
}

function ProfileCard({
  slug,
  membership,
}: {
  slug: string;
  membership: NonNullable<Me["membership"]>;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(membership.displayName ?? "");
  const [pilotCallsign, setPilotCallsign] = useState(
    membership.pilotCallsign ?? "",
  );
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const normalizedCallsign = pilotCallsign.trim().toUpperCase();
  const callsignValid =
    !normalizedCallsign ||
    (normalizedCallsign.length <= 20 &&
      CALLSIGN_PATTERN.test(normalizedCallsign));
  const saveProfileMutation = useMutation({
    mutationFn: () =>
      api("/me", {
        method: "PATCH",
        schema: meUpdateResponseSchema,
        ...jsonBody({
          displayName: displayName.trim() || null,
          pilotCallsign: normalizedCallsign || null,
        }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData<Me>(
        [slug, "account-settings", "me"],
        (current) =>
          current ? { ...current, membership: data.membership } : current,
      );
      setPilotCallsign(data.membership.pilotCallsign ?? "");
      setSuccessMessage("Your account settings were saved.");
    },
  });

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Member profile"
        description="These details are scoped to this Virtual Airline."
      />
      <form
        className="space-y-5 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          setSuccessMessage(null);
          if (callsignValid) saveProfileMutation.mutate();
        }}
      >
        <div>
          <Label htmlFor="settings-display-name">Display name</Label>
          <Input
            id="settings-display-name"
            maxLength={120}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Your name"
          />
        </div>
        <div>
          <Label htmlFor="settings-callsign">Your ACARS callsign</Label>
          <Input
            id="settings-callsign"
            maxLength={20}
            className="uppercase"
            value={pilotCallsign}
            onChange={(event) => setPilotCallsign(event.target.value)}
            aria-invalid={!callsignValid}
            aria-describedby="settings-callsign-help"
            placeholder="SAS123"
          />
          <p
            id="settings-callsign-help"
            className={`mt-1 text-sm ${callsignValid ? "text-slate-500" : "font-medium text-red-700"}`}
          >
            {callsignValid
              ? "Use the same callsign as your active Hoppie-enabled simulator client. Letters, numbers, and hyphens only."
              : "Use no more than 20 letters, numbers, or hyphens."}
          </p>
        </div>
        <div className="rounded-[2px] border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-950">
          <p className="font-semibold">
            Your personal logon code stays private
          </p>
          <p className="mt-1">
            Enter your own Hoppie logon only in the ACARS client connected to
            your simulator. This website needs your callsign, never your
            personal logon code.
          </p>
        </div>
        {successMessage ? (
          <p role="status" className="text-sm font-medium text-emerald-700">
            {successMessage}
          </p>
        ) : null}
        {saveProfileMutation.isError ? (
          <p role="alert" className="text-sm font-medium text-red-700">
            {apiErrorMessage(saveProfileMutation.error)}
          </p>
        ) : null}
        <Button
          type="submit"
          disabled={saveProfileMutation.isPending || !callsignValid}
        >
          <Save aria-hidden className="size-4" />
          {saveProfileMutation.isPending ? "Saving…" : "Save profile"}
        </Button>
      </form>
    </Card>
  );
}

function HoppieGuide() {
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Connect your simulator"
        description="Hoppie's ACARS logon registration is self-service and free."
      />
      <div className="space-y-5 p-5 text-sm leading-6 text-slate-700">
        <ol className="space-y-4">
          <GuideStep number="1" title="Request a Hoppie logon">
            Accept Hoppie&apos;s usage rules and request the code with a working
            email address. No separate API approval is required. Accounts that
            remain unused for 120 days expire.
          </GuideStep>
          <GuideStep number="2" title="Configure your ACARS client">
            Add the logon code and use the same flight callsign saved in your
            member profile.
          </GuideStep>
          <GuideStep number="3" title="Match the network affiliation">
            Your logon and the Virtual Airline ground-station logon must use the
            same Hoppie network, such as VATSIM, IVAO, or None.
          </GuideStep>
          <GuideStep number="4" title="Bring the aircraft online">
            Many simulator clients appear online only after sending their first
            request. Dispatch messages are store-and-forward, not instant
            delivery receipts.
          </GuideStep>
        </ol>
        <a
          href={HOPPIE_REGISTRATION_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center gap-2 rounded-[2px] border border-slate-300 px-4 py-2 font-semibold text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          Request a Hoppie logon
          <ExternalLink aria-hidden className="size-4" />
        </a>
      </div>
    </Card>
  );
}

function GuideStep({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span className="grid size-7 shrink-0 place-items-center rounded-[2px] bg-slate-900 text-xs font-bold text-white">
        {number}
      </span>
      <div>
        <p className="font-semibold text-slate-950">{title}</p>
        <p>{children}</p>
      </div>
    </li>
  );
}
