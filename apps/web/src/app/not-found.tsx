import Link from "next/link";

export default function NotFound() {
  return (
    <main
      id="main-content"
      className="grid min-h-screen place-items-center bg-slate-950 p-6 text-white"
    >
      <div className="max-w-md text-center">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-red-400">
          404
        </p>
        <h1 className="mt-3 font-display text-4xl font-semibold">
          Route not found
        </h1>
        <p className="mt-3 text-slate-300">
          This Virtual Airline workspace or operational page does not exist.
        </p>
        <Link
          href="/vsas"
          className="mt-6 inline-flex min-h-11 items-center rounded-[2px] bg-white px-4 py-2 font-bold text-slate-950"
        >
          Return to vSAS
        </Link>
      </div>
    </main>
  );
}
