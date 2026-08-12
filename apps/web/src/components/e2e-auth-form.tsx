"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { E2E_IDENTITY_COOKIE, type E2eIdentity } from "@/lib/e2e-fixture";

export function E2eAuthForm({
  slug,
  mode,
}: {
  slug: string;
  mode: "sign-in" | "sign-up";
}) {
  const router = useRouter();
  const [identity, setIdentity] =
    useState<Exclude<E2eIdentity, "signed-out" | "outsider">>("pilot");

  function continueToApplication() {
    document.cookie = `${E2E_IDENTITY_COOKIE}=${identity}; Path=/; SameSite=Lax`;
    router.replace(`/${slug}`);
    router.refresh();
  }

  return (
    <section aria-labelledby="fixture-auth-title" className="bg-white p-6">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-[var(--brand-action)]">
        Integrated test identity
      </p>
      <h2
        id="fixture-auth-title"
        className="mt-2 font-display text-3xl font-black text-slate-950"
      >
        {mode === "sign-in" ? "Sign in" : "Create test account"}
      </h2>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        This isolated browser harness uses synthetic members in disposable
        PostgreSQL. It never contacts Clerk or a live provider.
      </p>
      <fieldset className="mt-6 space-y-2">
        <legend className="mb-2 text-sm font-bold text-slate-800">
          Continue as
        </legend>
        {(["pilot", "dispatcher", "admin"] as const).map((candidate) => (
          <label
            key={candidate}
            className="flex min-h-11 items-center gap-3 border border-slate-300 px-3 text-sm font-bold capitalize"
          >
            <input
              type="radio"
              name="fixture-identity"
              value={candidate}
              checked={identity === candidate}
              onChange={() => setIdentity(candidate)}
            />
            {candidate}
          </label>
        ))}
      </fieldset>
      <Button className="mt-6 w-full" onClick={continueToApplication}>
        Continue to {identity} workspace
      </Button>
    </section>
  );
}
