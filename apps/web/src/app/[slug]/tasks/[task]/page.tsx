import {
  TaskChooseOrganization,
  TaskResetPassword,
  TaskSetupMFA,
} from "@clerk/nextjs";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import {
  TENANT_AUTH_APPEARANCE,
  TenantAuthShell,
} from "@/components/tenant-auth-shell";
import { getTenantAuthRoutes } from "@/lib/auth-routes";
import { getTenantConfig } from "@/lib/tenant";

export default async function SessionTaskPage({
  params,
}: {
  params: Promise<{ slug: string; task: string }>;
}) {
  const { slug, task } = await params;
  const tenant = getTenantConfig(slug);
  if (!tenant) notFound();

  const routes = getTenantAuthRoutes(tenant.slug);
  const taskProps = {
    appearance: TENANT_AUTH_APPEARANCE,
    redirectUrlComplete: routes.home,
  };
  let content: ReactNode;

  switch (task) {
    case "choose-organization":
      content = <TaskChooseOrganization {...taskProps} />;
      break;
    case "reset-password":
      content = <TaskResetPassword {...taskProps} />;
      break;
    case "setup-mfa":
      content = <TaskSetupMFA {...taskProps} />;
      break;
    default:
      notFound();
  }

  return <TenantAuthShell tenant={tenant}>{content}</TenantAuthShell>;
}
