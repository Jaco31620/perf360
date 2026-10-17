/*
 * Karaoké « Laure 50 ans » — section autonome de perf360 (non liée à l'accueil).
 * /laure50 (téléphones), /laure50/ecran (régie), /laure50/qr (QR code).
 */
import "./laure.css";

export const metadata = {
  title: "Laure · 50 ans · Karaoké",
  icons: { icon: "/laure50/logo.png", apple: "/laure50/logo.png" },
  manifest: "/manifest-laure50.json",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Karaoké Laure" },
  robots: { index: false, follow: false },
};

export const viewport = { themeColor: "#261408", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function Laure50Layout({ children }) {
  return children;
}
