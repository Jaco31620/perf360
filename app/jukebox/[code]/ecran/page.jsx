import Ecran from "@/components/jukebox/Ecran";

export const metadata = { title: "Écran — Jukebox" };

export default async function JukeboxEcranPage({ params }) {
  const { code } = await params;
  return <Ecran code={code} />;
}
