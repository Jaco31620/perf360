"use client";
/* Écran d'accueil avec QR code (page /laure50/qr et pré-accueil de la régie). */
import { useEffect, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import Backdrop from "./Backdrop";

export default function QrWelcome({ phones = null, big = false }) {
  const [url, setUrl] = useState("");
  useEffect(() => setUrl(`${window.location.origin}/laure50`), []);
  return (
    <Backdrop>
      <div className={`l50-center ${big ? "l50-welcome" : ""}`}>
        <img className="l50-logo-qr" src="/laure50/logo.png" alt="Laure 1976" />
        {url && (
          <div className="l50-qr">
            <QRCodeCanvas value={url} size={600} marginSize={2} fgColor="#1a0d05" bgColor="#f4e7c7" />
          </div>
        )}
        <p className="l50-url">{url.replace(/^https?:\/\//, "")}</p>
        <p className="l50-subtitle">Scannez pour chanter avec les paroles</p>
        {phones !== null && (
          <p className="l50-phones-big">📱 {phones} téléphone{phones > 1 ? "s" : ""} connecté{phones > 1 ? "s" : ""}</p>
        )}
      </div>
    </Backdrop>
  );
}
