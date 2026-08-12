"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
} from "react";

import { Button } from "@/components/ui/button";
import {
  clearPrivacyPreferences,
  OPEN_COOKIE_SETTINGS_EVENT,
  PRIVACY_PREFERENCES_CHANGED_EVENT,
  readPrivacyPreferences,
  savePrivacyPreferences,
  type PrivacyPreferencesRecord,
} from "@/lib/privacy-storage";

export function CookieSettingsButton({
  className = "",
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`rounded-sm underline decoration-slate-400 underline-offset-4 transition hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${className}`}
      onClick={(event) => {
        window.dispatchEvent(new Event(OPEN_COOKIE_SETTINGS_EVENT));
        onClick?.(event);
      }}
      {...props}
    >
      Cookie settings
    </button>
  );
}

export function PrivacyControls() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [initialized, setInitialized] = useState(false);
  const [preferences, setPreferences] =
    useState<PrivacyPreferencesRecord | null>(null);

  const openSettings = useCallback(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    const initialize = window.setTimeout(() => {
      setPreferences(readPrivacyPreferences(window.localStorage));
      setInitialized(true);
    }, 0);

    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, openSettings);
    return () => {
      window.clearTimeout(initialize);
      window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, openSettings);
    };
  }, [openSettings]);

  function chooseAnalytics(analyticsAllowed: boolean): void {
    const nextPreferences = savePrivacyPreferences(
      window.localStorage,
      analyticsAllowed,
    );
    setPreferences(nextPreferences);
    window.dispatchEvent(new Event(PRIVACY_PREFERENCES_CHANGED_EVENT));
  }

  function showNoticeAgain(): void {
    clearPrivacyPreferences(window.localStorage);
    setPreferences(null);
    window.dispatchEvent(new Event(PRIVACY_PREFERENCES_CHANGED_EVENT));
    dialogRef.current?.close();
  }

  const noticeVisible = initialized && !preferences;

  return (
    <>
      {noticeVisible ? (
        <aside
          aria-label="Cookie notice"
          className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-3xl rounded-[2px] border border-slate-700 bg-slate-950 p-4 text-white shadow-2xl sm:p-5"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-lg font-bold">Your privacy</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-300">
                Secure sign-in and abuse protection are always active. Optional,
                cookie-free Vercel Analytics and Speed Insights stay off unless
                you allow them. We never use advertising or marketing trackers.
              </p>
              <Link
                href="/privacy#cookies-and-local-storage"
                className="mt-2 inline-flex text-sm font-semibold text-white underline decoration-slate-500 underline-offset-4 hover:decoration-white"
              >
                Read cookie details
              </Link>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                className="border-slate-500"
                onClick={openSettings}
              >
                Details
              </Button>
              <Button
                variant="secondary"
                className="border-slate-500"
                onClick={() => chooseAnalytics(false)}
              >
                Continue without analytics
              </Button>
              <Button
                variant="secondary"
                className="border-slate-500"
                onClick={() => chooseAnalytics(true)}
              >
                Allow anonymous analytics
              </Button>
            </div>
          </div>
        </aside>
      ) : null}

      <dialog
        ref={dialogRef}
        aria-labelledby="cookie-settings-title"
        className="m-auto w-[min(42rem,calc(100%-2rem))] rounded-[2px] border border-slate-200 bg-white p-0 text-slate-950 shadow-2xl backdrop:bg-slate-950/70"
      >
        <div className="p-5 sm:p-7">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-700">
            Privacy controls
          </p>
          <h2
            id="cookie-settings-title"
            className="mt-2 font-display text-2xl font-semibold"
          >
            Cookies and local storage
          </h2>
          <p className="mt-3 leading-7 text-slate-600">
            Authentication and BotID security are necessary to provide and
            protect the signed-in service. Optional Vercel Web Analytics and
            Speed Insights load only with your permission. This deployment has
            no advertising or marketing category.
          </p>

          <div className="mt-5 space-y-3">
            <section className="rounded-[2px] border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">Authentication and security</h3>
                <span className="rounded-[2px] bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                  Always active
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Clerk uses cookies such as <code>__session</code> and{" "}
                <code>__client_uat</code> to sign you in and protect sessions.
                Vercel BotID runs a browser challenge and sends proof with
                protected requests to prevent automated abuse.
              </p>
            </section>
            <section className="rounded-[2px] border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">
                  Anonymous usage and performance
                </h3>
                <span
                  aria-live="polite"
                  className="rounded-[2px] bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700"
                >
                  {preferences?.analyticsAllowed ? "Allowed" : "Off"}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Vercel Web Analytics records anonymized page-use statistics
                without analytics cookies. Speed Insights reports browser
                performance metrics. Neither service loads before you allow it.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  aria-pressed={preferences?.analyticsAllowed === false}
                  onClick={() => chooseAnalytics(false)}
                >
                  Use without analytics
                </Button>
                <Button
                  variant="secondary"
                  aria-pressed={preferences?.analyticsAllowed === true}
                  onClick={() => chooseAnalytics(true)}
                >
                  Allow analytics
                </Button>
              </div>
            </section>
            <section className="rounded-[2px] border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">Privacy preference</h3>
                <span className="rounded-[2px] bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                  Local only
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                The browser stores the notice version, your analytics choice,
                and the decision time in local storage. It is not sent
                automatically with web requests and is replaced when the notice
                changes.
              </p>
            </section>
          </div>

          <p className="mt-5 text-sm text-slate-600">
            Full details are in the{" "}
            <Link
              href="/privacy#cookies-and-local-storage"
              className="font-semibold text-slate-950 underline underline-offset-4"
              onClick={() => dialogRef.current?.close()}
            >
              Privacy Notice
            </Link>
            .
          </p>

          <div className="mt-6 flex flex-wrap justify-end gap-2">
            {preferences ? (
              <Button variant="ghost" onClick={showNoticeAgain}>
                Show notice again
              </Button>
            ) : null}
            <Button onClick={() => dialogRef.current?.close()}>Close</Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
