"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Link2, Unlink } from "lucide-react";
import { useState } from "react";

import { ConfirmAction } from "@/components/action-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/fields";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { apiErrorMessage } from "@/lib/api/http";
import {
  simbriefConnectionResponseSchema,
  simbriefOauthStartSchema,
} from "@/lib/api/schemas";
import { jsonBody, useApi } from "@/lib/api/use-api";

const PILOT_ID_PATTERN = /^[1-9]\d{1,11}$/;

export function SimbriefAccount({ slug }: { slug: string }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [pilotId, setPilotId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const queryKey = [slug, "simbrief", "connection"] as const;
  const connection = useQuery({
    queryKey,
    queryFn: () =>
      api("/simbrief/connection", {
        schema: simbriefConnectionResponseSchema,
      }),
  });
  const connect = useMutation({
    mutationFn: () =>
      api("/simbrief/connection", {
        method: "PUT",
        schema: simbriefConnectionResponseSchema,
        ...jsonBody({ userId: pilotId.trim() }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      setPilotId("");
      setNotice("SimBrief Pilot ID connected.");
    },
  });
  const disconnect = useMutation({
    mutationFn: () =>
      api("/simbrief/connection", {
        method: "DELETE",
        schema: simbriefConnectionResponseSchema,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      setNotice("SimBrief and Navigraph connections removed.");
    },
  });
  const oauth = useMutation({
    mutationFn: () =>
      api("/simbrief/oauth/start", {
        method: "POST",
        schema: simbriefOauthStartSchema,
      }),
    onSuccess: ({ authorizationUrl }) => {
      window.location.assign(authorizationUrl);
    },
  });

  if (connection.isPending)
    return <LoadingState label="Loading SimBrief connection" />;
  if (connection.isError)
    return (
      <ErrorState
        message={apiErrorMessage(connection.error)}
        onRetry={() => void connection.refetch()}
      />
    );

  const current = connection.data.connection;
  const error = connect.error ?? disconnect.error ?? oauth.error;
  const isBusy = connect.isPending || disconnect.isPending || oauth.isPending;

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="SimBrief and Navigraph"
        description="Your flight plans are generated in your account, never a dispatcher's personal account."
      />
      <div className="space-y-5 p-5 text-sm">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="font-semibold text-slate-950">
            {current.connected
              ? `Pilot ID ${current.userId}`
              : "No SimBrief Pilot ID connected"}
          </p>
          <p className="mt-1 text-slate-600">
            {current.verified
              ? `Verified from a generated OFP${current.verifiedAt ? ` on ${new Date(current.verifiedAt).toLocaleDateString()}` : ""}.`
              : "The ID is verified after a matching OFP is imported."}
          </p>
          {current.oauth.connected ? (
            <p className="mt-2 text-emerald-700">
              Navigraph connected as {current.oauth.username || "your account"}.
            </p>
          ) : null}
        </div>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            setNotice(null);
            if (PILOT_ID_PATTERN.test(pilotId.trim())) connect.mutate();
          }}
        >
          <div>
            <Label htmlFor="simbrief-pilot-id">SimBrief numeric Pilot ID</Label>
            <Input
              id="simbrief-pilot-id"
              inputMode="numeric"
              autoComplete="off"
              value={pilotId}
              onChange={(event) => setPilotId(event.target.value)}
              aria-invalid={Boolean(pilotId && !PILOT_ID_PATTERN.test(pilotId))}
              placeholder="123456"
            />
          </div>
          <Button
            type="submit"
            variant="secondary"
            disabled={isBusy || !PILOT_ID_PATTERN.test(pilotId.trim())}
          >
            <Link2 aria-hidden className="size-4" /> Connect Pilot ID
          </Button>
        </form>

        {current.oauth.configured ? (
          <Button
            type="button"
            variant="secondary"
            disabled={isBusy}
            onClick={() => {
              setNotice(null);
              oauth.mutate();
            }}
          >
            <ExternalLink aria-hidden className="size-4" />
            {current.oauth.connected
              ? "Reconnect with Navigraph"
              : "Connect with Navigraph"}
          </Button>
        ) : (
          <p className="rounded-xl bg-amber-50 p-3 text-amber-900">
            Navigraph OAuth is not configured for this deployment. Manual Pilot
            ID linking remains available.
          </p>
        )}

        {current.connected || current.oauth.connected ? (
          <ConfirmAction
            trigger={
              <Button type="button" variant="secondary" disabled={isBusy}>
                <Unlink aria-hidden className="size-4" /> Disconnect accounts
              </Button>
            }
            title="Disconnect SimBrief and Navigraph?"
            detail="Existing flight-plan revisions remain in VA Dispatch. New plans cannot be generated until a Pilot ID is connected again."
            confirmLabel="Disconnect accounts"
            onConfirm={() => disconnect.mutateAsync().then(() => undefined)}
          />
        ) : null}

        <p className="text-slate-600">
          Connecting opens Navigraph only after you choose the button. VA
          Dispatch never asks for or stores your Navigraph password or browser
          session.
        </p>
        {notice ? (
          <p role="status" className="font-medium text-emerald-700">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="font-medium text-red-700">
            {apiErrorMessage(error)}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
