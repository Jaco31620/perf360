"use client";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";

const apps = [
  {
    href: "/ami-invisible",
    emoji: "🎁",
    title: "Ami Invisible",
    desc: "Organisez votre tirage au sort en toute confidentialité. Exclusions, notifications, historique.",
    color: "from-red-50 to-orange-50",
    border: "border-red-200",
    badge: "Gratuit",
    badgeColor: "bg-red-100 text-red-600",
  },
  // Ajoutez vos prochaines apps ici
];

export default function Home() {
  const { user, signOut, loading } = useAuth();

  return (
    <main className="max-w-3xl mx-auto px-4 py-12 space-y-12">
      {/* Auth banner */}
      <div className="flex justify-end text-xs">
        {loading ? null : user ? (
          <div className="flex items-center gap-3">
            <span className="text-gray-500">{user.email}</span>
            <button onClick={signOut} className="text-red-500 hover:underline">Déconnexion</button>
          </div>
        ) : (
          <Link href="/connexion" className="text-red-500 hover:underline font-medium">
            Se connecter
          </Link>
        )}
      </div>

      {/* Header */}
      <div className="text-center space-y-3">
        <h1 className="text-4xl font-extrabold text-gray-800">perf360</h1>
        <p className="text-gray-500 text-lg">Des outils simples pour vous simplifier la vie.</p>
        <Link href="/soutenir" className="inline-block mt-2 text-sm text-blue-500 hover:underline">
          ☕ Soutenir le projet
        </Link>
      </div>

      {/* Apps */}
      <div className="grid gap-6 sm:grid-cols-2">
        {apps.map(app => (
          <Link key={app.href} href={app.href}
            className={`block rounded-2xl border ${app.border} bg-gradient-to-br ${app.color} p-6 hover:shadow-md transition-shadow`}>
            <div className="flex items-start justify-between mb-3">
              <span className="text-4xl">{app.emoji}</span>
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${app.badgeColor}`}>{app.badge}</span>
            </div>
            <h2 className="text-xl font-bold text-gray-800 mb-1">{app.title}</h2>
            <p className="text-sm text-gray-500">{app.desc}</p>
          </Link>
        ))}
      </div>

      {/* Footer */}
      <p className="text-center text-xs text-gray-300">© {new Date().getFullYear()} perf360.fr</p>
    </main>
  );
}
