/*
 * Page d'accueil publique de blackroll-codes.com (affichée à la racine via le
 * middleware). Sobre : indique que c'est un outil interne, oriente le visiteur
 * vers le site BLACKROLL, et propose un accès admin discret.
 */
export const metadata = { title: "BLACKROLL Codes" };

export default function AccueilPage() {
  return (
    <div style={{ background: "#0A0A0A", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif", color: "#FEFFF0", padding: "24px 16px" }}>
      <div style={{ width: "100%", maxWidth: 460, textAlign: "center" }}>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px", marginBottom: 28 }}>
          BLACKROLL<sup style={{ fontSize: 10 }}>®</sup> <span style={{ color: "#1BE299" }}>Codes</span>
        </div>

        <div style={{ background: "#FEFFF0", borderRadius: 22, padding: "34px 28px", boxShadow: "0 10px 40px rgba(0,0,0,0.4)" }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#161614", margin: "0 0 12px", letterSpacing: "-0.5px" }}>Outil interne</h1>
          <p style={{ color: "#555", fontSize: 15, lineHeight: 1.6, margin: "0 0 24px" }}>
            Ce site est un outil interne de gestion de codes de réduction. Il n'est pas destiné au grand public.
          </p>
          <a href="https://blackroll.com/fr"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, width: "100%", boxSizing: "border-box", padding: "14px 18px", borderRadius: 999, background: "#1BE299", color: "#0A0A0A", fontSize: 15.5, fontWeight: 700, textDecoration: "none" }}>
            Accéder au site BLACKROLL →
          </a>
        </div>

        <div style={{ marginTop: 18 }}>
          <a href="/admin" style={{ color: "#8c8c84", fontSize: 12.5, textDecoration: "underline" }}>Espace administrateur</a>
        </div>
      </div>
    </div>
  );
}
