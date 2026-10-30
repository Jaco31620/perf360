import Participant from "@/components/jukebox/Participant";

export default async function JukeboxParticipantPage({ params }) {
  const { code } = await params;
  return <Participant code={code} />;
}
