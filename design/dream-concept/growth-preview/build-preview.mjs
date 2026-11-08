import { fileURLToPath } from 'node:url'
import { build } from '../../../.agents/skills/stageshow/node_modules/vite/dist/node/index.js'

const fromHere = (path) => fileURLToPath(new URL(path, import.meta.url))

await build({
  configFile: fromHere('../vite.config.mjs'),
  root: fromHere('../'),
  base: './',
  build: {
    outDir: fromHere('../../../dist/growth-preview/'),
    emptyOutDir: false,
    rollupOptions: { input: fromHere('../growth-preview.html') },
  },
})
