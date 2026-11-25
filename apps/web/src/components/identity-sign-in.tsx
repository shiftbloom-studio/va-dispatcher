import { LogIn, UserPlus } from "lucide-react";

/**
 * Hands the visitor to stem, the shared shiftbloom account service. stem
 * asks for an email address and sends a one-time code; a first sign-in
 * creates the account.
 */
export function IdentitySignIn({
  mode,
  returnTo,
  signInHref,
  signUpHref,
}: {
  mode: "sign-in" | "sign-up";
  returnTo: string;
  signInHref: string;
  signUpHref: string;
}) {
  const start = `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
  const Icon = mode === "sign-in" ? LogIn : UserPlus;

  return (
    <section
      aria-labelledby="identity-sign-in-title"
      className="border border-slate-300 bg-white p-6 sm:p-8"
    >
      <h2
        id="identity-sign-in-title"
        className="font-display text-3xl font-semibold text-slate-950"
      >
        {mode === "sign-in" ? "Sign in" : "Create your account"}
      </h2>
      <p className="mt-3 text-pretty text-sm leading-6 text-slate-600">
        {mode === "sign-in"
          ? "Continue with your shiftbloom account. We send a one-time code to your email address, no password needed."
          : "Your shiftbloom account works for every Virtual Airline on VA Dispatch. Enter your email address and confirm it with the code we send you. Then apply to join."}
      </p>
      <a
        href={start}
        className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[2px] border border-[var(--brand-action)] bg-[var(--brand-action)] px-4 py-2 text-sm font-bold text-[var(--brand-on-action)] transition-[filter] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-action)]"
      >
        <Icon aria-hidden className="size-4" />
        {mode === "sign-in" ? "Continue to sign in" : "Continue to sign up"}
      </a>
      <p className="mt-5 text-center text-sm text-slate-600">
        {mode === "sign-in" ? (
          <>
            New here?{" "}
            <a
              href={signUpHref}
              className="font-semibold text-[var(--brand-action)] underline underline-offset-4"
            >
              Create an account
            </a>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <a
              href={signInHref}
              className="font-semibold text-[var(--brand-action)] underline underline-offset-4"
            >
              Sign in
            </a>
          </>
        )}
      </p>
    </section>
  );
}

/** Ends the app session and stem's. A form, because sign-out is a POST. */
export function SignOutForm({
  className = "",
  children = "Sign out",
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <form method="post" action="/auth/logout" className="inline">
      <button
        type="submit"
        className={
          className ||
          "font-semibold text-[var(--brand-action)] underline underline-offset-4"
        }
      >
        {children}
      </button>
    </form>
  );
}
