import Participant from "@/components/nuage/Participant";

export default async function NuageParticipantPage({ params }) {
  const { code } = await params;
  return <Participant code={code} />;
}
