import { organizationInitials } from "@/lib/brand";
import type { TenantConfig } from "@/lib/tenant";

export function TenantLogo({
  tenant,
  src = tenant.logo.src,
  className = "size-12",
  variant = "mark",
}: {
  tenant: TenantConfig;
  src?: string | null;
  className?: string;
  variant?: "mark" | "wordmark";
}) {
  const wordmark = variant === "wordmark";
  const cropVsasWordmark = wordmark && tenant.slug === "vsas";

  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden bg-white ${
        wordmark ? "" : "border border-slate-200"
      } ${className}`}
      data-variant={variant}
      role={src ? undefined : "img"}
      aria-label={src ? undefined : tenant.logo.alt}
    >
      {src ? (
        // Vercel Services does not expose Next's image optimizer for the web
        // service. Tenant and Clerk logos are already small, bounded assets.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={tenant.logo.alt}
          className={`absolute inset-0 h-full w-full ${
            cropVsasWordmark ? "object-cover" : "object-contain"
          }`}
          src={src}
        />
      ) : (
        <span
          aria-hidden="true"
          className={`font-display font-black tracking-tight text-[var(--brand-action)] ${
            wordmark ? "text-base" : "text-sm"
          }`}
        >
          {wordmark ? tenant.shortName : organizationInitials(tenant.name)}
        </span>
      )}
    </span>
  );
}
