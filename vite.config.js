import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    // Emit source maps but don't reference them from the bundle, so production
    // errors caught by ErrorBoundary map back to readable stack traces without
    // shipping map URLs to clients.
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        // Split heavy/stable vendor code into long-lived cacheable chunks so an
        // app code change doesn't force users to re-download Firebase/React.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/firebase/') || id.includes('/@firebase/')) return 'firebase'
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react'
          if (id.includes('/lucide-react/')) return 'icons'
          return 'vendor'
        },
      },
    },
  },
})
