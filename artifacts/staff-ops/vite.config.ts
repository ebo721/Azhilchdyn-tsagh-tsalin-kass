import path from 'path';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

// PORT / BASE_PATH are provided automatically inside Replit (see .replit-artifact/artifact.toml).
// Outside Replit — e.g. a Vercel build, which only ever runs `vite build` and never touches
// server.port/preview.port — these env vars are absent, so we fall back to sane defaults
// instead of throwing and failing the build.
const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 5173;

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? '/';
const routing = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as {
  rewrites: { source: string; destination: string }[];
};
const apiDestination = routing.rewrites.find((rule) => rule.source === '/api/:path*')?.destination;
if (process.env.VERCEL_ENV === 'production' && !apiDestination) {
  throw new Error('Direct attendance API origin is missing from vercel.json');
}
// The frontend rewrite is a second proxy hop and loses the visitor's office IP.
// Employee punches must call the API's Vercel edge directly, only in production.
const directAttendanceApiOrigin = process.env.VERCEL_ENV === 'production' && apiDestination
  ? new URL(apiDestination).origin
  : '';

export default defineConfig({
  base: basePath,
  define: {
    'import.meta.env.VITE_OFFICE_ATTENDANCE_API_ORIGIN': JSON.stringify(directAttendanceApiOrigin),
  },
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
