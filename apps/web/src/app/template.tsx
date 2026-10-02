/**
 * Template de App Router: se re-monta en cada navegación, por lo que aplica una
 * transición de entrada suave al contenido de página (fade + slide).
 */
export default function Template({ children }: { children: React.ReactNode }) {
  // `shrink-0`: este wrapper es un flex item de #app-scroll (columna). Sin él,
  // `min-h-full` (min-height:100%) deja que flex-shrink lo colapse a la altura
  // del viewport y el contenido lo desborda → el Topbar `sticky` solo tiene ese
  // alto de recorrido y se va al hacer scroll. Con shrink-0 crece al contenido
  // y el sticky funciona en toda la app.
  return <div className="page-enter min-h-full shrink-0">{children}</div>;
}
