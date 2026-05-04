import "./globals.css";

export const metadata = {
  title: "perf360 — Outils pratiques",
  description: "Des mini-apps utiles, simples et gratuites.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body className="bg-gray-50 min-h-screen">{children}</body>
    </html>
  );
}
