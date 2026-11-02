import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const pdfRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
const pdfAssets = ['cmaps', 'wasm', 'standard_fonts', 'iccs'].flatMap((directory) =>
  readdirSync(join(pdfRoot, directory)).map((name) => ({
    fileName: `pdfjs/${directory}/${name}`,
    source: readFileSync(join(pdfRoot, directory, name)),
  })))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), {
    name: 'pdfjs-runtime-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0]
        const asset = pdfAssets.find((item) => path === `${server.config.base}${item.fileName}`)
        if (!asset) return next()
        const contentType = asset.fileName.endsWith('.wasm') ? 'application/wasm'
          : asset.fileName.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'
        response.setHeader('Content-Type', contentType)
        response.end(asset.source)
      })
    },
    generateBundle() {
      for (const asset of pdfAssets) this.emitFile({ type: 'asset', ...asset })
    },
  }],
  server: {
    watch: {
      usePolling: process.env.WATCH_POLLING === 'true',
      interval: 1000,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
