/*
 * Layout du super-admin (/admin) : marque BLACKROLL (favicon, titre), pas de PWA.
 */
export const metadata = {
  title: "BLACKROLL Codes — Administration",
  icons: { icon: "/icon-blackroll.svg", shortcut: "/icon-blackroll.svg", apple: "/icon-blackroll.svg" },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "BLACKROLL" },
  manifest: null,
};

export const viewport = { themeColor: "#0A0A0A" };

export default function CodesAdminLayout({ children }) {
  return children;
}
