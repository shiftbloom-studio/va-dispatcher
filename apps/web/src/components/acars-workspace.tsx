"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Link2,
  RefreshCw,
  Send,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { PageHeading } from "@/components/page-heading";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/fields";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { apiErrorMessage } from "@/lib/api/http";
import {
  acarsMessagePageSchema,
  acarsMessageResponseSchema,
  flightPageSchema,
  membersSchema,
  tenantDetailSchema,
  type AcarsMessage,
  type Member,
} from "@/lib/api/schemas";
import { jsonBody, useApi } from "@/lib/api/use-api";
import { formatUtc } from "@/lib/utc";

function messageTime(message: AcarsMessage): string {
  return message.sentAt ?? message.receivedAt ?? message.createdAt;
}

function remoteStation(message: AcarsMessage): string {
  return message.direction === "inbound"
    ? message.fromStation
    : message.toStation;
}

function MessageCard({
  message,
  slug,
  selected,
  onStation,
}: {
  message: AcarsMessage;
  slug: string;
  selected?: boolean;
  onStation: (station: string) => void;
}) {
  const inbound = message.direction === "inbound";
  const DirectionIcon = inbound ? ArrowDownLeft : ArrowUpRight;
  return (
    <article
      className={`rounded-xl border p-4 ${selected ? "border-[var(--accent)] bg-red-50/40" : "border-slate-200 bg-white"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          onClick={() => onStation(remoteStation(message))}
          className="flex min-h-10 items-center gap-2 rounded-lg text-left font-display font-bold text-slate-950 hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
        >
          <span
            className={`grid size-8 place-items-center rounded-lg ${inbound ? "bg-sky-100 text-sky-800" : "bg-emerald-100 text-emerald-800"}`}
          >
            <DirectionIcon aria-hidden className="size-4" />
          </span>
          {message.fromStation} <span className="text-slate-400">→</span>{" "}
          {message.toStation}
        </button>
        <time
          dateTime={messageTime(message)}
          className="text-xs font-medium text-slate-500"
        >
          {formatUtc(messageTime(message))}
        </time>
      </div>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">
        {message.body}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
        <span className="rounded bg-slate-100 px-2 py-1 font-bold uppercase">
          {message.direction}
        </span>
        <span className="rounded bg-slate-100 px-2 py-1 font-bold uppercase">
          {message.msgType}
        </span>
        {message.flightId ? (
          <Link
            href={`/${slug}/dispatch/flights/${message.flightId}`}
            className="ml-auto inline-flex items-center gap-1 font-bold text-[var(--accent)] hover:underline"
          >
            <Link2 aria-hidden className="size-3.5" /> Linked flight
          </Link>
        ) : null}
      </div>
    </article>
  );
}

export function AcarsWorkspace({ slug }: { slug: string }) {
  const api = useApi();
  const router = useRouter();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const station = search.get("station")?.trim().toUpperCase() || null;
  const inbox = useQuery({
    queryKey: [slug, "acars", "inbox"],
    queryFn: () => api("/dispatch/inbox", { schema: acarsMessagePageSchema }),
    refetchInterval: 10_000,
  });
  const conversation = useQuery({
    queryKey: [slug, "acars", "conversation", station],
    queryFn: () =>
      api(`/acars/messages?station=${encodeURIComponent(station!)}&limit=100`, {
        schema: acarsMessagePageSchema,
      }),
    enabled: Boolean(station),
    refetchInterval: 10_000,
  });
  const flights = useQuery({
    queryKey: [slug, "dispatch", "acars", "flights"],
    queryFn: () => api("/flights?limit=100", { schema: flightPageSchema }),
    staleTime: 30_000,
  });
  const members = useQuery({
    queryKey: [slug, "dispatch", "acars", "members"],
    queryFn: () => api("/members", { schema: membersSchema }),
    staleTime: 60_000,
  });
  const tenant = useQuery({
    queryKey: [slug, "dispatch", "acars", "tenant"],
    queryFn: () => api("/tenant", { schema: tenantDetailSchema }),
    staleTime: 30_000,
  });

  function selectStation(next: string | null) {
    const params = new URLSearchParams(search.toString());
    if (next) params.set("station", next);
    else params.delete("station");
    router.replace(
      `/${slug}/dispatch/acars${params.size ? `?${params.toString()}` : ""}`,
    );
  }

  if (
    inbox.isPending ||
    flights.isPending ||
    members.isPending ||
    tenant.isPending
  )
    return <LoadingState label="Loading ACARS workspace" />;
  if (inbox.isError || flights.isError || members.isError || tenant.isError)
    return (
      <ErrorState
        message={apiErrorMessage(
          inbox.error ?? flights.error ?? members.error ?? tenant.error,
        )}
        onRetry={() =>
          void Promise.all([
            inbox.refetch(),
            flights.refetch(),
            members.refetch(),
            tenant.refetch(),
          ])
        }
      />
    );

  return (
    <>
      <PageHeading
        eyebrow="Dispatcher suite"
        title="ACARS workspace"
        description="Dispatcher-only station conversations and free-text telex traffic via Hoppie's ACARS network. Times are UTC / Zulu."
        action={
          <Link
            href={`/${slug}/settings`}
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            ACARS settings
          </Link>
        }
      />
      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_28rem]">
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader
              title={station ? `Conversation · ${station}` : "Newest messages"}
              description={
                station
                  ? "Messages are grouped by remote station, independent of flight linking."
                  : "The newest 50 inbound and outbound messages."
              }
              action={
                station ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => selectStation(null)}
                  >
                    <X aria-hidden className="size-4" /> Close conversation
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void inbox.refetch()}
                  >
                    <RefreshCw
                      aria-hidden
                      className={`size-4 ${inbox.isFetching ? "animate-spin" : ""}`}
                    />{" "}
                    Refresh
                  </Button>
                )
              }
            />
            <div className="space-y-3 p-4">
              {station && conversation.isPending ? (
                <LoadingState label={`Loading ${station} conversation`} />
              ) : null}
              {station && conversation.isError ? (
                <ErrorState
                  message={apiErrorMessage(conversation.error)}
                  onRetry={() => void conversation.refetch()}
                />
              ) : null}
              {(station ? conversation.data?.items : inbox.data.items)?.map(
                (message) => (
                  <MessageCard
                    key={message.id}
                    message={message}
                    slug={slug}
                    selected={station === remoteStation(message)}
                    onStation={selectStation}
                  />
                ),
              )}
              {(
                station
                  ? conversation.data && !conversation.data.items.length
                  : !inbox.data.items.length
              ) ? (
                <EmptyState
                  title={
                    station
                      ? `No messages with ${station}`
                      : "No ACARS messages"
                  }
                  detail={
                    station
                      ? "Select another station or send the first telex."
                      : "Inbound and outbound traffic will appear here as soon as it is stored."
                  }
                />
              ) : null}
            </div>
          </Card>
        </div>
        {tenant.data.hasHoppieLogon ? (
          <ComposeTelex
            key={station ?? "new-message"}
            flights={flights.data.items}
            members={members.data.items}
            defaultRecipient={station ?? ""}
            onSent={async () => {
              await Promise.all([
                queryClient.invalidateQueries({ queryKey: [slug, "acars"] }),
                inbox.refetch(),
              ]);
            }}
          />
        ) : (
          <HoppieSetupRequired slug={slug} />
        )}
      </div>
      <p className="mt-4 text-xs text-slate-500">
        Inbox and open station conversations refresh every 10 seconds while
        visible and online.{" "}
        {tenant.data.hasHoppieLogon
          ? tenant.data.hoppiePollingEnabled
            ? "The ground station checks Hoppie for inbound messages on its scheduled poll, normally once per minute. "
            : "Scheduled inbound Hoppie polling is currently unavailable. "
          : "Connect the Virtual Airline's Hoppie ground station to enable live traffic. "}
        Failed sends are never retried automatically.
      </p>
    </>
  );
}

function ComposeTelex({
  flights,
  members,
  defaultRecipient,
  onSent,
}: {
  flights: Array<{
    id: string;
    flightNumber: string;
    depIcao: string;
    arrIcao: string;
    pilotMembershipId: string | null;
  }>;
  members: Member[];
  defaultRecipient: string;
  onSent: () => Promise<void>;
}) {
  const api = useApi();
  const [recipient, setRecipient] = useState(defaultRecipient);
  const [body, setBody] = useState("");
  const [flightId, setFlightId] = useState("");
  const [success, setSuccess] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () =>
      api("/acars/messages", {
        method: "POST",
        schema: acarsMessageResponseSchema,
        ...jsonBody({
          to: recipient.trim().toUpperCase(),
          body,
          flightId: flightId || null,
        }),
      }),
    onSuccess: async () => {
      setSuccess(
        `Hoppie accepted the telex to ${recipient.trim().toUpperCase()} for store-and-forward. This is not a delivery or read receipt.`,
      );
      setBody("");
      await onSent();
    },
  });

  return (
    <Card className="h-fit overflow-hidden 2xl:sticky 2xl:top-22">
      <CardHeader
        title="Compose telex"
        description="A successful response means Hoppie accepted and stored this outbound message."
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setSuccess(null);
          if (recipient.trim() && body.trim()) send.mutate();
        }}
        className="space-y-4 p-5"
      >
        <div>
          <Label htmlFor="acars-recipient">Recipient station</Label>
          <Input
            id="acars-recipient"
            required
            maxLength={20}
            className="uppercase"
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder="SAS123"
            list="acars-member-callsigns"
          />
          <datalist id="acars-member-callsigns">
            {members
              .filter(
                (member) =>
                  member.status === "active" && Boolean(member.pilotCallsign),
              )
              .map((member) => (
                <option
                  key={member.id}
                  value={member.pilotCallsign ?? ""}
                  label={
                    member.displayName ?? member.pilotCallsign ?? undefined
                  }
                />
              ))}
          </datalist>
          <p className="mt-1 text-sm text-slate-500">
            Choose a member callsign or enter another active Hoppie station.
          </p>
        </div>
        <div>
          <Label htmlFor="acars-body">Message</Label>
          <Textarea
            id="acars-body"
            required
            maxLength={4000}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Free-text telex message…"
          />
        </div>
        <div>
          <Label htmlFor="acars-flight">Linked flight (optional)</Label>
          <Select
            id="acars-flight"
            value={flightId}
            onChange={(event) => {
              const nextFlightId = event.target.value;
              setFlightId(nextFlightId);
              const flight = flights.find(
                (candidate) => candidate.id === nextFlightId,
              );
              const pilot = members.find(
                (member) => member.id === flight?.pilotMembershipId,
              );
              if (nextFlightId) setRecipient(pilot?.pilotCallsign ?? "");
            }}
          >
            <option value="">No flight link</option>
            {flights.map((flight) => (
              <option key={flight.id} value={flight.id}>
                {flight.flightNumber} · {flight.depIcao}–{flight.arrIcao}
              </option>
            ))}
          </Select>
        </div>
        {success ? (
          <p
            role="status"
            className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"
          >
            {success}
          </p>
        ) : null}
        {send.isError ? (
          <p
            role="alert"
            className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
          >
            {apiErrorMessage(send.error)} Your draft is retained; retry manually
            when ready.
          </p>
        ) : null}
        <Button
          type="submit"
          className="w-full"
          disabled={send.isPending || !recipient.trim() || !body.trim()}
        >
          <Send aria-hidden className="size-4" />{" "}
          {send.isPending
            ? "Sending…"
            : send.isError
              ? "Retry send"
              : "Send telex"}
        </Button>
      </form>
    </Card>
  );
}

function HoppieSetupRequired({ slug }: { slug: string }) {
  return (
    <Card className="h-fit overflow-hidden 2xl:sticky 2xl:top-22">
      <CardHeader
        title="Hoppie setup required"
        description="ACARS stays read-only until this Virtual Airline has a verified ground-station connection."
      />
      <div className="space-y-4 p-5 text-sm leading-6 text-slate-700">
        <p>
          An administrator must add and test the Virtual Airline&apos;s Hoppie
          ground-station callsign and logon before dispatchers can send or
          receive live messages.
        </p>
        <Link
          href={`/${slug}/settings`}
          className="inline-flex min-h-11 items-center rounded-lg bg-slate-950 px-4 py-2 font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          Open ACARS settings
        </Link>
      </div>
    </Card>
  );
}
