import Link from "next/link";

export const metadata = {
  title: "Soutenir perf360",
};

export default function SoutenirPage() {
  return (
    <main className="max-w-md mx-auto px-4 py-16 text-center space-y-8">
      <div className="space-y-3">
        <div className="text-5xl">☕</div>
        <h1 className="text-3xl font-extrabold text-gray-800">Soutenir perf360</h1>
        <p className="text-gray-500">
          Toutes les apps sont gratuites et sans publicité. Si elles vous ont été utiles,
          un petit don fait toujours plaisir et aide à financer les prochains outils !
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow p-8 space-y-4">
        <p className="text-gray-600 text-sm">Choisissez le montant qui vous convient sur la page PayPal :</p>
        <div className="flex justify-center">
          <a href="https://www.paypal.com/donate/?hosted_button_id=N57TTF76Z9GLG"
            target="_blank" rel="noopener noreferrer"
            className="bg-blue-500 hover:bg-blue-600 text-white font-semibold px-6 py-3 rounded-xl transition-colors">
            Faire un don
          </a>
        </div>
        <p className="text-xs text-gray-400">Paiement sécurisé via PayPal</p>
      </div>

      <Link href="/" className="text-sm text-gray-400 hover:underline">← Retour aux apps</Link>
    </main>
  );
}
