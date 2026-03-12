import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import electronRenderer from 'vite-plugin-electron-renderer'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  base: './',
  build: {
    // Production source maps for debugging
    sourcemap: true,

    // Use esbuild for minification (faster than terser)
    minify: 'esbuild',

    // Target modern browsers for smaller output
    target: 'esnext',

    // Inline assets smaller than 4KB as base64
    assetsInlineLimit: 4096,

    // Raise warning limit for large vendor chunks
    chunkSizeWarningLimit: 1000,

    // Report compressed sizes after build
    reportCompressedSize: true,

    rollupOptions: {
      output: {
        format: 'es',

        // Cache-busting hashed filenames
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',

        manualChunks: {
          // Core framework
          'react-vendor': ['react', 'react-dom'],

          // State management
          'zustand': ['zustand'],

          // Icons
          'lucide': ['lucide-react'],

          // Heavy editor dependency - isolate for caching
          'monaco-editor': ['monaco-editor'],

          // Terminal emulator + addons
          'xterm': ['xterm', 'xterm-addon-fit', 'xterm-addon-web-links'],
        },
      },
    },
  },
  css: {
    devSourcemap: true,
  },
  optimizeDeps: {
    // Pre-bundle heavy deps for faster dev startup and HMR
    include: [
      'react',
      'react-dom',
      'zustand',
      'lucide-react',
      'monaco-editor',
      'xterm',
      'xterm-addon-fit',
      'xterm-addon-web-links',
    ],
  },
  server: {
    // HMR optimization
    hmr: {
      overlay: true,
    },
    // Faster file watching
    watch: {
      usePolling: false,
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    // Remove crossorigin attribute from built HTML (breaks file:// protocol)
    {
      name: 'remove-crossorigin',
      transformIndexHtml(html: string) {
        return html.replace(/ crossorigin/g, '')
      },
    },
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['node-pty', 'electron-store', 'chokidar', '@anthropic-ai/sdk', 'openai'],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(args) {
          args.reload()
        },
      },
    ]),
    electronRenderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
})
