import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { datasetPlugin } from './vite-plugin-dataset.ts'
import { overrulesPlugin } from './vite-plugin-overrules.ts'

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), datasetPlugin(), overrulesPlugin()],
  // Most of the bundle is the embedded dataset (assertions, examples, c2bo snapshot), loaded once and kept in memory.
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    environment: 'node',
  },
})
