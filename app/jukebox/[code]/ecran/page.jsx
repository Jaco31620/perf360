import Ecran from "@/components/jukebox/Ecran";

export const metadata = { title: "Écran — Jukebox" };

/* ?son=1 : la télé joue aussi la musique (jumelée depuis perf360.fr/tv). */
export default async function JukeboxEcranPage({ params, searchParams }) {
  const { code } = await params;
  const { son } = await searchParams;
  return <Ecran code={code} sound={son === "1"} />;
}
