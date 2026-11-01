/*
 * Jukebox — mode d'emploi public (/jukebox/aide), lié depuis l'accueil, la
 * régie, la télécommande et les messages envoyés aux organisateurs.
 * Ancres : #principe #tele #pc #pc-tele #invites #piloter #blind #faq.
 */
import Link from "next/link";

export const metadata = {
  title: "Mode d'emploi — Jukebox perf360",
  description: "Installer le Jukebox pour une soirée : télé, ordinateur, téléphone, invités, blind test.",
};

const SETUPS = [
  { id: "tele", icon: "📺", title: "Télé + téléphone", tag: "le plus simple", text: "La télé joue la musique et affiche les clips, vous pilotez depuis votre téléphone." },
  { id: "pc", icon: "💻", title: "Ordinateur + sono", tag: "son de qualité", text: "L'ordinateur, branché sur la sono, joue la musique." },
  { id: "pc-tele", icon: "🔀", title: "Ordinateur + télé", tag: "les deux", text: "Le son sur l'un, l'image sur l'autre ; vous changez en un clic." },
];

function Section({ id, icon, title, children }) {
  return (
    <section id={id} className="bg-white rounded-3xl p-6 sm:p-7 shadow-xl scroll-mt-6">
      <h2 className="text-xl font-black text-gray-900 mb-3">{icon} {title}</h2>
      <div className="space-y-3 text-gray-700 leading-relaxed">{children}</div>
    </section>
  );
}

function Steps({ children }) {
  return <ol className="space-y-2.5">{children}</ol>;
}
function Step({ n, children }) {
  return (
    <li className="flex gap-3">
      <span className="shrink-0 w-7 h-7 rounded-full bg-fuchsia-600 text-white text-sm font-bold flex items-center justify-center">{n}</span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}
const Tip = ({ children }) => <p className="text-sm bg-fuchsia-50 text-fuchsia-900 rounded-2xl px-4 py-3">💡 {children}</p>;
const B = ({ children }) => <b className="text-gray-900">{children}</b>;

function Faq({ q, children }) {
  return (
    <details className="group border-b border-gray-100 last:border-0 py-3">
      <summary className="cursor-pointer font-semibold text-gray-900 list-none flex justify-between gap-3">
        {q}<span className="text-gray-400 group-open:rotate-180 transition-transform">▾</span>
      </summary>
      <div className="mt-2 text-gray-700 text-sm leading-relaxed space-y-2">{children}</div>
    </details>
  );
}

export default function JukeboxHelp() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-fuchsia-600 via-purple-700 to-indigo-900 px-4 py-8">
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="flex justify-between items-center text-white text-sm">
          <Link href="/jukebox" className="font-bold opacity-90 hover:opacity-100">← Jukebox</Link>
        </div>

        <header className="text-center text-white pb-2">
          <div className="text-5xl mb-2">🎶</div>
          <h1 className="text-4xl font-black tracking-tight">Mode d'emploi</h1>
          <p className="mt-3 text-white/85 text-lg">Les invités proposent leurs titres depuis leur téléphone, la musique s'enchaîne toute seule.</p>
        </header>

        <Section id="principe" icon="✨" title="Le principe">
          <p>Chaque soirée a un <B>code à 6 chiffres</B> et un <B>QR code</B> affiché à l'écran. Les invités le scannent, tapent leur prénom et cherchent leurs titres : ils s'ajoutent à la file et passent chacun leur tour.</p>
          <p>Vous, l'organisateur, gardez la main : <B>télécommande</B> sur votre téléphone ou <B>régie</B> sur un ordinateur (pause, titre suivant, volume, ordre de la file, ajouts ouverts ou bloqués…).</p>
          <p className="font-semibold text-gray-900 pt-1">Choisissez votre installation :</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {SETUPS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="block rounded-2xl border-2 border-gray-100 hover:border-fuchsia-300 p-3 transition-colors">
                <span className="text-2xl">{s.icon}</span>
                <span className="block font-bold text-gray-900 mt-1">{s.title}</span>
                <span className="block text-[11px] font-bold uppercase tracking-wider text-fuchsia-600">{s.tag}</span>
                <span className="block text-xs text-gray-500 mt-1">{s.text}</span>
              </a>
            ))}
          </div>
        </Section>

        <Section id="tele" icon="📺" title="Télé + téléphone">
          <p>Une télé connectée (avec un navigateur internet) suffit : elle joue la musique et affiche les clips.</p>
          <Steps>
            <Step n="1">Sur la télé, ouvrez le navigateur internet et allez sur <B>perf360.fr/tv</B>. Un QR code s'affiche.</Step>
            <Step n="2">Sur votre téléphone, ouvrez la <B>télécommande</B> de la soirée (le lien reçu, ou « Mes soirées » sur perf360.fr/jukebox), puis <B>📺 Connecter une télé</B>.</Step>
            <Step n="3">Choisissez <B>🔊 Affichage + son</B> et scannez le QR code de la télé. Trop loin ? Zoomez avec les boutons ×2, ×3… ou en écartant deux doigts.</Step>
            <Step n="4">La télé ouvre la soirée et lance la musique. Si rien ne démarre, appuyez sur <B>OK</B> avec la télécommande de la télé (certaines télés exigent un appui avant de jouer du son).</Step>
          </Steps>
          <Tip>Le son de la télé n'est pas assez fort ? Reliez-la à une enceinte ou une barre de son (câble, optique ou Bluetooth de la télé).</Tip>
        </Section>

        <Section id="pc" icon="💻" title="Ordinateur + sono">
          <Steps>
            <Step n="1">Branchez l'ordinateur sur la sono (prise casque, ou enceinte Bluetooth).</Step>
            <Step n="2">Ouvrez la <B>régie</B> de la soirée (le lien reçu) et cliquez <B>▶ Lancer la musique</B>.</Step>
            <Step n="3">Pour que les invités voient les clips et le QR code : dans <B>🔧 Outils</B>, <B>📺 Ouvrir l'écran d'affichage</B> sur un 2e écran ou un vidéoprojecteur.</Step>
          </Steps>
          <Tip>Gardez l'ordinateur branché sur secteur et la page de la régie ouverte toute la soirée.</Tip>
        </Section>

        <Section id="pc-tele" icon="🔀" title="Ordinateur + télé">
          <p>Un seul appareil joue le son à la fois : jamais de son en double.</p>
          <ul className="space-y-2 list-disc pl-5">
            <li><B>Son sur la télé</B> : connectez la télé en <B>🔊 Affichage + son</B> (voir plus haut). La régie affiche « Le son est joué par la télé » et ses boutons pilotent la télé.</li>
            <li><B>Son sur l'ordinateur</B> : sur la régie, <B>Prendre le son ici</B>. La télé continue d'afficher les clips, en muet.</li>
            <li><B>Revenir sur la télé</B> : <B>📺 Renvoyer le son sur la télé</B> (régie) ou <B>📺 Mettre le son sur la télé</B> (télécommande).</li>
          </ul>
          <Tip>Pour que la télé puisse reprendre le son, elle doit avoir été connectée au moins une fois en « Affichage + son ».</Tip>
        </Section>

        <Section id="invites" icon="🎤" title="Inviter les gens">
          <ul className="space-y-2 list-disc pl-5">
            <li>Le <B>QR code</B> et le code de la soirée sont affichés sur l'écran (télé, vidéoprojecteur).</li>
            <li>Vous pouvez aussi <B>imprimer une affiche</B> avec le QR code, ou <B>envoyer le lien</B> dans le groupe de la soirée (régie ou télécommande, onglet des outils).</li>
            <li>Les invités tapent leur prénom, cherchent un titre et l'ajoutent, avec une dédicace si vous l'avez activée. Ils peuvent avoir quelques titres en attente à la fois (réglable).</li>
            <li>Un titre est déjà dans la file ? Il n'est pas ajouté deux fois.</li>
          </ul>
        </Section>

        <Section id="piloter" icon="🎛️" title="Piloter la soirée">
          <ul className="space-y-2 list-disc pl-5">
            <li><B>Lecture</B> : pause, titre suivant, volume, « jouer maintenant », réordonner la file.</li>
            <li><B>Ajouts des invités</B> : l'interrupteur en haut ouvre ou bloque les propositions (pratique pour un discours ou le gâteau).</li>
            <li><B>Mauvaise vidéo ?</B> Touchez le titre pour choisir une autre version (live, clip, paroles…).</li>
            <li><B>Un deuxième téléphone</B> pour piloter : régie, <B>🔧 Outils</B> → <B>📱 Ajouter un téléphone (QR code)</B>, ou tapez le <B>code régie</B> sur ce téléphone.</li>
          </ul>
          <Tip>Le code régie donne accès aux commandes : ne le donnez pas aux invités.</Tip>
        </Section>

        <Section id="blind" icon="🕵️" title="Blind test">
          <p>Si la fonction est activée pour votre soirée, l'onglet <B>🕵️ Blind</B> lance un blind test : des titres sont piochés au hasard, la télé masque le titre et le clip jusqu'à la réponse.</p>
          <ul className="space-y-2 list-disc pl-5">
            <li><B>Réponses sur téléphone</B> : les invités tapent artiste et titre, les points s'affichent en direct (plus on répond vite, plus on gagne).</li>
            <li><B>À voix haute</B> : chacun crie sa réponse, l'écran dévoile la solution.</li>
            <li>Vous voyez le titre en régie et sur la télécommande : vous pouvez aider ou <B>accepter une réponse</B> approchante.</li>
          </ul>
        </Section>

        <Section id="faq" icon="❓" title="Questions fréquentes">
          <div>
            <Faq q="La télé affiche la soirée mais il n'y a pas de son">
              <p>Appuyez sur <B>OK</B> avec la télécommande de la télé : beaucoup de navigateurs de télé bloquent le son tant qu'on n'a pas appuyé sur une touche. Vérifiez aussi le volume de la télé et celui de la télécommande du Jukebox.</p>
            </Faq>
            <Faq q="Je n'arrive pas à scanner le QR code de la télé">
              <p>Zoomez (boutons ×2, ×3 ou deux doigts), ou tapez le <B>code télé</B> écrit sous le QR code dans le champ prévu.</p>
            </Faq>
            <Faq q="J'ai perdu la page de la régie ou de la télécommande">
              <p>Sur le même téléphone ou ordinateur, ouvrez <B>perf360.fr/jukebox</B> : vos soirées sont dans « Mes soirées ». Sinon, rouvrez le lien reçu et tapez le <B>code régie</B>.</p>
            </Faq>
            <Faq q="La musique s'est arrêtée toute seule">
              <p>Vérifiez que l'écran de l'appareil qui joue le son ne s'est pas mis en veille et que la page est toujours ouverte (pas une autre application par-dessus). Une pause involontaire est relancée automatiquement ; sinon, appuyez sur lecture.</p>
            </Faq>
            <Faq q="Un invité ne trouve pas son titre">
              <p>Essayez avec l'artiste et le titre, sans fautes. Vous pouvez aussi l'ajouter vous-même depuis la régie ou la télécommande (sans limite).</p>
            </Faq>
            <Faq q="Que deviennent les données de la soirée ?">
              <p>La soirée et ses titres sont supprimés automatiquement quelques jours après la dernière activité. Aucun compte n'est demandé aux invités : seulement un prénom.</p>
            </Faq>
          </div>
        </Section>

        <p className="text-center text-white/70 text-sm pb-4">
          <Link href="/jukebox" className="underline">Retour au Jukebox</Link>
        </p>
      </div>
    </div>
  );
}
