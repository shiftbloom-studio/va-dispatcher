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
  clearCookieNotice,
  OPEN_COOKIE_SETTINGS_EVENT,
  readCookieNotice,
  saveCookieNotice,
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
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const openSettings = useCallback(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    const initialize = window.setTimeout(() => {
      const stored = readCookieNotice(window.localStorage);
      setAcknowledged(Boolean(stored));
      setNoticeVisible(!stored);
    }, 0);

    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, openSettings);
    return () => {
      window.clearTimeout(initialize);
      window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, openSettings);
    };
  }, [openSettings]);

  function acknowledge(): void {
    saveCookieNotice(window.localStorage);
    setAcknowledged(true);
    setNoticeVisible(false);
  }

  function showNoticeAgain(): void {
    clearCookieNotice(window.localStorage);
    setAcknowledged(false);
    setNoticeVisible(true);
    dialogRef.current?.close();
  }

  return (
    <>
      {noticeVisible ? (
        <aside
          aria-label="Cookie notice"
          className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-3xl rounded-2xl border border-slate-700 bg-slate-950 p-4 text-white shadow-2xl sm:p-5"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-lg font-bold">Your privacy</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-300">
                We use only technically necessary storage for secure sign-in and
                to remember this notice. We do not use analytics, advertising,
                or marketing cookies.
              </p>
              <Link
                href="/privacy#cookies-and-local-storage"
                className="mt-2 inline-flex text-sm font-semibold text-white underline decoration-slate-500 underline-offset-4 hover:decoration-white"
              >
                Read cookie details
              </Link>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                variant="secondary"
                className="border-slate-500"
                onClick={openSettings}
              >
                Details
              </Button>
              <Button onClick={acknowledge}>Understood</Button>
            </div>
          </div>
        </aside>
      ) : null}

      <dialog
        ref={dialogRef}
        aria-labelledby="cookie-settings-title"
        className="m-auto w-[min(42rem,calc(100%-2rem))] rounded-2xl border border-slate-200 bg-white p-0 text-slate-950 shadow-2xl backdrop:bg-slate-950/70"
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
            This deployment has no optional advertising or marketing category to
            accept or reject. Vercel&apos;s cookie-free Web Analytics,
            performance reporting, and BotID protection are described in the
            Privacy Notice. Authentication and security storage is essential to
            provide and protect the signed-in service.
          </p>

          <div className="mt-5 space-y-3">
            <section className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">Authentication and security</h3>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                  Always active
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Clerk uses cookies such as <code>__session</code>,{" "}
                <code>__client</code>, and <code>__client_uat</code> to sign you
                in, protect sessions, and prevent abuse. Vercel BotID may use
                <code> KP_*</code> security keys to validate protected requests.
                Their lifetimes are controlled by the respective provider.
              </p>
            </section>
            <section className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">Cookie-notice acknowledgement</h3>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                  Local only
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                The browser stores only the notice version and acknowledgement
                time in local storage. It is not sent with web requests and is
                replaced when the notice changes.
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
            {acknowledged ? (
              <Button variant="ghost" onClick={showNoticeAgain}>
                Show notice again
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => {
                  acknowledge();
                  dialogRef.current?.close();
                }}
              >
                Acknowledge notice
              </Button>
            )}
            <Button onClick={() => dialogRef.current?.close()}>Close</Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
