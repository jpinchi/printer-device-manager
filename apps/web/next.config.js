/**
 * Configuración de Next.js (App Router).
 *
 * - Desarrollo (`next dev`): el frontend corre en :3001 y reenvía `/api/:path*`
 *   al backend (:3000) con rewrites(), evitando CORS.
 * - Producción (`next build`): exportación ESTÁTICA a `out/`, que el servidor
 *   Express sirve desde su MISMO puerto junto con la API y el WebSocket. Así se
 *   accede a todo por una sola dirección `http://IP:PUERTO` desde la LAN.
 */

/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === "production";
const API_PROXY_TARGET = process.env.API_PROXY_TARGET || "http://localhost:3000";

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@pdm/types"],
  ...(isProd
    ? {
        output: "export",
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {
        async rewrites() {
          return [
            { source: "/api/:path*", destination: `${API_PROXY_TARGET}/api/:path*` },
          ];
        },
      }),
};

module.exports = nextConfig;
