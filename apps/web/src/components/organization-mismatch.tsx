import { ShieldAlert } from "lucide-react";

import { SignOutForm } from "@/components/identity-sign-in";
import { SiteFooter } from "@/components/site-footer";
import { e2eFixtureEnabled } from "@/lib/e2e-fixture";

export function OrganizationMismatch({
  tenantName,
  reason,
}: {
  tenantName: string;
  reason: string;
}) {
  const bypass = e2eFixtureEnabled();

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-white">
      <main id="main-content" className="grid flex-1 place-items-center p-6">
        <section className="w-full max-w-lg rounded-[2px] bg-white p-6 text-slate-950 shadow-2xl sm:p-8">
          <div className="grid size-12 place-items-center rounded-[2px] bg-red-100 text-red-700">
            <ShieldAlert aria-hidden className="size-6" />
          </div>
          <h1 className="mt-5 font-display text-3xl font-semibold">
            This account does not match
          </h1>
          <p className="mt-3 leading-6 text-slate-600">
            {reason} No {tenantName} operational data was loaded.
          </p>
          {bypass ? (
            <p className="mt-6 rounded-[2px] bg-amber-50 p-3 text-sm text-amber-900">
              Switching accounts is unavailable in fixture mode.
            </p>
          ) : (
            <p className="mt-6 text-sm text-slate-600">
              Signed in with a different account? <SignOutForm />
            </p>
          )}
        </section>
      </main>
      <SiteFooter className="border-t border-slate-800 text-slate-400 [&_a:hover]:text-white [&_button:hover]:text-white" />
    </div>
  );
}
