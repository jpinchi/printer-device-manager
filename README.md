<div align="center">

<picture>
  <source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/jpinchi/printer-device-manager/main/docs/readme/banner-m.svg" />
  <img src="docs/banner.svg" alt="Printer Device Manager — descubre, monitorea y administra toda tu flota de impresoras de red desde un solo lugar" width="100%" />
</picture>

<br/>

[![Licencia](https://img.shields.io/badge/licencia-MIT-22c55e)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](#como-funciona)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-339933?logo=nodedotjs&logoColor=white)](#como-probarlo)
[![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs&logoColor=white)](#como-funciona)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](#como-funciona)
[![Pruebas](https://img.shields.io/badge/pruebas-140%20passing-22c55e)](#calidad)

<br/>

<a href="#galeria"><img src="https://img.shields.io/badge/Ver_capturas-0e1729?style=for-the-badge&logo=googlechrome&logoColor=38bdf8" alt="Ver capturas" /></a>
<a href="#como-probarlo"><img src="https://img.shields.io/badge/C%C3%B3mo_probarlo-38bdf8?style=for-the-badge&logo=nodedotjs&logoColor=06263a" alt="Cómo probarlo" /></a>
<a href="#como-funciona"><img src="https://img.shields.io/badge/C%C3%B3mo_funciona-0e1729?style=for-the-badge&logo=typescript&logoColor=38bdf8" alt="Cómo funciona" /></a>

</div>

<br/>

<a id="que-es"></a>

<picture>
  <source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/jpinchi/printer-device-manager/main/docs/readme/h-que-es-m.svg" />
  <img src="docs/readme/h-que-es.svg" alt="01 · ¿Qué es y para quién?" width="100%" />
</picture>

**Printer Device Manager** es una aplicación local que **encuentra las impresoras de tu red por SNMP** y te muestra, en un panel claro, cómo está cada una: en línea o apagada, cuánto tóner le queda por color, cuántas páginas lleva y qué alertas tiene.

Está pensado para **equipos de soporte y TI** que administran muchas impresoras repartidas en varias sedes y quieren verlas todas juntas, sin instalar nada pesado ni abrir una por una en su navegador.

<picture>
  <source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/jpinchi/printer-device-manager/main/docs/readme/indicadores-m.svg" />
  <img src="docs/readme/indicadores.svg" alt="Un solo puerto (:2626) para todo · 7 marcas más un adaptador estándar · 140 pruebas automatizadas · Multi-sede: servidor central y sedes" width="100%" />
</picture>

<details>
<summary><b>🇬🇧 In English (short summary)</b></summary>

**Printer Device Manager** is a local app that **discovers network printers over SNMP** and shows their health in one clean dashboard: online/offline status, per-color toner levels, page counters and alerts. It's built for IT/support teams managing large printer fleets across multiple sites. Everything (static frontend + API + live WebSocket) is served from a **single LAN address**, with a desktop app, a central/hub model for multiple branches, light/dark themes, Spanish/English UI, role-based auth, and PDF/Excel/CSV reports. Stack: TypeScript, Express 5, Prisma + SQLite, Next.js 15 / React 19, Electron 44. 140 passing tests.
</details>

<br/>

<a id="galeria"></a>

<picture>
  <source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/jpinchi/printer-device-manager/main/docs/readme/h-galeria-m.svg" />
  <img src="docs/readme/h-galeria.svg" alt="02 · Galería" width="100%" />
</picture>

<picture>
  <source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/jpinchi/printer-device-manager/main/docs/readme/galeria-m.svg" />
  <img src="docs/readme/galeria.svg" alt="Capturas del panel que se alternan: panel principal, ficha de impresora, consumibles, reportes y modo claro" width="100%" />
</picture>

<details>
<summary><b>Ver las capturas en tamaño completo</b></summary>

<br/>

<table>
  <tr>
    <td align="center" width="50%">
      <img src="docs/screenshots/dashboard-dark.png" alt="Panel principal en modo oscuro con el resumen de la flota y la tabla de impresoras" width="420" /><br/>
      <sub><b>Panel principal</b> — resumen y tabla (modo oscuro)</sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/screenshots/dashboard-light.png" alt="Panel principal en modo claro con tarjetas de resumen y tabla de impresoras" width="420" /><br/>
      <sub><b>Panel principal</b> — resumen y tabla (modo claro)</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="docs/screenshots/ficha-impresora.png" alt="Ficha de una impresora con consumibles, contadores, bandejas y datos de red" width="420" /><br/>
      <sub><b>Ficha de impresora</b> — consumibles, contadores y red</sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/screenshots/consumibles.png" alt="Vista de consumibles de toda la flota con niveles de tóner" width="420" /><br/>
      <sub><b>Consumibles</b> — tóner de toda la flota</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="docs/screenshots/reportes.png" alt="Sección de reportes con botones para exportar en PDF, Excel y CSV" width="420" /><br/>
      <sub><b>Reportes</b> — exporta en PDF, Excel o CSV</sub>
    </td>
    <td></td>
  </tr>
</table>

</details>

> Las capturas usan **datos de ejemplo inventados** (IPs, modelos y ubicaciones ficticios). Se regeneran con el script de la sección [Cómo funciona](#como-funciona).

<br/>

<a id="funciones"></a>

<picture>
  <source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/jpinchi/printer-device-manager/main/docs/readme/h-funciones-m.svg" />
  <img src="docs/readme/h-funciones.svg" alt="03 · Funciones" width="100%" />
</picture>

<picture>
  <source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/jpinchi/printer-device-manager/main/docs/readme/funciones-m.svg" />
  <img src="docs/readme/funciones.svg" alt="Funciones: descubrimiento por SNMP; panel en vivo por WebSocket; tóner por color (K, C, M, Y); alertas automáticas; organización por ubicación y unidad de trabajo; reportes en PDF, Excel y CSV; una sola dirección (puerto 2626); modelo central y sedes con auto-actualización; app de escritorio para Windows; modo claro u oscuro en español o inglés" width="100%" />
</picture>

<br/><br/>

<a id="como-probarlo"></a>

<picture>
  <source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/jpinchi/printer-device-manager/main/docs/readme/h-como-probarlo-m.svg" />
  <img src="docs/readme/h-como-probarlo.svg" alt="04 · Cómo probarlo" width="100%" />
</picture>

Necesitas **Node.js ≥ 20**. No hace falta una impresora: hay un **modo de simulación** y un **script de datos de ejemplo**.

```bash
# 1) Clonar e instalar
git clone https://github.com/jpinchi/printer-device-manager.git
cd printer-device-manager
npm install

# 2) Configurar y preparar la base de datos
cp .env.example .env
npm run db:generate
npm run db:push

# 3) Compilar el panel web
npm run build:web
```

**Opción A — ver el panel lleno con datos de ejemplo:**

```bash
# Siembra datos ficticios en una base de datos de demostración
DATABASE_URL="file:./prisma/demo.db" node scripts/demo-seed.mjs
# Arranca todo en una sola dirección
DATABASE_URL="file:./prisma/demo.db" AUTH_ENFORCE=false npm run serve
# Abre http://localhost:2626
```

**Opción B — probar el flujo SNMP sin hardware (simulación):**

```bash
SNMP_MOCK=true AUTH_ENFORCE=false npm run server
# Abre http://localhost:3000, escribe cualquier IP y pulsa "Agregar por SNMP"
```

> En Windows (PowerShell) las variables van antes, p. ej.:
> `$env:DATABASE_URL="file:./prisma/demo.db"; node scripts/demo-seed.mjs`

<br/>

<a id="como-funciona"></a>

<picture>
  <source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/jpinchi/printer-device-manager/main/docs/readme/h-como-funciona-m.svg" />
  <img src="docs/readme/h-como-funciona.svg" alt="05 · Cómo funciona" width="100%" />
</picture>

El frontend se compila a estático y **el mismo servidor Express sirve la web, la API y el WebSocket** en un solo puerto. Así cualquier equipo de la red entra por una única dirección, sin CORS ni procesos separados.

<picture>
  <source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/jpinchi/printer-device-manager/main/docs/readme/arquitectura-m.svg" />
  <img src="docs/readme/arquitectura.svg" alt="Arquitectura: las impresoras responden por SNMP v1/v2c a snmp-core (adaptadores por fabricante); un solo servidor Express 5 en el puerto 2626 sirve el panel web estático, la API REST y el WebSocket, y guarda en SQLite con Prisma; el panel Next.js recibe cambios en vivo y se abre desde los navegadores de la red; la app de escritorio Electron usa la misma API" width="100%" />
</picture>

<picture>
  <source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/jpinchi/printer-device-manager/main/docs/readme/tecnologias-m.svg" />
  <img src="docs/readme/tecnologias.svg" alt="Tecnologías. Frontend: Next.js 15, React 19, Tailwind CSS, TypeScript. Backend: Express 5, Prisma 6, SQLite, WebSocket (ws). SNMP: net-snmp y adaptadores para RICOH, HP, Canon, Brother, Kyocera, Xerox, Lexmark y estándar. Escritorio: Electron 44, electron-builder, electron-updater. Runtime: Node.js 20 o superior con workspaces de npm. Pruebas: Vitest, 140 pruebas" width="100%" />
</picture>

Para generar las capturas de nuevo: `node scripts/capture-screenshots.mjs` (siembra datos de ejemplo, arranca el servidor, captura con Chrome y optimiza las imágenes).

<br/>

<a id="retos"></a>

<picture>
  <source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/jpinchi/printer-device-manager/main/docs/readme/h-retos-m.svg" />
  <img src="docs/readme/h-retos.svg" alt="06 · Retos y decisiones" width="100%" />
</picture>

- **Una sola dirección para todo (sin CORS).** En vez de un servidor para la API y otro para la web, el frontend se exporta estático y Express lo sirve junto con la API y el WebSocket en un puerto. Resultado: desplegar en una red es `npm run serve` y entrar por `http://IP:2626`, sin configurar orígenes cruzados.
- **SNMP multi‑fabricante normalizado.** Cada marca reporta sus datos distinto. Se resolvió con un `PrinterAdapter` por fabricante y un **adaptador estándar de respaldo**, de modo que una RICOH, una HP y una Brother se ven iguales en la tabla (tóner por color, contadores, estado).
- **Multi‑sede con auto‑actualización headless.** El auto‑update de Electron es para la ventana gráfica; los servidores de sede ("hubs") corren sin interfaz como tarea de Windows. Se les añadió su propio mecanismo que consulta un feed central, descarga el instalador y se reinstala/reinicia solo.
- **Diálogos propios en lugar de los nativos.** En Electron, `window.confirm`/`alert` roban el foco y dejan los campos sin aceptar teclado. Se reemplazaron por un modal de React, así el foco nunca se pierde tras confirmar o cancelar.

<br/>

<a id="calidad"></a>

<picture>
  <source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/jpinchi/printer-device-manager/main/docs/readme/h-calidad-m.svg" />
  <img src="docs/readme/h-calidad.svg" alt="07 · Calidad" width="100%" />
</picture>

<picture>
  <source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/jpinchi/printer-device-manager/main/docs/readme/calidad-m.svg" />
  <img src="docs/readme/calidad.svg" alt="140 pruebas pasando con Vitest. Pruebas de parsers SNMP, descubrimiento, polling, login, rate-limit y cifrado; community SNMP y contraseñas cifradas con AES-256-GCM; la community nunca llega al frontend; login con límite de intentos; roles Administrador, Técnico y Observador (AUTH_ENFORCE)" width="100%" />
</picture>

- Las pruebas se corren con `npm test`, después del paso 2 de [Cómo probarlo](#como-probarlo).
- Los secretos (la *community* SNMP de cada impresora, la contraseña SMTP y la que usa cada sede para conectarse al servidor central) se cifran con AES-256-GCM: ver `apps/server/src/secrets.ts` y su prueba.
- Los roles se activan con `AUTH_ENFORCE=true`.

<br/>

<a id="proximos"></a>

<picture>
  <source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/jpinchi/printer-device-manager/main/docs/readme/h-proximos-m.svg" />
  <img src="docs/readme/h-proximos.svg" alt="08 · Próximos pasos" width="100%" />
</picture>

- Más adaptadores de fabricantes sobre el adaptador estándar.
- Migración opcional a PostgreSQL (el esquema ya está preparado para cambiar de proveedor).
- Alertas por correo (la configuración SMTP ya existe en Ajustes).

<br/>

<picture>
  <source media="(max-width: 600px)" srcset="https://raw.githubusercontent.com/jpinchi/printer-device-manager/main/docs/readme/pie-m.svg" />
  <img src="docs/readme/pie.svg" alt="Printer Device Manager · Hecho por Josue Mejias · MIT" width="100%" />
</picture>

<div align="center">

Distribuido bajo licencia **MIT** — ver [`LICENSE`](LICENSE) · [github.com/jpinchi](https://github.com/jpinchi)

</div>
