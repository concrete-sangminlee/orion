import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const isTest = process.env.VITEST === 'true'

export default defineConfig({
  test: {
    // Keep build outputs and agent worktrees (.claude/worktrees) out of discovery.
    exclude: [...configDefaults.exclude, '.claude/**', 'dist/**', 'dist-cli/**', 'dist-electron/**', 'release/**'],
  },
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

          // Editor shell - keep React bindings cacheable without forcing an empty Monaco chunk
          'monaco-react': ['@monaco-editor/react'],

          // Terminal emulator + addons
          'xterm': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-web-links', '@xterm/addon-search'],

          // AI SDKs
          'ai-sdk': ['react-syntax-highlighter'],
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
      '@xterm/xterm',
      '@xterm/addon-fit',
      '@xterm/addon-web-links',
      '@xterm/addon-search',
      'react-syntax-highlighter',
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
    // Exclude electron plugins during vitest runs - their Node built-in shims
    // use require() which is not available in vitest's ESM environment
    ...(!isTest ? [
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
          onstart(args: { reload: () => void }) {
            args.reload()
          },
        },
      ]),
      // No vite-plugin-electron-renderer: the renderer runs with
      // nodeIntegration disabled, and that plugin rewrote Node built-in
      // imports into require() calls that crash it at startup.
    ] : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
})
