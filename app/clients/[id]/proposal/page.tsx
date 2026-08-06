import LeadProposalWorkspace from "@/components/clients/LeadProposalWorkspace";
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ calculationId?: string }> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  return <LeadProposalWorkspace clientId={Number(id)} initialCalculationId={Number(query.calculationId) || undefined} />;
}
