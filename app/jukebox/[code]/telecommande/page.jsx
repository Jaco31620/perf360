import Telecommande from "@/components/jukebox/Telecommande";

export const metadata = { title: "Télécommande — Jukebox", robots: { index: false } };
export const viewport = { themeColor: "#030712", width: "device-width", initialScale: 1 };

export default async function JukeboxTelecommandePage({ params }) {
  const { code } = await params;
  return <Telecommande code={code} />;
}
