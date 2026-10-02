/**
 * IP de una impresora como enlace: abre su interfaz web (http://<ip>) en una
 * pestaña nueva. Se usa en todas las vistas que muestran la dirección IP.
 *
 * `stopPropagation` evita que, si el enlace vive dentro de una fila/tarjeta
 * navegable, el clic dispare también la navegación del contenedor.
 */
export function IpLink({
  ip,
  className = "",
}: {
  ip?: string | null;
  className?: string;
}) {
  if (!ip) return <span className={`font-mono ${className}`}>—</span>;
  return (
    <a
      href={`http://${ip}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={`Abrir http://${ip} en el navegador`}
      className={`font-mono underline-offset-2 transition-colors hover:text-accent hover:underline ${className}`}
    >
      {ip}
    </a>
  );
}
