import { launch } from '../../.agents/skills/stageshow/scripts/browser.mjs'
import { fileURLToPath } from 'node:url'
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1000, height: 1000 }, deviceScaleFactor: 1 })
await page.goto('http://127.0.0.1:5176/@fs/C:/workspace/stun/gongteo-survivor/design/hud-detail-review/index.html', { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: fileURLToPath(new URL('../../artifacts/survivorio-hud-detail-review.png', import.meta.url)), fullPage: true })
console.log(JSON.stringify({ title: await page.title(), imageLoaded: await page.locator('image').count(), overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) }))
await browser.close()
