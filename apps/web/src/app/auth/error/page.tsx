import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { SiteFooter } from "@/components/site-footer";

const REASONS: Record<string, string> = {
  denied: "Sign-in was cancelled.",
  state:
    "The sign-in link expired or was opened in another browser. Start again from the sign-in page.",
  provider:
    "The account service could not complete the sign-in. Try again in a moment.",
};

export const metadata = { title: "Sign-in failed" };

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const message = REASONS[reason ?? ""] ?? REASONS.provider;

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-white">
      <main id="main-content" className="grid flex-1 place-items-center p-6">
        <section className="w-full max-w-lg rounded-[2px] bg-white p-6 text-slate-950 shadow-2xl sm:p-8">
          <div className="grid size-12 place-items-center rounded-[2px] bg-red-100 text-red-700">
            <ShieldAlert aria-hidden className="size-6" />
          </div>
          <h1 className="mt-5 font-display text-3xl font-semibold">
            Sign-in failed
          </h1>
          <p className="mt-3 leading-6 text-slate-600">{message}</p>
          <Link
            href="/"
            prefetch={false}
            className="mt-6 inline-flex min-h-11 items-center bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Back to VA Dispatch
          </Link>
        </section>
      </main>
      <SiteFooter tone="dark" className="border-t border-slate-800" />
    </div>
  );
}
