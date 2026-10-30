import Regie from "@/components/jukebox/Regie";

export const metadata = { title: "Régie — Jukebox" };

export default async function JukeboxRegiePage({ params }) {
  const { code } = await params;
  return <Regie code={code} />;
}
