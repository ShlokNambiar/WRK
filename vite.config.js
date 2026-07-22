import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5174 },
  build: {
    rollupOptions: {
      output: {
        // Split the heavyweight vendors into stable, cacheable chunks so an
        // app-code change doesn't invalidate react/motion/supabase downloads.
        manualChunks: {
          react: ['react', 'react-dom'],
          motion: ['framer-motion'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
})
