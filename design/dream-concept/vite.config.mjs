import { defineConfig } from '../../.agents/skills/stageshow/node_modules/vite/dist/node/index.js'
import { fileURLToPath } from 'node:url'

const dependency = name => fileURLToPath(new URL(`../../.agents/skills/stageshow/node_modules/${name}`, import.meta.url))
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { react: dependency('react'), 'react-dom': dependency('react-dom'), 'lucide-react': dependency('lucide-react') } },
  server: { host: '127.0.0.1', port: 5176, strictPort: true, fs: { allow: ['../..'] } },
  build: { outDir: 'build', emptyOutDir: true },
})
