/*
 * Route PUBLIQUE — réponse d'un invité au blind test (mode « réponses sur
 * téléphone »). Body : { participantId, author, answer }.
 * Correction côté serveur (lib/jukeboxBlind.js) ; chaque élément (artiste,
 * titre) ne rapporte qu'une fois : 50 points + bonus de rapidité. Au plus
 * MAX_ATTEMPTS essais par titre, et plus rien une fois la réponse dévoilée.
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadSession } from "@/lib/jukeboxServer";
import { MAX_AUTHOR_LEN } from "@/lib/jukebox";
import { checkAnswer, pointsFor, MAX_ANSWER_LEN, MAX_ATTEMPTS } from "@/lib/jukeboxBlind";
import { sessionBlind, expectedParts, revealedFor, playPos } from "@/lib/jukeboxBlindServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req, { params }) {
  const { code } = await params;
  let body;
  try { body = await req.json(); } catch (e) { return Response.json({ error: "Requête invalide." }, { status: 400 }); }
  const pid = String(body?.participantId || "");
  const author = String(body?.author || "").replace(/\s+/g, " ").trim().slice(0, MAX_AUTHOR_LEN);
  const answer = String(body?.answer || "").trim().slice(0, MAX_ANSWER_LEN);
  if (!/^[a-z0-9-]{8,64}$/i.test(pid)) return Response.json({ error: "Participant invalide." }, { status: 400 });
  if (!author) return Response.json({ error: "Merci d'indiquer votre prénom." }, { status: 400 });
  if (!answer) return Response.json({ error: "Réponse vide." }, { status: 400 });

  try {
    const s = await loadSession(code);
    if (!s) return Response.json({ error: "Soirée introuvable." }, { status: 404 });
    const blind = sessionBlind(s);
    if (!blind?.on || blind.mode !== "phone") return Response.json({ error: "Pas de blind test en cours." }, { status: 409 });
    const sb = getSupabaseAdmin();
    const { data: now } = await sb.from("jukebox_tracks").select("*").eq("session_id", s.id).eq("status", "playing").maybeSingle();
    if (!now) return Response.json({ error: "Attendez le prochain titre !" }, { status: 409 });
    if (revealedFor(s, blind, now) !== null) return Response.json({ error: "Trop tard, la réponse est dévoilée !" }, { status: 409 });

    const { data: row } = await sb.from("jukebox_answers").select("*").eq("track_id", now.id).eq("participant_id", pid).maybeSingle();
    if ((row?.attempts || 0) >= MAX_ATTEMPTS) return Response.json({ error: "Plus d'essai pour ce titre." }, { status: 429 });
    if (row?.artist_ok && row?.title_ok) return Response.json({ error: "Vous avez déjà tout trouvé !" }, { status: 409 });

    const parts = expectedParts(now);
    const hit = checkAnswer(answer, parts.artist, parts.title);
    const elapsed = playPos(s, now); // temps d'écoute, pauses exclues
    const newArtist = hit.artist && !row?.artist_ok;
    const newTitle = hit.title && !row?.title_ok;
    const gained = (newArtist ? pointsFor(elapsed, blind.reveal) : 0) + (newTitle ? pointsFor(elapsed, blind.reveal) : 0);
    const next = {
      session_id: s.id, track_id: now.id, participant_id: pid, author,
      artist_ok: !!(row?.artist_ok || hit.artist), title_ok: !!(row?.title_ok || hit.title),
      points: (row?.points || 0) + gained, attempts: (row?.attempts || 0) + 1, last_answer: answer,
      tries: [...(Array.isArray(row?.tries) ? row.tries : []), { a: answer, artist: hit.artist, title: hit.title }],
    };
    // écriture conditionnelle : des réponses envoyées en rafale ne contournent
    // pas la limite d'essais et n'écrasent pas un élément trouvé
    const busy = () => Response.json({ error: "Une réponse à la fois !" }, { status: 409 });
    if (row) {
      const { data: done, error } = await sb.from("jukebox_answers").update(next)
        .eq("track_id", now.id).eq("participant_id", pid).eq("attempts", row.attempts || 0).select("track_id");
      if (error) throw error;
      if (!done?.length) return busy();
    } else {
      const { error } = await sb.from("jukebox_answers").insert(next);
      if (error?.code === "23505") return busy(); // première réponse envoyée deux fois
      if (error) throw error;
    }
    return Response.json({
      ok: true, artist: next.artist_ok, title: next.title_ok, newArtist, newTitle, gained,
      points: next.points, attemptsLeft: MAX_ATTEMPTS - next.attempts,
    });
  } catch (e) {
    console.error("jukebox answer:", e);
    return Response.json({ error: "Réponse non enregistrée, réessayez." }, { status: 502 });
  }
}
