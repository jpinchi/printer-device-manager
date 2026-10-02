# Printer Device Manager — Versión de escritorio (Windows)

La app de escritorio empaqueta todo el sistema (frontend + API + monitoreo SNMP en
tiempo real) en un **programa instalable de Windows**. Al abrirla arranca el
servidor localmente y muestra la interfaz en una ventana nativa. Además sigue
funcionando como **servidor de LAN**: otros equipos pueden entrar por navegador a
`http://IP-del-equipo:2626`.

## Construir el instalador

Desde la raíz del repo:

```bash
npm run desktop:build
```

Esto: compila el frontend, empaqueta el servidor (bundle + runtime de Prisma) y
genera el instalador con electron-builder. El resultado queda en:

```
apps/desktop/dist-installer/Printer Device Manager Setup <versión>.exe
```

> Pasos por separado, si hace falta:
> - `npm run build:web` — compila el frontend estático.
> - `node apps/desktop/build-server.mjs` — bundlea el servidor y prepara recursos.
> - `npm run dist -w @pdm/desktop` — genera el instalador.

## Probar en desarrollo (sin instalar)

```bash
npm run desktop:dev
```

Abre la ventana de Electron usando el servidor de desarrollo. Para no chocar con
un servidor ya abierto en 2626, se puede fijar otro puerto:
`PDM_DESKTOP_PORT=2828 npm run desktop:dev`.

## Instalar y primer arranque

1. Ejecuta el `...Setup.exe`. Instalación **por usuario** (no requiere admin);
   permite elegir carpeta y crea accesos directos (escritorio + menú inicio).
   Al no estar firmado, Windows SmartScreen puede avisar → *Más información →
   Ejecutar de todos modos*.
2. Al abrir por primera vez, con la base de datos vacía, la pantalla pide
   **crear la cuenta de administrador** (el primer usuario se vuelve
   Administrator). Los siguientes usuarios se gestionan desde *Administration →
   Users*.
3. Ya dentro: agrega impresoras por IP o usa *Network → Discovery* para
   descubrirlas por rango.

## Dónde viven los datos

- **Base de datos y secreto de sesión:** carpeta de datos del usuario de la app
  (`%APPDATA%\Printer Device Manager\`). Sobrevive a actualizaciones y
  reinstalaciones. Para respaldar, copia `pdm.db` de esa carpeta.
- El **secreto de firma de sesión** se genera aleatorio en el primer arranque y
  se guarda ahí (no es el de desarrollo).

## Notas

- **Instalar drivers en el host** (Drivers → Instalar) pedirá elevación (UAC) en
  el equipo donde corre la app; solo afecta a ESE equipo.
- **Asignar IP remota** (Network → Asignar IP) es específico de RICOH IM-series y
  aplica el cambio tras reiniciar la impresora.
- Para acceso desde otros equipos de la red, permite el puerto **2626** en el
  Firewall de Windows del equipo donde está instalada.
