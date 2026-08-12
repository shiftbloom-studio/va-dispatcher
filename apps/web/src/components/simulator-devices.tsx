"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, PlugZap, Trash2 } from "lucide-react";
import { useState } from "react";

import { ConfirmAction } from "@/components/action-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/fields";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { apiErrorMessage } from "@/lib/api/http";
import {
  simulatorDeviceCreatedSchema,
  simulatorDeviceListSchema,
  simulatorDeviceResponseSchema,
} from "@/lib/api/schemas";
import { jsonBody, useApi } from "@/lib/api/use-api";
import { formatUtc } from "@/lib/utc";

export function SimulatorDevices({
  slug,
  canCreate,
}: {
  slug: string;
  canCreate: boolean;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const queryKey = [slug, "telemetry", "devices"] as const;
  const devices = useQuery({
    queryKey,
    queryFn: () =>
      api("/telemetry/devices", { schema: simulatorDeviceListSchema }),
  });
  const create = useMutation({
    mutationFn: () =>
      api("/telemetry/devices", {
        method: "POST",
        schema: simulatorDeviceCreatedSchema,
        ...jsonBody({ name: name.trim() }),
      }),
    onSuccess: async (data) => {
      setIssuedToken(data.token);
      setName("");
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) =>
      api(`/telemetry/devices/${id}`, {
        method: "DELETE",
        schema: simulatorDeviceResponseSchema,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  if (devices.isPending)
    return <LoadingState label="Loading simulator connections" />;
  if (devices.isError)
    return (
      <ErrorState
        message={apiErrorMessage(devices.error)}
        onRetry={() => void devices.refetch()}
      />
    );

  return (
    <Card className="overflow-hidden xl:col-span-2">
      <CardHeader
        title="MSFS 2024 simulator connections"
        description={
          canCreate
            ? "Issue a revocable, tenant-scoped device token for the simulator client."
            : "Review and revoke credentials issued while this membership had the pilot role."
        }
      />
      <div className="space-y-5 p-5">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
          <p className="font-semibold">Operational simulator data</p>
          <p className="mt-1">
            When connected, the client sends the assigned flight ID, precise
            aircraft position, altitude, speed, heading, simulator time, phase,
            and heartbeat. While reporting, accepted samples retain a current
            point and prune the track to 24 hours and 5,000 points; track views
            never expose samples older than 24 hours. Dormant rows follow the
            operator&apos;s approved recurring deletion schedule. This is
            simulated-flight awareness, not a real-world safety service.
          </p>
        </div>

        {canCreate ? (
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault();
              setIssuedToken(null);
              if (name.trim()) create.mutate();
            }}
          >
            <div className="flex-1">
              <Label htmlFor="simulator-device-name">Device name</Label>
              <Input
                id="simulator-device-name"
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Home cockpit"
              />
            </div>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              <PlugZap aria-hidden className="size-4" /> Create connection
            </Button>
          </form>
        ) : (
          <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
            New simulator credentials are available only to pilots. Existing
            devices remain visible here so they can be revoked after a role
            change.
          </p>
        )}

        {issuedToken ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="flex items-center gap-2 font-semibold text-emerald-950">
              <KeyRound aria-hidden className="size-4" /> Copy this token now
            </p>
            <p className="mt-1 text-sm text-emerald-900">
              It is shown once. Store it only in the simulator client; revoke
              the device if it may have been exposed.
            </p>
            <code className="mt-3 block select-all overflow-x-auto rounded-lg bg-white p-3 text-xs text-slate-900">
              {issuedToken}
            </code>
          </div>
        ) : null}

        {devices.data.items.length ? (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
            {devices.data.items.map((device) => (
              <li
                key={device.id}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div>
                  <p className="font-semibold text-slate-950">{device.name}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {device.status === "revoked"
                      ? `Revoked ${device.revokedAt ? formatUtc(device.revokedAt) : ""}`
                      : device.lastSeenAt
                        ? `Last seen ${formatUtc(device.lastSeenAt)}`
                        : "Never connected"}
                  </p>
                </div>
                {device.status === "active" ? (
                  <ConfirmAction
                    trigger={
                      <Button variant="secondary" size="sm">
                        <Trash2 aria-hidden className="size-4" /> Revoke
                      </Button>
                    }
                    title="Revoke this simulator device?"
                    detail="The token stops working immediately. Create a new connection to reconnect this client."
                    confirmLabel="Revoke device"
                    onConfirm={() =>
                      revoke.mutateAsync(device.id).then(() => undefined)
                    }
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No simulator connections"
            detail={
              canCreate
                ? "Create one when you are ready to connect the MSFS 2024 client."
                : "No credential issued while this membership had the pilot role remains."
            }
          />
        )}
        {create.isError || revoke.isError ? (
          <p role="alert" className="text-sm font-medium text-red-700">
            {apiErrorMessage(create.error ?? revoke.error)}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
