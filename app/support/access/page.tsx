import Link from "next/link";

export const dynamic = "force-dynamic";

export default function AccessSupportPage() {
  const destination = process.env.WHATSAPP_CLAIM_DESTINATION?.trim();
  const configured = Boolean(destination && /^[1-9]\d{7,14}$/.test(destination));
  const message = "Hello, I need help accessing Race To Win. I received an access error (401/403). Please review my case.";
  const whatsappUrl = configured ? `https://wa.me/${destination}?text=${encodeURIComponent(message)}` : null;

  return <section className="page-section shell narrow">
    <p className="eyebrow">RACE TO WIN · SUPPORT</p>
    <h1>CONTACTAR SOPORTE</h1>
    <p>Si recibiste un error 401 o tu acceso está pendiente de revisión, puedes escribir al administrador. Esto no es una reclamación de premios.</p>
    <p>Incluye tu nombre de jugador y la referencia del error si aparece. Nunca compartas contraseñas ni códigos de acceso.</p>
    {whatsappUrl ? <a className="button button--primary" href={whatsappUrl} target="_blank" rel="noopener noreferrer">CONTACTAR SOPORTE POR WHATSAPP</a> : <p>El contacto de soporte no está disponible temporalmente. Intenta de nuevo más tarde.</p>}
    <p><Link className="button button--secondary" href="/games/race-to-win">← VOLVER AL JUEGO</Link></p>
  </section>;
}
