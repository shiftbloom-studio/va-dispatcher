import { statusLabel, statusTone } from "@/lib/status";

const tones = {
  neutral: "border-slate-300 bg-slate-100 text-slate-700",
  info: "border-sky-200 bg-sky-50 text-sky-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-300 bg-amber-50 text-amber-950",
  danger: "border-red-200 bg-red-50 text-red-800",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex border px-2 py-1 text-[10px] font-black uppercase tracking-wide ${tones[statusTone(status)]}`}
    >
      {statusLabel(status)}
    </span>
  );
}
