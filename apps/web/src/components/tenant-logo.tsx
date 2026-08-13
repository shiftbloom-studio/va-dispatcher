import { organizationInitials } from "@/lib/brand";
import type { TenantConfig } from "@/lib/tenant";

export function TenantLogo({
  tenant,
  src = tenant.logo.src,
  className = "size-12",
}: {
  tenant: TenantConfig;
  src?: string | null;
  className?: string;
}) {
  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden border border-slate-200 bg-white ${className}`}
      aria-hidden={!src}
    >
      {src ? (
        // Vercel Services does not expose Next's image optimizer for the web
        // service. Tenant and Clerk logos are already small, bounded assets.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={tenant.logo.alt}
          className="size-full object-contain"
          src={src}
        />
      ) : (
        <span className="font-display text-sm font-black tracking-tight text-[var(--brand-action)]">
          {organizationInitials(tenant.name)}
        </span>
      )}
    </span>
  );
}
