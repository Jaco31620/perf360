"use client";
/* Écrans titre (avec compte à rebours de 11 s à 14 s) et final. */

export function TitleScreen({ pos }) {
  const showCountdown = pos >= 11 && pos < 14;
  return (
    <div className="l50-center">
      <img className="l50-logo-big" src="/laure50/logo.png" alt="Laure 1976" />
      <p className="l50-title">50 ans · New York</p>
      <p className="l50-subtitle">sur l’air de « New York avec toi »</p>
      <div className="l50-dots" style={{ visibility: showCountdown ? "visible" : "hidden" }}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`l50-dot ${pos >= 11 + (i + 1) * 0.75 ? "off" : ""}`} />
        ))}
      </div>
    </div>
  );
}

export function OutroScreen() {
  return (
    <div className="l50-center">
      <img className="l50-logo-big" src="/laure50/logo.png" alt="Laure 1976" />
      <p className="l50-outro">Joyeux anniversaire !</p>
    </div>
  );
}
