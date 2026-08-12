"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Link2,
  RefreshCw,
  Send,
  TestTube2,
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
  healthSchema,
  simulateAcarsResponseSchema,
  type AcarsMessage,
} from "@/lib/api/schemas";
import { getHealth, jsonBody, useApi } from "@/lib/api/use-api";
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
        <span>Provider: {message.provider}</span>
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
  const health = useQuery({
    queryKey: ["api", "health"],
    queryFn: () => getHealth(healthSchema),
    staleTime: 60_000,
    retry: false,
  });
  const flights = useQuery({
    queryKey: [slug, "dispatch", "acars", "flights"],
    queryFn: () => api("/flights?limit=100", { schema: flightPageSchema }),
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

  if (inbox.isPending || flights.isPending)
    return <LoadingState label="Loading ACARS workspace" />;
  if (inbox.isError || flights.isError)
    return (
      <ErrorState
        message={apiErrorMessage(inbox.error ?? flights.error)}
        onRetry={() => void Promise.all([inbox.refetch(), flights.refetch()])}
      />
    );

  return (
    <>
      <PageHeading
        eyebrow="Dispatcher suite"
        title="ACARS workspace"
        description="Dispatcher-only station conversations and free-text telex traffic. Times are UTC / Zulu."
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
          {health.data?.acarsProvider === "mock" ? (
            <MockSimulator
              onStored={async () => {
                await Promise.all([
                  inbox.refetch(),
                  station ? conversation.refetch() : Promise.resolve(),
                ]);
              }}
            />
          ) : null}
        </div>
        <ComposeTelex
          flights={flights.data.items}
          defaultRecipient={station ?? ""}
          onSent={async () => {
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: [slug, "acars"] }),
              inbox.refetch(),
            ]);
          }}
        />
      </div>
      <p className="mt-4 text-xs text-slate-500">
        Inbox and open station conversations refresh every 10 seconds while
        visible and online. Failed sends are never retried automatically.
      </p>
    </>
  );
}

function ComposeTelex({
  flights,
  defaultRecipient,
  onSent,
}: {
  flights: Array<{
    id: string;
    flightNumber: string;
    depIcao: string;
    arrIcao: string;
  }>;
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
      setSuccess(`Telex sent to ${recipient.trim().toUpperCase()}.`);
      setBody("");
      await onSent();
    },
  });

  return (
    <Card className="h-fit overflow-hidden 2xl:sticky 2xl:top-22">
      <CardHeader
        title="Compose telex"
        description="A successful response means the provider accepted and stored this outbound message."
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
          />
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
            onChange={(event) => setFlightId(event.target.value)}
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

function MockSimulator({ onStored }: { onStored: () => Promise<void> }) {
  const api = useApi();
  const [from, setFrom] = useState("");
  const [body, setBody] = useState("");
  const [msgType, setMsgType] = useState("telex");
  const [result, setResult] = useState<string | null>(null);
  const simulate = useMutation({
    mutationFn: () =>
      api("/acars/simulate", {
        method: "POST",
        schema: simulateAcarsResponseSchema,
        ...jsonBody({ from: from.trim().toUpperCase(), body, msgType }),
      }),
    onSuccess: async (data) => {
      setResult(
        data.queued
          ? "Inbound message queued. It will appear after the next ACARS poll, normally within one minute."
          : `Inbound message stored for ${data.to} and available in the inbox now.`,
      );
      setBody("");
      await onStored();
    },
  });
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Mock inbound simulator"
        description="Visible only while the API health endpoint reports the mock ACARS provider."
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setResult(null);
          if (from.trim() && body.trim()) simulate.mutate();
        }}
        className="grid gap-4 p-5 md:grid-cols-[1fr_1fr_2fr_auto] md:items-end"
      >
        <div>
          <Label htmlFor="simulate-from">From station</Label>
          <Input
            id="simulate-from"
            required
            maxLength={20}
            className="uppercase"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            placeholder="SAS123"
          />
        </div>
        <div>
          <Label htmlFor="simulate-type">Message type</Label>
          <Select
            id="simulate-type"
            value={msgType}
            onChange={(event) => setMsgType(event.target.value)}
          >
            <option value="telex">Telex</option>
            <option value="progress">Progress</option>
            <option value="cpdlc">CPDLC</option>
            <option value="position">Position</option>
            <option value="other">Other</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="simulate-body">Inbound message</Label>
          <Input
            id="simulate-body"
            required
            maxLength={4000}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Request latest operational information"
          />
        </div>
        <Button
          type="submit"
          disabled={simulate.isPending || !from.trim() || !body.trim()}
        >
          <TestTube2 aria-hidden className="size-4" />{" "}
          {simulate.isPending ? "Simulating…" : "Simulate"}
        </Button>
        {result ? (
          <p
            role="status"
            className="rounded-lg bg-sky-50 p-3 text-sm text-sky-900 md:col-span-4"
          >
            {result}
          </p>
        ) : null}
        {simulate.isError ? (
          <p
            role="alert"
            className="rounded-lg bg-red-50 p-3 text-sm text-red-800 md:col-span-4"
          >
            {apiErrorMessage(simulate.error)}
          </p>
        ) : null}
      </form>
    </Card>
  );
}
