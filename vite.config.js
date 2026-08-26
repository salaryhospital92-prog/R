import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // الكاميرا (ماسح الباركود) تعمل فقط على HTTPS أو localhost.
  // host: true يتيح فتح اللوحة من الجوال على نفس الشبكة أثناء التطوير.
  server: { host: true },
})
