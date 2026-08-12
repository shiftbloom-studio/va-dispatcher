import Image from "next/image";

import { organizationInitials } from "@/lib/brand";
import type { TenantConfig } from "@/lib/tenant";

export function TenantLogo({
  tenant,
  className = "size-12",
  sizes = "48px",
}: {
  tenant: TenantConfig;
  className?: string;
  sizes?: string;
}) {
  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden border border-slate-200 bg-white ${className}`}
      aria-hidden={!tenant.logo.src}
    >
      {tenant.logo.src ? (
        <Image
          alt={tenant.logo.alt}
          className="object-contain"
          fill
          sizes={sizes}
          src={tenant.logo.src}
        />
      ) : (
        <span className="font-display text-sm font-black tracking-tight text-[var(--brand-action)]">
          {organizationInitials(tenant.name)}
        </span>
      )}
    </span>
  );
}
