import CalendarPage from "@/components/pages/CalendarPage";

export default async function Page({ searchParams }: { searchParams: Promise<{ state?: string | string[] }> }) {
  const params = await searchParams;
  return <CalendarPage initialState={typeof params.state === "string" ? params.state : undefined}/>;
}
