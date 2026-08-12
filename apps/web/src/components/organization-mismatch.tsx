import { OrganizationList } from "@clerk/nextjs";
import { ShieldAlert } from "lucide-react";

import { SiteFooter } from "@/components/site-footer";

export function OrganizationMismatch({
  tenantName,
  reason,
}: {
  tenantName: string;
  reason: string;
}) {
  const bypass =
    process.env.E2E_AUTH_BYPASS === "true" &&
    process.env.NODE_ENV !== "production";

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-white">
      <main id="main-content" className="grid flex-1 place-items-center p-6">
        <section className="w-full max-w-lg rounded-[2px] bg-white p-6 text-slate-950 shadow-2xl sm:p-8">
          <div className="grid size-12 place-items-center rounded-[2px] bg-red-100 text-red-700">
            <ShieldAlert aria-hidden className="size-6" />
          </div>
          <h1 className="mt-5 font-display text-3xl font-semibold">
            Select the correct organization
          </h1>
          <p className="mt-3 leading-6 text-slate-600">
            {reason} No {tenantName} operational data was loaded.
          </p>
          {bypass ? (
            <p className="mt-6 rounded-[2px] bg-amber-50 p-3 text-sm text-amber-900">
              Organization selection is unavailable in fixture mode.
            </p>
          ) : (
            <div className="mt-6 overflow-hidden rounded-[2px] border border-slate-200 p-2">
              <OrganizationList
                hidePersonal
                afterSelectOrganizationUrl="/:slug"
              />
            </div>
          )}
        </section>
      </main>
      <SiteFooter className="border-t border-slate-800 text-slate-400 [&_a:hover]:text-white [&_button:hover]:text-white" />
    </div>
  );
}
