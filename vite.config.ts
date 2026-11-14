import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/postprocessing')) return 'postfx';
        },
      },
    },
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'Legends Assembly',
        short_name: 'Legends',
        description: 'Legends of history and pop culture clash in fast 3D hero battles.',
        theme_color: '#0b0d18',
        background_color: '#0b0d18',
        display: 'fullscreen',
        orientation: 'landscape',
        start_url: '/',
        scope: '/',
        categories: ['games', 'entertainment'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,webmanifest}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/models/'),
            handler: 'CacheFirst',
            options: { cacheName: 'models', expiration: { maxEntries: 120 } },
          },
          {
            // KTX2 texture transcoder (the museum's GPU-compressed textures)
            urlPattern: ({ url }) => url.pathname.startsWith('/basis/'),
            handler: 'CacheFirst',
            options: { cacheName: 'basis', expiration: { maxEntries: 4 } },
          },
          {
            // recorded hero voices and extra announcer lines: content-hashed, so cache them for good
            urlPattern: ({ url }) => url.pathname.startsWith('/assets/') && url.pathname.endsWith('.ogg'),
            handler: 'CacheFirst',
            options: { cacheName: 'voice', expiration: { maxEntries: 500 } },
          },
          {
            // generated SFX + announcer: served from cache instantly, refreshed in the background
            urlPattern: ({ url }) => url.pathname.startsWith('/audio/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'audio', expiration: { maxEntries: 400 } },
          },
        ],
      },
    }),
  ],
});
