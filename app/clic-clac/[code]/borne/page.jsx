import Booth from "@/components/clicclac/Booth";

export const metadata = { title: "Borne — Clic-Clac" };

export default async function ClicClacBoothPage({ params }) {
  const { code } = await params;
  return <Booth code={code.toUpperCase()} />;
}
