import { launch } from '../../.agents/skills/stageshow/scripts/browser.mjs'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
const out = fileURLToPath(new URL('../../artifacts/', import.meta.url))
const version = process.argv[2] || 'v7'
mkdirSync(out, { recursive: true })
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1120 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.goto('http://127.0.0.1:5176/', { waitUntil: 'networkidle' })
await page.evaluate(() => document.fonts.ready)
await page.locator('.dream-screen').first().waitFor()
await page.screenshot({ path: `${out}/dream-concept-board-${version}.png`, fullPage: true })
for (const name of ['title', 'combat', 'pause']) {
  await page.locator(`.screen-figure .dream-${name} .ss-stage`).screenshot({ path: `${out}/dream-concept-${name}-${version}.png` })
}
const checks = []
checks.push({ check: 'desktop overflow', passed: await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth) })
await page.getByRole('button', { name: '화면 눌러보기' }).click()
const dialog = page.locator('.preview-dialog')
await dialog.getByRole('button', { name: '꿈으로 들어가기' }).click()
checks.push({ check: 'title to combat', passed: await dialog.locator('[data-screen=combat]').count() === 1 })
await dialog.getByRole('button', { name: '일시정지 메뉴' }).click()
checks.push({ check: 'combat to pause', passed: await dialog.locator('[data-screen=pause]').count() === 1 })
await dialog.getByRole('button', { name: '플레이어 스탯' }).click()
checks.push({ check: 'stats preview', passed: await dialog.locator('.stat-list>div').count() === 8 })
await page.keyboard.press('Escape')
checks.push({ check: 'Escape returns to menu', passed: await dialog.getByRole('button', { name: '계속하기' }).isVisible() })
await dialog.getByRole('button', { name: '환경설정' }).click()
await dialog.getByRole('checkbox', { name: '피격 효과 줄이기' }).check()
checks.push({ check: 'setting toggle', passed: await dialog.getByRole('checkbox').isChecked() })
await page.keyboard.press('Escape')
await dialog.getByRole('button', { name: '계속하기' }).click()
await page.keyboard.press('Escape')
checks.push({ check: 'Escape pauses combat', passed: await dialog.locator('[data-screen=pause]').count() === 1 })
await dialog.getByRole('button', { name: '다시 시작' }).click()
await dialog.getByRole('button', { name: '처음으로' }).click()
checks.push({ check: 'restart returns to title', passed: await dialog.locator('[data-screen=title]').count() === 1 })
await dialog.getByRole('button', { name: '미리보기 닫기' }).click()
checks.push({ check: 'focus restored', passed: await page.getByRole('button', { name: '화면 눌러보기' }).evaluate(el => el === document.activeElement) })
for (const width of [390, 320]) {
  await page.setViewportSize({ width, height: 844 })
  await page.screenshot({ path: `${out}/dream-concept-mobile-${width}-${version}.png`, fullPage: true })
  checks.push({ check: `${width}px overflow`, passed: await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth) })
}
await page.emulateMedia({ reducedMotion: 'reduce' })
await page.setViewportSize({ width: 390, height: 844 })
await page.getByRole('button', { name: '화면 눌러보기' }).click()
await dialog.getByRole('button', { name: '잠깐의 쉼' }).click()
await page.screenshot({ path: `${out}/dream-concept-mobile-pause-${version}.png`, fullPage: false })
checks.push({ check: 'reduced motion complete pause', passed: await dialog.getByRole('button', { name: '계속하기' }).isVisible() })
checks.push({ check: 'no runtime errors', passed: errors.length === 0 })
const result = { checks, errors }
writeFileSync(`${out}/dream-concept-checks.json`, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
await browser.close()
if (checks.some(check => !check.passed)) process.exitCode = 1
