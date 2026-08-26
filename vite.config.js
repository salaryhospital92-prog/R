import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        // ملفات الواجهة فقط تُخزَّن مؤقتاً. طلبات Supabase لا تُخزَّن إطلاقاً
        // حتى لا يرى الزبون سعراً أو رصيداً قديماً.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallbackDenylist: [/^\/api/],
      },
      manifest: {
        name: 'أسواق الرفاعي',
        short_name: 'الرفاعي',
        description: 'متجر أسواق الرفاعي — الرمادي، شارع السينما. عطور، بشرة، كوزمتك، ومواد منزلية جملة ومفرد.',
        lang: 'ar',
        dir: 'rtl',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f8fafc',
        theme_color: '#059669',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'شراء مفرد', url: '/retail' },
          { name: 'شراء جملة', url: '/wholesale' },
        ],
      },
    }),
  ],
  // الكاميرا (ماسح الباركود) تعمل فقط على HTTPS أو localhost.
  // host: true يتيح فتح اللوحة من الجوال على نفس الشبكة أثناء التطوير.
  server: { host: true },
})
