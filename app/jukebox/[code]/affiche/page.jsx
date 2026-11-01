import Affiche from "@/components/jukebox/Affiche";

export const metadata = { title: "Affiche — Jukebox" };

export default async function JukeboxAffichePage({ params }) {
  const { code } = await params;
  return <Affiche code={code} />;
}
