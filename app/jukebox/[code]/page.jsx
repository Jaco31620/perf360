import Participant from "@/components/jukebox/Participant";
import { loadSession, publicSession } from "@/lib/jukeboxServer";

/* Aperçu du lien (WhatsApp, SMS…) : nom de la soirée. */
export async function generateMetadata({ params }) {
  const { code } = await params;
  try {
    const s = await loadSession(code);
    if (s) {
      const name = publicSession(s).theme?.title || s.name;
      const description = "C'est vous qui choisissez la musique : proposez vos titres depuis votre téléphone 🎶";
      return { title: `🎶 ${name} — Jukebox`, description, openGraph: { title: `🎶 ${name}`, description, type: "website" } };
    }
  } catch (e) { /* aperçu générique */ }
  return {};
}

export default async function JukeboxParticipantPage({ params }) {
  const { code } = await params;
  return <Participant code={code} />;
}
