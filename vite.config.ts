import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: './',
  build: { sourcemap: false },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
})
