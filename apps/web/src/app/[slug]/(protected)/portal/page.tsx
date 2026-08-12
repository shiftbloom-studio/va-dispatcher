import { PilotDashboard } from "@/components/pilot-dashboard";

export default async function PortalPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <PilotDashboard slug={slug} />;
}
