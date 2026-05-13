"use client";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";

const apps = [
  {
    href: "/ami-invisible",
    emoji: "🎁",
    title: "Ami Invisible",
    desc: "Organisez votre tirage au sort en toute confidentialité. Exclusions, notifications, historique.",
    gradient: "from-red-500 to-orange-500",
    badge: "Gratuit",
  },
  // Ajoutez vos prochaines apps ici
];

const valeurs = [
  { emoji: "🚫", title: "Sans publicité", desc: "Aucune pub, aucun tracker. Votre expérience reste fluide." },
  { emoji: "🔒", title: "Données privées", desc: "Vos données vous appartiennent, jamais revendues." },
  { emoji: "⚡", title: "Simple et rapide", desc: "Pas de fioritures, juste ce qu'il vous faut." },
];

export default function Home() {
  const { user, signOut, loading } = useAuth();

  return (
    <div className="min-h-screen bg-white">
      {/* Top bar */}
      <nav className="absolute top-0 left-0 right-0 z-10 px-4 py-4 sm:px-8">
        <div className="max-w-5xl mx-auto flex justify-between items-center text-sm">
          <span className="font-bold text-white">perf360</span>
          {user ? (
            <div className="flex items-center gap-3 text-white">
              <span className="opacity-90 text-xs hidden sm:inline">{user.email}</span>
              <button onClick={signOut} className="bg-white bg-opacity-20 hover:bg-opacity-30 backdrop-blur-sm px-3 py-1.5 rounded-full text-xs font-medium transition-all">
                Déconnexion
              </button>
            </div>
          ) : (
            <Link href="/connexion" className="bg-white text-red-500 hover:scale-105 px-4 py-1.5 rounded-full text-xs font-semibold transition-transform shadow-sm">
              Se connecter
            </Link>
          )}
        </div>
      </nav>

      {/* Hero */}
      <section className="relative bg-gradient-to-br from-red-500 via-red-500 to-orange-500 pt-20 pb-32 px-4 overflow-hidden">
        {/* Decorative blobs */}
        <div className="absolute top-20 -left-20 w-72 h-72 bg-white opacity-10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-10 -right-20 w-96 h-96 bg-yellow-300 opacity-20 rounded-full blur-3xl"></div>

        <div className="relative max-w-3xl mx-auto text-center space-y-6">
          <div className="inline-block bg-white bg-opacity-20 backdrop-blur-sm text-white text-xs font-semibold px-4 py-1.5 rounded-full">
            ✨ Des outils pensés simplement
          </div>
          <h1 className="text-5xl sm:text-7xl font-black text-white tracking-tight leading-none">
            perf360
          </h1>
          <p className="text-xl sm:text-2xl text-white text-opacity-90 max-w-xl mx-auto leading-relaxed">
            Des mini-apps utiles, gratuites et sans publicité.<br/>
            <span className="text-white text-opacity-75 text-lg">Pour vous simplifier la vie au quotidien.</span>
          </p>
          <div className="pt-4">
            <a href="#apps" className="inline-block bg-white text-red-500 font-bold px-8 py-3.5 rounded-full hover:scale-105 hover:shadow-2xl transition-all text-sm">
              Découvrir les apps ↓
            </a>
          </div>
        </div>
      </section>

      {/* Apps section */}
      <section id="apps" className="max-w-5xl mx-auto px-4 -mt-16 relative z-10 pb-20">
        <div className="grid gap-6 sm:grid-cols-2">
          {apps.map(app => (
            <Link key={app.href} href={app.href}
              className="group block bg-white rounded-3xl border border-gray-100 p-8 hover:shadow-2xl hover:-translate-y-1 transition-all duration-300">
              <div className={`inline-flex w-16 h-16 rounded-2xl bg-gradient-to-br ${app.gradient} items-center justify-center text-3xl mb-5 group-hover:scale-110 transition-transform`}>
                {app.emoji}
              </div>
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-2xl font-bold text-gray-900">{app.title}</h2>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">{app.badge}</span>
              </div>
              <p className="text-gray-500 leading-relaxed">{app.desc}</p>
              <div className="mt-4 text-sm font-semibold text-red-500 group-hover:translate-x-1 transition-transform inline-block">
                Ouvrir l'app →
              </div>
            </Link>
          ))}

          {/* Placeholder for next app */}
          <div className="rounded-3xl border-2 border-dashed border-gray-200 p-8 flex flex-col items-center justify-center text-center min-h-[260px]">
            <div className="text-4xl mb-3 opacity-30">✨</div>
            <p className="text-gray-400 font-medium">D'autres apps arrivent bientôt</p>
            <p className="text-xs text-gray-300 mt-1">Une idée ? Faites-la nous savoir.</p>
          </div>
        </div>
      </section>

      {/* Valeurs */}
      <section className="bg-gray-50 py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-3">Notre philosophie</h2>
            <p className="text-gray-500 max-w-xl mx-auto">Des outils pensés autrement, à contre-courant des apps usine à gaz.</p>
          </div>
          <div className="grid gap-6 sm:grid-cols-3">
            {valeurs.map(v => (
              <div key={v.title} className="bg-white rounded-2xl p-6 text-center border border-gray-100">
                <div className="text-3xl mb-3">{v.emoji}</div>
                <h3 className="font-bold text-gray-900 mb-2">{v.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{v.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Support CTA */}
      <section className="py-16 px-4">
        <div className="max-w-2xl mx-auto bg-gradient-to-br from-orange-50 to-red-50 rounded-3xl p-10 text-center border border-orange-100">
          <div className="text-4xl mb-4">☕</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Vous aimez perf360 ?</h2>
          <p className="text-gray-600 mb-6 max-w-md mx-auto">
            Tout est gratuit et le restera. Un café offert aide à financer les prochains outils !
          </p>
          <Link href="/soutenir"
            className="inline-block bg-red-500 hover:bg-red-600 text-white font-bold px-8 py-3 rounded-full transition-colors text-sm">
            Soutenir le projet
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8 px-4">
        <div className="max-w-5xl mx-auto text-center text-xs text-gray-400">
          © {new Date().getFullYear()} perf360.fr — Apps utiles, sans pub
        </div>
      </footer>
    </div>
  );
}
