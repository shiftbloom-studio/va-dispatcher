"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleCheck,
  ExternalLink,
  ImageUp,
  KeyRound,
  Palette,
  RadioTower,
  ShieldCheck,
  Trash2,
  Unplug,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { PageHeading } from "@/components/page-heading";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { HelpText, Input, Label, Select } from "@/components/ui/fields";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { apiErrorMessage } from "@/lib/api/http";
import {
  acarsConfigSchema,
  tenantBrandResponseSchema,
  tenantDetailSchema,
  tenantAdministrationResponseSchema,
  type BrandPresence,
  type TenantBrand,
  type TenantDetail,
} from "@/lib/api/schemas";
import { jsonBody, useApi } from "@/lib/api/use-api";
import { brandStyle, organizationInitials } from "@/lib/brand";
import { formatUtc } from "@/lib/utc";

const HOPPIE_REGISTRATION_URL =
  "https://www.hoppie.nl/acars/system/register.html";
const CALLSIGN_PATTERN = /^[A-Z0-9-]+$/;

export function OrganizationSettings({ slug }: { slug: string }) {
  const api = useApi();
  const tenant = useQuery({
    queryKey: [slug, "organization-settings", "tenant"],
    queryFn: () => api("/tenant", { schema: tenantDetailSchema }),
  });

  if (tenant.isPending) {
    return <LoadingState label="Loading organization settings" />;
  }
  if (tenant.isError) {
    return (
      <ErrorState
        message={apiErrorMessage(tenant.error)}
        onRetry={() => void tenant.refetch()}
      />
    );
  }

  return (
    <>
      <PageHeading
        eyebrow="Administration"
        title="Organization settings"
        description="Shape the airline identity and connect its shared Hoppie ground station. Only organization administrators can change these settings."
        action={
          <Link
            href={`/${slug}/settings`}
            className="inline-flex min-h-11 items-center rounded-[2px] border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            My settings
          </Link>
        }
      />
      <div className="space-y-6">
        <BrandSettingsCard slug={slug} tenant={tenant.data} />
        <MemberAccessCard slug={slug} tenant={tenant.data} />
        <Card className="overflow-hidden">
          <CardHeader
            title="Before connecting"
            description="The ground station uses its own Hoppie logon, separate from every member's simulator logon."
          />
          <div className="flex flex-col gap-4 p-5 text-sm leading-6 text-slate-700 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-3xl">
              Registration is self-service and does not require separate API
              approval. Choose the same network affiliation used by your pilots
              and dispatchers. Never reuse a member&apos;s personal logon here.
            </p>
            <a
              href={HOPPIE_REGISTRATION_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-[2px] border border-slate-300 px-4 py-2 font-semibold text-slate-900 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              Request ground-station logon
              <ExternalLink aria-hidden className="size-4" />
            </a>
          </div>
        </Card>
        <HoppieConfigCard slug={slug} tenant={tenant.data} />
      </div>
    </>
  );
}

function MemberAccessCard({
  slug,
  tenant,
}: {
  slug: string;
  tenant: TenantDetail;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [name, setName] = useState(tenant.name);
  const [applicationsEnabled, setApplicationsEnabled] = useState(
    tenant.memberAccess.applicationsEnabled,
  );
  const [pilotApplicationsEnabled, setPilotApplicationsEnabled] = useState(
    tenant.memberAccess.pilotApplicationsEnabled,
  );
  const [dispatcherApplicationsEnabled, setDispatcherApplicationsEnabled] =
    useState(tenant.memberAccess.dispatcherApplicationsEnabled);
  const [invitationExpiryDays, setInvitationExpiryDays] = useState(
    tenant.memberAccess.invitationExpiryDays,
  );
  const save = useMutation({
    mutationFn: () =>
      api("/tenant", {
        method: "PATCH",
        schema: tenantAdministrationResponseSchema,
        ...jsonBody({
          name: name.trim(),
          memberAccess: {
            applicationsEnabled,
            pilotApplicationsEnabled,
            dispatcherApplicationsEnabled,
            invitationExpiryDays,
          },
        }),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData<TenantDetail>(
        [slug, "organization-settings", "tenant"],
        (current) =>
          current
            ? {
                ...current,
                name: updated.name,
                settings: updated.settings,
                memberAccess: updated.memberAccess,
              }
            : current,
      );
    },
  });
  const hasApplicationRole =
    pilotApplicationsEnabled || dispatcherApplicationsEnabled;

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Membership access"
        description="Control this tenant's organization name, direct-invitation lifetime, and manually approved pilot or dispatcher applications. These settings do not change global Clerk configuration."
        action={<UsersRound aria-hidden className="size-5 text-slate-700" />}
      />
      <form
        className="space-y-6 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div className="max-w-xl">
          <Label htmlFor="organization-name">Organization name</Label>
          <Input
            id="organization-name"
            required
            minLength={1}
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <HelpText>
            Saved in VA Dispatch and synchronized to this Clerk organization.
            The tenant URL slug remains fixed.
          </HelpText>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold text-slate-900">
            Self-service applications
          </legend>
          <CheckboxSetting
            checked={applicationsEnabled}
            onChange={setApplicationsEnabled}
            label="Accept membership applications"
            description="Signed-in users may request access, but cannot enter the tenant until an administrator approves them."
          />
          <div className="grid gap-3 pl-6 sm:grid-cols-2">
            <CheckboxSetting
              checked={pilotApplicationsEnabled}
              onChange={setPilotApplicationsEnabled}
              label="Pilot applications"
              description="Allow users to request pilot membership."
              disabled={!applicationsEnabled}
            />
            <CheckboxSetting
              checked={dispatcherApplicationsEnabled}
              onChange={setDispatcherApplicationsEnabled}
              label="Dispatcher applications"
              description="Allow users to request dispatcher membership."
              disabled={!applicationsEnabled}
            />
          </div>
          {applicationsEnabled && !hasApplicationRole ? (
            <p role="alert" className="text-sm font-medium text-red-700">
              Enable at least one application role.
            </p>
          ) : null}
        </fieldset>

        <div className="max-w-xs">
          <Label htmlFor="invitation-expiry">Invitation lifetime</Label>
          <Select
            id="invitation-expiry"
            value={invitationExpiryDays}
            onChange={(event) =>
              setInvitationExpiryDays(Number(event.target.value))
            }
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
          </Select>
        </div>

        <Button
          type="submit"
          disabled={
            save.isPending ||
            !name.trim() ||
            (applicationsEnabled && !hasApplicationRole)
          }
        >
          {save.isPending ? "Saving…" : "Save membership access"}
        </Button>
        {save.data ? (
          <p role="status" className="text-sm font-medium text-emerald-800">
            Membership access settings saved.
            {!save.data.clerkSynchronized
              ? " Clerk synchronization is skipped in local auth-bypass mode."
              : ""}
          </p>
        ) : null}
        {save.error ? (
          <p role="alert" className="text-sm font-medium text-red-700">
            {apiErrorMessage(save.error)}
          </p>
        ) : null}
      </form>
    </Card>
  );
}

function CheckboxSetting({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex gap-3 text-sm">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 size-4 accent-[var(--brand-action)]"
      />
      <span>
        <span className="block font-semibold text-slate-950">{label}</span>
        <span className="mt-1 block leading-5 text-slate-600">
          {description}
        </span>
      </span>
    </label>
  );
}

const PRESENCE_OPTIONS: Array<{
  value: BrandPresence;
  label: string;
  description: string;
}> = [
  {
    value: "restrained",
    label: "Restrained",
    description: "Identity at navigation and key actions.",
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "A clear airline signature without visual noise.",
  },
  {
    value: "high",
    label: "High visibility",
    description: "A stronger rail and more prominent wayfinding.",
  },
];

function BrandSettingsCard({
  slug,
  tenant,
}: {
  slug: string;
  tenant: TenantDetail;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [seedColor, setSeedColor] = useState(tenant.brand.seedColor);
  const [presence, setPresence] = useState(tenant.brand.presence);
  const [logo, setLogo] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const logoPreview = useMemo(
    () => (logo ? URL.createObjectURL(logo) : null),
    [logo],
  );

  useEffect(() => {
    return () => {
      if (logoPreview) URL.revokeObjectURL(logoPreview);
    };
  }, [logoPreview]);

  function applyBrand(brand: TenantBrand) {
    queryClient.setQueryData<TenantDetail>(
      [slug, "organization-settings", "tenant"],
      (current) => (current ? { ...current, brand } : current),
    );
  }

  const save = useMutation({
    mutationFn: () =>
      api("/tenant/brand", {
        method: "PATCH",
        schema: tenantBrandResponseSchema,
        ...jsonBody({ seedColor, presence }),
      }),
    onSuccess: ({ brand }) => {
      applyBrand(brand);
      setMessage("Brand color and presence saved.");
    },
  });
  const upload = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.set("logo", logo!);
      return api("/tenant/brand/logo", {
        method: "POST",
        schema: tenantBrandResponseSchema,
        body: form,
      });
    },
    onSuccess: ({ brand }) => {
      applyBrand(brand);
      setLogo(null);
      setMessage("Organization logo uploaded.");
    },
  });
  const clear = useMutation({
    mutationFn: () =>
      api("/tenant/brand/logo", {
        method: "DELETE",
        schema: tenantBrandResponseSchema,
      }),
    onSuccess: ({ brand }) => {
      applyBrand(brand);
      setLogo(null);
      setMessage("Uploaded logo removed. The fallback identity is active.");
    },
  });
  const previewBrand: TenantBrand = {
    seedColor,
    presence,
    logoUrl: tenant.brand.logoUrl,
  };
  const error = save.error ?? upload.error ?? clear.error;
  const busy = save.isPending || upload.isPending || clear.isPending;

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Airline identity"
        description="One square logo and one color create the complete tenant theme. All supporting tones and focus states are derived automatically."
        action={
          <Palette aria-hidden className="size-5 text-[var(--brand-action)]" />
        }
      />
      <div className="grid gap-8 p-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.8fr)]">
        <div className="space-y-7">
          <div className="grid gap-5 sm:grid-cols-[8rem_1fr]">
            <div>
              <Label htmlFor="brand-logo">Square logo</Label>
              <div
                className="mt-2 grid aspect-square w-28 place-items-center border border-slate-300 bg-white bg-contain bg-center bg-no-repeat font-display text-2xl font-black text-[var(--brand-action)]"
                style={
                  logoPreview || tenant.brand.logoUrl
                    ? {
                        backgroundImage: `url(${JSON.stringify(
                          logoPreview ?? tenant.brand.logoUrl,
                        )})`,
                      }
                    : undefined
                }
              >
                {logoPreview || tenant.brand.logoUrl
                  ? null
                  : organizationInitials(tenant.name)}
              </div>
            </div>
            <div className="self-end">
              <Input
                id="brand-logo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={async (event) => {
                  setFileError(null);
                  setMessage(null);
                  const next = event.target.files?.[0] ?? null;
                  if (!next) {
                    setLogo(null);
                    return;
                  }
                  const problem = await logoValidationError(next);
                  if (problem) {
                    setFileError(problem);
                    setLogo(null);
                    event.target.value = "";
                    return;
                  }
                  setLogo(next);
                }}
              />
              <HelpText>
                PNG, JPEG, or WebP; exactly square; up to 1 MB.
              </HelpText>
              {fileError ? (
                <p
                  role="alert"
                  className="mt-2 text-sm font-medium text-red-700"
                >
                  {fileError}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={!logo || busy}
                  onClick={() => upload.mutate()}
                >
                  <ImageUp aria-hidden className="size-4" />
                  {upload.isPending ? "Uploading…" : "Upload logo"}
                </Button>
                {tenant.brand.logoUrl ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => clear.mutate()}
                  >
                    <Trash2 aria-hidden className="size-4" /> Remove
                  </Button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[9rem_1fr] sm:items-end">
            <div>
              <Label htmlFor="brand-color">Brand color</Label>
              <input
                id="brand-color"
                type="color"
                value={seedColor}
                onChange={(event) => setSeedColor(event.target.value)}
                className="mt-2 h-11 w-full cursor-pointer border border-slate-300 bg-white p-1"
              />
            </div>
            <div>
              <Label htmlFor="brand-color-value">Hex value</Label>
              <Input
                id="brand-color-value"
                value={seedColor}
                maxLength={7}
                pattern="#[0-9a-fA-F]{6}"
                onChange={(event) => setSeedColor(event.target.value)}
              />
            </div>
          </div>

          <fieldset>
            <legend className="text-sm font-semibold text-slate-900">
              Brand presence
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {PRESENCE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={`cursor-pointer border p-3 transition ${
                    presence === option.value
                      ? "border-[var(--brand-action)] bg-[var(--brand-faint)]"
                      : "border-slate-200 hover:border-slate-400"
                  }`}
                >
                  <input
                    type="radio"
                    name="brand-presence"
                    value={option.value}
                    checked={presence === option.value}
                    onChange={() => setPresence(option.value)}
                    className="sr-only"
                  />
                  <span className="block text-sm font-bold text-slate-950">
                    {option.label}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-slate-600">
                    {option.description}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <Button
            type="button"
            disabled={busy || !/^#[0-9a-fA-F]{6}$/.test(seedColor)}
            onClick={() => {
              setMessage(null);
              save.mutate();
            }}
          >
            {save.isPending ? "Saving…" : "Save identity"}
          </Button>
          {message ? (
            <p role="status" className="text-sm font-medium text-emerald-800">
              {message}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm font-medium text-red-700">
              {apiErrorMessage(error)}
            </p>
          ) : null}
        </div>

        <BrandPreview tenant={tenant} brand={previewBrand} logo={logoPreview} />
      </div>
    </Card>
  );
}

function BrandPreview({
  tenant,
  brand,
  logo,
}: {
  tenant: TenantDetail;
  brand: TenantBrand;
  logo: string | null;
}) {
  const railWidth =
    brand.presence === "restrained"
      ? "w-1"
      : brand.presence === "high"
        ? "w-3"
        : "w-2";
  return (
    <div style={brandStyle(brand)} className="border border-slate-300 bg-white">
      <div className="flex h-14 items-center border-b border-slate-200 px-4">
        <div
          className="grid size-8 place-items-center bg-contain bg-center bg-no-repeat text-xs font-black text-[var(--brand-action)]"
          style={
            logo || tenant.brand.logoUrl
              ? {
                  backgroundImage: `url(${JSON.stringify(
                    logo ?? tenant.brand.logoUrl,
                  )})`,
                }
              : undefined
          }
        >
          {logo || tenant.brand.logoUrl
            ? null
            : organizationInitials(tenant.name)}
        </div>
        <p className="ml-3 text-sm font-bold text-slate-950">{tenant.name}</p>
        <span className="ml-auto text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Live preview
        </span>
      </div>
      <div className="grid grid-cols-[4.5rem_1fr]">
        <div className="relative min-h-72 border-r border-slate-200 bg-slate-50 p-3">
          <span
            className={`absolute inset-y-0 left-0 ${railWidth} bg-[var(--brand)] transition-all`}
          />
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              className={`mb-3 h-2 ${item === 0 ? "bg-[var(--brand-action)]" : "bg-slate-300"}`}
            />
          ))}
        </div>
        <div className="p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--brand-action)]">
            Operations
          </p>
          <p className="mt-1 font-display text-xl font-bold text-slate-950">
            Dispatch board
          </p>
          <div className="mt-5 grid grid-cols-3 border-y border-slate-200 py-3">
            {["24", "92%", "18 / 26"].map((value) => (
              <p
                key={value}
                className="text-center font-display text-lg font-bold"
              >
                {value}
              </p>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-px bg-slate-200">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="bg-white p-3">
                <div className="h-1 w-8 bg-[var(--brand)]" />
                <div className="mt-3 h-2 w-20 bg-slate-800" />
                <div className="mt-2 h-2 w-14 bg-slate-300" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

async function logoValidationError(file: File): Promise<string | null> {
  if (file.size > 1024 * 1024) return "The logo is larger than 1 MB.";
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    return "Choose a PNG, JPEG, or WebP image.";
  }
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const square = bitmap.width === bitmap.height;
    bitmap.close();
    return square ? null : "The organization logo must be square.";
  } catch {
    return "The selected image could not be read.";
  }
}

function HoppieConfigCard({
  slug,
  tenant,
}: {
  slug: string;
  tenant: TenantDetail;
}) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [station, setStation] = useState(tenant.hoppieStation ?? "");
  const [logon, setLogon] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const normalizedStation = station.trim().toUpperCase();
  const stationValid =
    normalizedStation.length > 0 &&
    normalizedStation.length <= 20 &&
    CALLSIGN_PATTERN.test(normalizedStation);

  function applyConfig(data: ReturnType<typeof acarsConfigSchema.parse>) {
    queryClient.setQueryData<TenantDetail>(
      [slug, "organization-settings", "tenant"],
      (current) => (current ? { ...current, ...data } : current),
    );
  }

  const save = useMutation({
    mutationFn: () =>
      api("/tenant/acars-config", {
        method: "PUT",
        schema: acarsConfigSchema,
        ...jsonBody({
          hoppieStation: normalizedStation,
          ...(logon.trim() ? { hoppieLogon: logon.trim() } : {}),
        }),
      }),
    onSuccess: (data) => {
      applyConfig(data);
      setLogon("");
      setStatus(
        "Hoppie accepted the credential test and the configuration was saved.",
      );
    },
  });
  const test = useMutation({
    mutationFn: () =>
      api("/tenant/acars-config/test", {
        method: "POST",
        schema: acarsConfigSchema,
      }),
    onSuccess: (data) => {
      applyConfig(data);
      setStatus("Hoppie accepted the credential test.");
    },
  });
  const disconnect = useMutation({
    mutationFn: () =>
      api("/tenant/acars-config", {
        method: "DELETE",
        schema: acarsConfigSchema,
      }),
    onSuccess: (data) => {
      applyConfig(data);
      setLogon("");
      setStatus("Hoppie credentials were removed. ACARS is now unconfigured.");
    },
  });
  const mutationError = save.error ?? test.error ?? disconnect.error;
  const busy = save.isPending || test.isPending || disconnect.isPending;

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Virtual Airline ground station"
        description="One encrypted ground-station credential sends and receives Hoppie traffic for this tenant."
        action={
          <span
            className={`inline-flex items-center gap-2 rounded-[2px] px-3 py-1 text-xs font-bold uppercase tracking-wide ${
              tenant.hasHoppieLogon
                ? "bg-emerald-100 text-emerald-800"
                : "bg-slate-100 text-slate-700"
            }`}
          >
            {tenant.hasHoppieLogon ? (
              <CircleCheck aria-hidden className="size-4" />
            ) : (
              <RadioTower aria-hidden className="size-4" />
            )}
            {tenant.hasHoppieLogon ? "Connected" : "Not configured"}
          </span>
        }
      />
      <form
        className="grid gap-5 p-5 lg:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          setStatus(null);
          if (stationValid && (tenant.hasHoppieLogon || logon.trim())) {
            save.mutate();
          }
        }}
      >
        <div>
          <Label htmlFor="hoppie-ground-station">Ground-station callsign</Label>
          <Input
            id="hoppie-ground-station"
            required
            maxLength={20}
            className="uppercase"
            value={station}
            onChange={(event) => setStation(event.target.value)}
            aria-invalid={!stationValid}
            aria-describedby="hoppie-station-help"
            placeholder="SAS"
          />
          <p
            id="hoppie-station-help"
            className={`mt-1 text-sm ${stationValid ? "text-slate-500" : "font-medium text-red-700"}`}
          >
            Normally the airline&apos;s three-letter designator. Letters,
            numbers, and hyphens only.
          </p>
        </div>
        <div>
          <Label htmlFor="hoppie-ground-logon">
            Ground-station Hoppie logon
          </Label>
          <Input
            id="hoppie-ground-logon"
            type="password"
            autoComplete="new-password"
            maxLength={128}
            value={logon}
            onChange={(event) => setLogon(event.target.value)}
            placeholder={
              tenant.hasHoppieLogon
                ? "Leave blank to keep current logon"
                : "Paste the Hoppie logon code"
            }
          />
          <HelpText>
            The API tests the code before encrypting it. The saved value is
            never returned to the browser.
          </HelpText>
        </div>
        <div className="rounded-[2px] border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 lg:col-span-2">
          <div className="flex gap-3">
            <ShieldCheck
              aria-hidden
              className="mt-0.5 size-5 shrink-0 text-emerald-700"
            />
            <div>
              <p className="font-semibold text-slate-950">
                Tenant-scoped and encrypted
              </p>
              <p>
                Dispatch sends from {normalizedStation || "this station"}.
                Members must use a Hoppie account with the same network
                affiliation. A successful send means Hoppie accepted the message
                for store-and-forward; it is not a delivery or read receipt.
              </p>
            </div>
          </div>
        </div>
        {tenant.hasHoppieLogon && !tenant.hoppiePollingEnabled ? (
          <p
            role="alert"
            className="rounded-[2px] border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 lg:col-span-2"
          >
            The saved Hoppie credential can send messages, but scheduled inbound
            polling is not active. Contact the deployment operator before using
            this ground station live.
          </p>
        ) : null}
        {tenant.hoppieLastTestedAt ? (
          <p className="text-sm text-slate-600 lg:col-span-2">
            Last successful connection test:{" "}
            <time dateTime={tenant.hoppieLastTestedAt}>
              {formatUtc(tenant.hoppieLastTestedAt)}
            </time>
          </p>
        ) : null}
        {status ? (
          <p
            role="status"
            className="rounded-[2px] bg-emerald-50 p-3 text-sm text-emerald-800 lg:col-span-2"
          >
            {status}
          </p>
        ) : null}
        {mutationError ? (
          <p
            role="alert"
            className="rounded-[2px] bg-red-50 p-3 text-sm text-red-800 lg:col-span-2"
          >
            {apiErrorMessage(mutationError)} The entered credential is retained
            in this form so you can correct or retry it manually.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3 lg:col-span-2">
          <Button
            type="submit"
            disabled={
              busy || !stationValid || (!tenant.hasHoppieLogon && !logon.trim())
            }
          >
            <KeyRound aria-hidden className="size-4" />
            {save.isPending ? "Testing and saving…" : "Test and save"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setStatus(null);
              test.mutate();
            }}
            disabled={busy || !tenant.hasHoppieLogon}
          >
            <RadioTower aria-hidden className="size-4" />
            {test.isPending ? "Testing…" : "Test saved connection"}
          </Button>
          {tenant.hasHoppieLogon ? (
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                setStatus(null);
                disconnect.mutate();
              }}
              disabled={busy}
            >
              <Unplug aria-hidden className="size-4" />
              {disconnect.isPending ? "Removing…" : "Remove credentials"}
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
