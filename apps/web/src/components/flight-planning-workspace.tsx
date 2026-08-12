"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCheck,
  ClipboardCheck,
  CloudSun,
  History,
  PlaneTakeoff,
  Save,
  UserRoundSearch,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
} from "react";

import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import {
  HelpText,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui/fields";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { apiErrorMessage } from "@/lib/api/http";
import {
  dispatchReleaseResponseSchema,
  flightDetailResponseSchema,
  flightResponseSchema,
  type DispatchRelease,
  type Flight,
  type FlightEvent,
  type Member,
} from "@/lib/api/schemas";
import { jsonBody, useApi } from "@/lib/api/use-api";
import { formatUtc, isoToUtcInput, utcInputToIso } from "@/lib/utc";

export function FlightPlanningDialog({
  slug,
  flightId,
  members,
  onClose,
}: {
  slug: string;
  flightId: string;
  members: Member[];
  onClose: () => void;
}) {
  const api = useApi();
  const dialog = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  const detail = useQuery({
    queryKey: [slug, "flight", flightId],
    queryFn: () =>
      api(`/flights/${flightId}`, { schema: flightDetailResponseSchema }),
  });

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    const handleClose = () => onCloseRef.current();
    element.addEventListener("close", handleClose);
    return () => element.removeEventListener("close", handleClose);
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-label="Flight planning workspace"
      className="m-auto h-[min(92vh,64rem)] w-[min(96rem,calc(100%-1rem))] max-w-none rounded-[2px] border border-slate-400 bg-[#f7f7f5] p-0 text-slate-950 shadow-2xl backdrop:bg-[#101728]/65 sm:w-[min(96rem,calc(100%-2rem))]"
    >
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex min-h-18 items-center gap-4 border-b border-slate-300 bg-white px-5 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--brand-action)]">
              Dispatcher planning workspace
            </p>
            <h2 className="mt-1 truncate font-display text-xl font-black text-[#17213d] sm:text-2xl">
              {detail.data
                ? `${detail.data.flight.flightNumber} · ${detail.data.flight.depIcao} — ${detail.data.flight.arrIcao}`
                : "Loading flight…"}
            </h2>
          </div>
          {detail.data ? (
            <span className="ml-auto hidden sm:block">
              <StatusBadge status={detail.data.flight.status} />
            </span>
          ) : null}
          <button
            type="button"
            aria-label="Close planning workspace"
            onClick={() => dialog.current?.close()}
            className="ml-auto grid size-10 place-items-center border border-slate-300 bg-white text-slate-600 hover:border-slate-500 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-[var(--brand-action)] sm:ml-0"
          >
            <X aria-hidden className="size-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {detail.isPending ? (
            <LoadingState label="Loading planning data" />
          ) : detail.isError ? (
            <ErrorState
              message={apiErrorMessage(detail.error)}
              onRetry={() => void detail.refetch()}
            />
          ) : (
            <PlanningWorkspace
              key={`${detail.data.flight.updatedAt}-${detail.data.release?.revision ?? 0}`}
              slug={slug}
              flight={detail.data.flight}
              release={detail.data.release}
              releases={detail.data.releaseRevisions}
              events={detail.data.events}
              members={members}
              onRefresh={() => detail.refetch()}
            />
          )}
        </div>
      </div>
    </dialog>
  );
}

function PlanningWorkspace({
  slug,
  flight,
  release,
  releases,
  events,
  members,
  onRefresh,
}: {
  slug: string;
  flight: Flight;
  release: DispatchRelease | null;
  releases: DispatchRelease[];
  events: FlightEvent[];
  members: Member[];
  onRefresh: () => Promise<unknown>;
}) {
  return (
    <div className="grid gap-5 2xl:grid-cols-[minmax(32rem,0.9fr)_minmax(38rem,1.1fr)]">
      <div className="space-y-5">
        {flight.assignmentConfirmationRequired ? (
          <div className="flex gap-3 border border-amber-400 bg-amber-50 p-4 text-sm text-amber-950">
            <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-black">Pilot confirmation required</p>
              <p className="mt-1 leading-6">
                Assignment revision {flight.assignmentRevision} remains in its
                current lane and may be started, but the assigned pilot has not
                confirmed the changed time or assignment yet.
              </p>
            </div>
          </div>
        ) : null}
        <QuickEditCard
          slug={slug}
          flight={flight}
          members={members}
          onRefresh={onRefresh}
        />
        <OperationalFallbackCard
          slug={slug}
          flight={flight}
          onRefresh={onRefresh}
        />
        <HistoryCard releases={releases} events={events} />
      </div>
      <ReleaseCard
        slug={slug}
        flight={flight}
        release={release}
        onRefresh={onRefresh}
      />
    </div>
  );
}

function QuickEditCard({
  slug,
  flight,
  members,
  onRefresh,
}: {
  slug: string;
  flight: Flight;
  members: Member[];
  onRefresh: () => Promise<unknown>;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const pilots = members.filter(
    (member) => member.role === "pilot" && member.status === "active",
  );
  const initialPilot = pilots.find(
    (member) => member.id === flight.pilotMembershipId,
  );
  const [flightNumber, setFlightNumber] = useState(flight.flightNumber);
  const [depIcao, setDepIcao] = useState(flight.depIcao);
  const [arrIcao, setArrIcao] = useState(flight.arrIcao);
  const [aircraftType, setAircraftType] = useState(flight.aircraftType ?? "");
  const [etd, setEtd] = useState(isoToUtcInput(flight.etd));
  const [eta, setEta] = useState(isoToUtcInput(flight.eta));
  const [pilotQuery, setPilotQuery] = useState(
    initialPilot ? pilotOptionLabel(initialPilot) : "",
  );
  const [notes, setNotes] = useState(flight.dispatcherNotes ?? "");
  const [changeReason, setChangeReason] = useState("");
  const [warningAccepted, setWarningAccepted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const pilotMap = useMemo(
    () => new Map(pilots.map((pilot) => [pilotOptionLabel(pilot), pilot.id])),
    [pilots],
  );
  const selectedPilotId = pilotQuery.trim() ? pilotMap.get(pilotQuery) : null;
  const operationalAssignment = ["accepted", "briefed", "active"].includes(
    flight.status,
  );
  const pilotSelectionInvalid = Boolean(
    (pilotQuery.trim() && !selectedPilotId) ||
    (operationalAssignment && !selectedPilotId),
  );
  const changedTime =
    etd !== isoToUtcInput(flight.etd) || eta !== isoToUtcInput(flight.eta);
  const changedPilot = selectedPilotId !== flight.pilotMembershipId;
  const materialChanged =
    flightNumber.trim().toUpperCase() !== flight.flightNumber ||
    depIcao.trim().toUpperCase() !== flight.depIcao ||
    arrIcao.trim().toUpperCase() !== flight.arrIcao ||
    aircraftType.trim().toUpperCase() !== (flight.aircraftType ?? "") ||
    changedTime ||
    changedPilot;
  const needsReconfirmation =
    materialChanged && ["accepted", "briefed"].includes(flight.status);
  const editable = !["completed", "cancelled"].includes(flight.status);

  const save = useMutation({
    mutationFn: () =>
      api(`/flights/${flight.id}`, {
        method: "PATCH",
        schema: flightResponseSchema,
        ...jsonBody({
          expectedVersion: flight.version,
          changeReason: materialChanged ? changeReason.trim() : undefined,
          flightNumber: flightNumber.trim().toUpperCase(),
          depIcao: depIcao.trim().toUpperCase(),
          arrIcao: arrIcao.trim().toUpperCase(),
          etd: utcInputToIso(etd),
          eta: utcInputToIso(eta),
          aircraftType: aircraftType.trim().toUpperCase() || null,
          pilotMembershipId: selectedPilotId,
          dispatcherNotes: notes.trim() || null,
        }),
      }),
    onSuccess: async (data) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: [slug, "dispatch", "board"],
        }),
        onRefresh(),
      ]);
      setWarningAccepted(false);
      setNotice(
        data.flight.assignmentConfirmationRequired
          ? `Planning saved as assignment revision ${data.flight.assignmentRevision}; pilot confirmation is pending.`
          : "Planning changes saved.",
      );
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    if (pilotSelectionInvalid) return;
    if (materialChanged && !changeReason.trim()) {
      setNotice("A change reason is required for material planning changes.");
      return;
    }
    if (needsReconfirmation && !warningAccepted) {
      setWarningAccepted(true);
      return;
    }
    save.mutate();
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Assignment and schedule"
        description="Material assignment, route, schedule, or equipment changes require a reason and renewed pilot acceptance."
        action={
          <UserRoundSearch aria-hidden className="size-5 text-slate-500" />
        }
      />
      <form onSubmit={submit} className="grid gap-4 p-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="planning-flight-number">Flight number</Label>
          <Input
            id="planning-flight-number"
            required
            maxLength={12}
            value={flightNumber}
            disabled={!editable}
            onChange={(event) => setFlightNumber(event.target.value)}
            className="uppercase"
          />
        </div>
        <div>
          <Label htmlFor="planning-aircraft">Aircraft type</Label>
          <Input
            id="planning-aircraft"
            value={aircraftType}
            disabled={!editable}
            maxLength={20}
            onChange={(event) => setAircraftType(event.target.value)}
            className="uppercase"
          />
        </div>
        <div>
          <Label htmlFor="planning-departure">Departure ICAO</Label>
          <Input
            id="planning-departure"
            required
            minLength={4}
            maxLength={4}
            value={depIcao}
            disabled={!editable}
            onChange={(event) => setDepIcao(event.target.value)}
            className="uppercase"
          />
        </div>
        <div>
          <Label htmlFor="planning-arrival">Arrival ICAO</Label>
          <Input
            id="planning-arrival"
            required
            minLength={4}
            maxLength={4}
            value={arrIcao}
            disabled={!editable}
            onChange={(event) => setArrIcao(event.target.value)}
            className="uppercase"
          />
        </div>
        <div>
          <Label htmlFor="planning-etd">ETD (UTC)</Label>
          <Input
            id="planning-etd"
            type="datetime-local"
            required
            value={etd}
            disabled={!editable}
            onChange={(event) => setEtd(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="planning-eta">ETA (UTC)</Label>
          <Input
            id="planning-eta"
            type="datetime-local"
            required
            value={eta}
            disabled={!editable}
            onChange={(event) => setEta(event.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="planning-pilot">Assigned pilot</Label>
          <Input
            id="planning-pilot"
            list="planning-pilot-options"
            value={pilotQuery}
            disabled={!editable}
            onChange={(event) => {
              setPilotQuery(event.target.value);
              setWarningAccepted(false);
            }}
            placeholder="Search by callsign or name"
            aria-invalid={pilotSelectionInvalid}
          />
          <datalist id="planning-pilot-options">
            {pilots.map((pilot) => (
              <option key={pilot.id} value={pilotOptionLabel(pilot)} />
            ))}
          </datalist>
          <HelpText>
            Type a name or ACARS callsign, then choose an exact match.
            {operationalAssignment
              ? " Operational flights must retain an active pilot."
              : " Leave empty to unassign."}
          </HelpText>
          {pilotSelectionInvalid ? (
            <p role="alert" className="mt-1 text-sm font-bold text-red-700">
              Choose an active pilot from the search results.
            </p>
          ) : null}
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="planning-notes">Planning notes</Label>
          <Textarea
            id="planning-notes"
            maxLength={2000}
            value={notes}
            disabled={!editable}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="planning-change-reason">
            Change reason (required for material changes)
          </Label>
          <Textarea
            id="planning-change-reason"
            maxLength={500}
            value={changeReason}
            disabled={!editable}
            onChange={(event) => setChangeReason(event.target.value)}
          />
        </div>

        {warningAccepted ? (
          <div className="flex gap-3 border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 sm:col-span-2">
            <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0" />
            <p>
              This material change returns the flight to Offered and requires
              renewed pilot acceptance. Pilot or time changes also advance the
              assignment revision. Select save again to proceed.
            </p>
          </div>
        ) : null}
        {notice ? (
          <p
            role="status"
            className="text-sm font-bold text-emerald-800 sm:col-span-2"
          >
            {notice}
          </p>
        ) : null}
        {save.isError ? (
          <p
            role="alert"
            className="text-sm font-bold text-red-700 sm:col-span-2"
          >
            {apiErrorMessage(save.error)}
          </p>
        ) : null}
        {editable ? (
          <div className="sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>
              <Save aria-hidden className="size-4" />
              {save.isPending
                ? "Saving…"
                : warningAccepted
                  ? "Save and request confirmation"
                  : "Save planning"}
            </Button>
          </div>
        ) : null}
      </form>
    </Card>
  );
}

function OperationalFallbackCard({
  slug,
  flight,
  onRefresh,
}: {
  slug: string;
  flight: Flight;
  onRefresh: () => Promise<unknown>;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const action =
    flight.status === "briefed"
      ? "start"
      : flight.status === "active"
        ? "finish"
        : null;
  const [confirming, setConfirming] = useState(false);
  const mutation = useMutation({
    mutationFn: () =>
      api(`/flights/${flight.id}/${action}`, {
        method: "POST",
        schema: flightResponseSchema,
        ...jsonBody({ expectedVersion: flight.version }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: [slug, "dispatch", "board"],
        }),
        onRefresh(),
      ]);
      setConfirming(false);
    },
  });
  if (!action) return null;

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Dispatcher fallback"
        description="Use only when aircraft automation and pilot web controls are unavailable or incorrect."
        action={
          action === "start" ? (
            <PlaneTakeoff aria-hidden className="size-5 text-slate-500" />
          ) : (
            <CheckCheck aria-hidden className="size-5 text-slate-500" />
          )
        }
      />
      <div className="p-5">
        {confirming ? (
          <div className="mb-4 border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">
            This records an audited dispatcher {action} event and updates actual
            tracking time. It does not pretend the pilot acknowledged a pending
            assignment. Select the action again to confirm.
          </div>
        ) : null}
        <Button
          variant="secondary"
          disabled={mutation.isPending}
          onClick={() => {
            if (!confirming) setConfirming(true);
            else mutation.mutate();
          }}
        >
          {action === "start" ? (
            <PlaneTakeoff aria-hidden className="size-4" />
          ) : (
            <CheckCheck aria-hidden className="size-4" />
          )}
          {mutation.isPending
            ? "Recording…"
            : action === "start"
              ? "Record dispatcher start"
              : "Record dispatcher finish"}
        </Button>
        {mutation.isError ? (
          <p role="alert" className="mt-3 text-sm font-bold text-red-700">
            {apiErrorMessage(mutation.error)}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function ReleaseCard({
  slug,
  flight,
  release,
  onRefresh,
}: {
  slug: string;
  flight: Flight;
  release: DispatchRelease | null;
  onRefresh: () => Promise<unknown>;
}) {
  const editable = flight.status === "accepted" || flight.status === "briefed";
  return (
    <Card className="h-fit overflow-hidden">
      <CardHeader
        title="Dispatch release"
        description={
          release
            ? `Current immutable release R${release.revision}. Publishing creates the next revision.`
            : "A complete release is required to move this flight into Scheduled."
        }
        action={
          <ClipboardCheck
            aria-hidden
            className="size-5 text-[var(--brand-action)]"
          />
        }
      />
      {release ? <DispatchReleaseSnapshot release={release} /> : null}
      {editable ? (
        <ReleaseEditor
          slug={slug}
          flight={flight}
          release={release}
          onRefresh={onRefresh}
        />
      ) : !release ? (
        <div className="border-t border-slate-200 p-5 text-sm text-slate-600">
          No release was published for this flight.
        </div>
      ) : null}
    </Card>
  );
}

type ReleaseFields = {
  operationalRoute: string;
  sid: string;
  star: string;
  cruiseLevel: string;
  alternateIcao: string;
  fuelUnit: "kg" | "lb";
  payloadUnit: "kg" | "lb";
  taxiFuel: string;
  tripFuel: string;
  contingencyFuel: string;
  alternateFuel: string;
  finalReserveFuel: string;
  additionalFuel: string;
  plannedPayload: string;
  releaseNotes: string;
  dispatcherRemarks: string;
};

function ReleaseEditor({
  slug,
  flight,
  release,
  onRefresh,
}: {
  slug: string;
  flight: Flight;
  release: DispatchRelease | null;
  onRefresh: () => Promise<unknown>;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [fields, setFields] = useState<ReleaseFields>(() =>
    releaseFields(release),
  );
  const blockFuel = fuelTotal(fields);
  const publish = useMutation({
    mutationFn: () =>
      api(`/flights/${flight.id}/release`, {
        method: "POST",
        schema: dispatchReleaseResponseSchema,
        ...jsonBody({
          expectedVersion: flight.version,
          operationalRoute: fields.operationalRoute,
          sid: fields.sid.trim() || null,
          star: fields.star.trim() || null,
          cruiseLevel: Number(fields.cruiseLevel),
          alternateIcao: fields.alternateIcao,
          fuelUnit: fields.fuelUnit,
          payloadUnit: fields.payloadUnit,
          taxiFuel: Number(fields.taxiFuel),
          tripFuel: Number(fields.tripFuel),
          contingencyFuel: Number(fields.contingencyFuel),
          alternateFuel: Number(fields.alternateFuel),
          finalReserveFuel: Number(fields.finalReserveFuel),
          additionalFuel: Number(fields.additionalFuel),
          blockFuel,
          plannedPayload: Number(fields.plannedPayload),
          releaseNotes: fields.releaseNotes.trim() || null,
          dispatcherRemarks: fields.dispatcherRemarks.trim() || null,
        }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: [slug, "dispatch", "board"],
        }),
        onRefresh(),
      ]);
    },
  });

  function field<K extends keyof ReleaseFields>(
    key: K,
    value: ReleaseFields[K],
  ) {
    setFields((current) => ({ ...current, [key]: value }));
  }

  return (
    <form
      className="border-t border-slate-300 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        publish.mutate();
      }}
    >
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--brand-action)]">
            {release
              ? `Prepare revision ${release.revision + 1}`
              : "Initial release"}
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Live METAR and TAF are fetched at publish time and stored with this
            revision.
          </p>
        </div>
        <CloudSun aria-hidden className="size-6 text-slate-400" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="release-route">Operational route</Label>
          <Textarea
            id="release-route"
            required
            maxLength={1000}
            value={fields.operationalRoute}
            onChange={(event) =>
              field("operationalRoute", event.target.value.toUpperCase())
            }
            className="min-h-20 font-mono uppercase"
            placeholder="NEXEN N872 ..."
          />
        </div>
        <ReleaseTextField
          label="SID"
          name="sid"
          value={fields.sid}
          onChange={field}
          required={false}
        />
        <ReleaseTextField
          label="STAR"
          name="star"
          value={fields.star}
          onChange={field}
          required={false}
        />
        <ReleaseTextField
          label="Cruise level"
          name="cruiseLevel"
          value={fields.cruiseLevel}
          onChange={field}
          type="number"
          min="10"
          max="600"
          placeholder="350"
        />
        <ReleaseTextField
          label="Alternate ICAO"
          name="alternateIcao"
          value={fields.alternateIcao}
          onChange={field}
          minLength={4}
          maxLength={4}
        />
      </div>

      <fieldset className="mt-6 border-t border-slate-200 pt-5">
        <legend className="pr-3 text-sm font-black uppercase tracking-wide text-slate-900">
          Fuel plan
        </legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="release-fuel-unit">Fuel unit</Label>
            <Select
              id="release-fuel-unit"
              value={fields.fuelUnit}
              onChange={(event) =>
                field("fuelUnit", event.target.value as "kg" | "lb")
              }
            >
              <option value="kg">Kilograms</option>
              <option value="lb">Pounds</option>
            </Select>
          </div>
          {(
            [
              ["Taxi", "taxiFuel"],
              ["Trip", "tripFuel"],
              ["Contingency", "contingencyFuel"],
              ["Alternate", "alternateFuel"],
              ["Final reserve", "finalReserveFuel"],
              ["Additional", "additionalFuel"],
            ] as const
          ).map(([label, name]) => (
            <ReleaseTextField
              key={name}
              label={label}
              name={name}
              value={fields[name]}
              onChange={field}
              type="number"
              min="0"
            />
          ))}
          <div className="border border-slate-300 bg-slate-50 p-3 sm:col-span-2">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">
              Computed block fuel
            </p>
            <p className="mt-1 font-mono text-2xl font-black text-[#17213d]">
              {blockFuel.toLocaleString("en-GB")}{" "}
              {fields.fuelUnit.toUpperCase()}
            </p>
          </div>
        </div>
      </fieldset>

      <fieldset className="mt-6 border-t border-slate-200 pt-5">
        <legend className="pr-3 text-sm font-black uppercase tracking-wide text-slate-900">
          Payload and briefing
        </legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="release-payload-unit">Payload unit</Label>
            <Select
              id="release-payload-unit"
              value={fields.payloadUnit}
              onChange={(event) =>
                field("payloadUnit", event.target.value as "kg" | "lb")
              }
            >
              <option value="kg">Kilograms</option>
              <option value="lb">Pounds</option>
            </Select>
          </div>
          <ReleaseTextField
            label="Planned payload"
            name="plannedPayload"
            value={fields.plannedPayload}
            onChange={field}
            type="number"
            min="0"
          />
          <div className="sm:col-span-3">
            <Label htmlFor="release-notes">Release notes</Label>
            <Textarea
              id="release-notes"
              maxLength={4000}
              value={fields.releaseNotes}
              onChange={(event) => field("releaseNotes", event.target.value)}
              placeholder="Operational considerations visible to the pilot…"
            />
          </div>
          <div className="sm:col-span-3">
            <Label htmlFor="release-remarks">Dispatcher remarks</Label>
            <Textarea
              id="release-remarks"
              maxLength={4000}
              value={fields.dispatcherRemarks}
              onChange={(event) =>
                field("dispatcherRemarks", event.target.value)
              }
              placeholder="Dispatcher-specific briefing context…"
            />
          </div>
        </div>
      </fieldset>

      {publish.isError ? (
        <p role="alert" className="mt-4 text-sm font-bold text-red-700">
          {apiErrorMessage(publish.error)}
        </p>
      ) : null}
      <Button type="submit" className="mt-5" disabled={publish.isPending}>
        <ClipboardCheck aria-hidden className="size-4" />
        {publish.isPending
          ? "Fetching weather and publishing…"
          : release
            ? `Publish release R${release.revision + 1}`
            : "Publish and schedule flight"}
      </Button>
    </form>
  );
}

function ReleaseTextField<K extends keyof ReleaseFields>({
  label,
  name,
  value,
  onChange,
  ...props
}: {
  label: string;
  name: K;
  value: ReleaseFields[K];
  onChange: <T extends keyof ReleaseFields>(
    key: T,
    value: ReleaseFields[T],
  ) => void;
} & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "name" | "value" | "onChange"
>) {
  const id = `release-${name}`;
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        required
        value={value}
        onChange={(event) =>
          onChange(name, event.target.value as ReleaseFields[K])
        }
        className={props.type === "number" ? "font-mono" : "uppercase"}
        {...props}
      />
    </div>
  );
}

export function DispatchReleaseSnapshot({
  release,
}: {
  release: DispatchRelease;
}) {
  return (
    <div className="bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">
            Released · R{release.revision}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {formatUtc(release.releasedAt)}
          </p>
        </div>
        <span className="border border-emerald-300 bg-emerald-50 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-800">
          Ready
        </span>
      </div>
      <dl className="mt-4 grid gap-x-5 gap-y-3 text-sm sm:grid-cols-3">
        <ReleaseDatum label="Route" value={release.operationalRoute} wide />
        <ReleaseDatum label="SID" value={release.sid ?? "—"} />
        <ReleaseDatum label="STAR" value={release.star ?? "—"} />
        <ReleaseDatum label="Cruise" value={`FL${release.cruiseLevel}`} />
        <ReleaseDatum label="Alternate" value={release.alternateIcao} />
        <ReleaseDatum
          label="Block fuel"
          value={`${release.blockFuel.toLocaleString("en-GB")} ${release.fuelUnit.toUpperCase()}`}
        />
        <ReleaseDatum
          label="Payload"
          value={`${release.plannedPayload.toLocaleString("en-GB")} ${release.payloadUnit.toUpperCase()}`}
        />
      </dl>
      <WeatherBriefing release={release} />
      {release.releaseNotes || release.dispatcherRemarks ? (
        <div className="mt-4 grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2">
          <BriefingText label="Release notes" value={release.releaseNotes} />
          <BriefingText
            label="Dispatcher remarks"
            value={release.dispatcherRemarks}
          />
        </div>
      ) : null}
    </div>
  );
}

function WeatherBriefing({ release }: { release: DispatchRelease }) {
  const snapshot = release.weatherSnapshot;
  const metar = Array.isArray(snapshot.metar) ? snapshot.metar : null;
  const taf = Array.isArray(snapshot.taf) ? snapshot.taf : null;
  const unavailable = Array.isArray(snapshot.unavailable)
    ? snapshot.unavailable.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  return (
    <div className="mt-5 border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center gap-2">
        <CloudSun aria-hidden className="size-4 text-[var(--brand-action)]" />
        <p className="text-xs font-black uppercase tracking-wider text-slate-800">
          Weather snapshot
        </p>
        <span className="ml-auto text-[10px] text-slate-500">
          {typeof snapshot.fetchedAt === "string"
            ? formatUtc(snapshot.fetchedAt)
            : "Stored with release"}
        </span>
      </div>
      {unavailable.length ? (
        <p className="mt-2 text-xs font-bold text-amber-800">
          Live {unavailable.join(" and ").toUpperCase()} data was unavailable at
          publish time.
        </p>
      ) : null}
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <WeatherProduct label="METAR" products={metar} />
        <WeatherProduct label="TAF" products={taf} />
      </div>
    </div>
  );
}

function WeatherProduct({
  label,
  products,
}: {
  label: string;
  products: unknown[] | null;
}) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">
        {label}
      </p>
      {products?.length ? (
        <div className="mt-1 space-y-2">
          {products.map((product, index) => (
            <p
              key={index}
              className="break-words font-mono text-[11px] leading-5 text-slate-800"
            >
              {weatherText(product)}
            </p>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-xs text-slate-500">No report returned.</p>
      )}
    </div>
  );
}

function HistoryCard({
  releases,
  events,
}: {
  releases: DispatchRelease[];
  events: FlightEvent[];
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Revision and progress history"
        description="Immutable release revisions and source-tagged operational events."
        action={<History aria-hidden className="size-5 text-slate-500" />}
      />
      <div className="max-h-72 overflow-y-auto p-5">
        {!releases.length && !events.length ? (
          <p className="text-sm text-slate-500">
            No release or progress history yet.
          </p>
        ) : (
          <ol className="space-y-3 border-l border-slate-300 pl-4">
            {[
              ...releases.map((release) => ({
                id: `release-${release.id}`,
                at: release.releasedAt,
                title: `Dispatch release R${release.revision}`,
                detail: `Published · FL${release.cruiseLevel} · ${release.blockFuel} ${release.fuelUnit.toUpperCase()}`,
              })),
              ...events.map((event) => ({
                id: `event-${event.id}`,
                at: event.occurredAt,
                title: event.kind.replaceAll("_", " ").toUpperCase(),
                detail: `Source: ${event.source.replaceAll("_", " ")}`,
              })),
            ]
              .sort(
                (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
              )
              .map((entry) => (
                <li key={entry.id} className="relative text-sm">
                  <span className="absolute -left-[1.18rem] top-1.5 size-2 bg-[var(--brand)]" />
                  <p className="font-bold text-slate-900">{entry.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {entry.detail} · {formatUtc(entry.at)}
                  </p>
                </li>
              ))}
          </ol>
        )}
      </div>
    </Card>
  );
}

function ReleaseDatum({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-3" : undefined}>
      <dt className="text-[10px] font-black uppercase tracking-wider text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 break-words font-mono font-bold text-slate-900">
        {value}
      </dd>
    </div>
  );
}

function BriefingText({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">
        {value}
      </p>
    </div>
  );
}

function releaseFields(release: DispatchRelease | null): ReleaseFields {
  return {
    operationalRoute: release?.operationalRoute ?? "",
    sid: release?.sid ?? "",
    star: release?.star ?? "",
    cruiseLevel: String(release?.cruiseLevel ?? 350),
    alternateIcao: release?.alternateIcao ?? "",
    fuelUnit: release?.fuelUnit ?? "kg",
    payloadUnit: release?.payloadUnit ?? "kg",
    taxiFuel: String(release?.taxiFuel ?? 0),
    tripFuel: String(release?.tripFuel ?? 0),
    contingencyFuel: String(release?.contingencyFuel ?? 0),
    alternateFuel: String(release?.alternateFuel ?? 0),
    finalReserveFuel: String(release?.finalReserveFuel ?? 0),
    additionalFuel: String(release?.additionalFuel ?? 0),
    plannedPayload: String(release?.plannedPayload ?? 0),
    releaseNotes: release?.releaseNotes ?? "",
    dispatcherRemarks: release?.dispatcherRemarks ?? "",
  };
}

function fuelTotal(fields: ReleaseFields): number {
  return [
    fields.taxiFuel,
    fields.tripFuel,
    fields.contingencyFuel,
    fields.alternateFuel,
    fields.finalReserveFuel,
    fields.additionalFuel,
  ].reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function pilotOptionLabel(pilot: Member): string {
  const callsign = pilot.pilotCallsign ?? "NO CALLSIGN";
  return `${callsign} — ${pilot.displayName ?? callsign}`;
}

function weatherText(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return String(value ?? "No report");
  }
  const record = value as Record<string, unknown>;
  for (const key of ["rawOb", "rawTAF", "rawText", "raw_text", "raw"]) {
    if (typeof record[key] === "string") return record[key];
  }
  const station =
    typeof record.icaoId === "string"
      ? record.icaoId
      : typeof record.stationId === "string"
        ? record.stationId
        : "REPORT";
  return `${station} · structured weather report stored`;
}
