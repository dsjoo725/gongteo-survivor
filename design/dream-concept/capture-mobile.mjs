import { launch } from '../../.agents/skills/stageshow/scripts/browser.mjs'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'

const out = fileURLToPath(new URL('../../artifacts/', import.meta.url))
const version = process.argv[2] || 'v7'
const browser = await launch()
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
const page = await context.newPage()
const errors = []
const checks = []
page.on('pageerror', error => errors.push(error.message))
for (const [width, height] of [[320, 568], [360, 640], [390, 844], [412, 915]]) {
  await page.setViewportSize({ width, height })
  await page.goto('http://127.0.0.1:5176/?screen=combat', { waitUntil: 'networkidle' })
  await page.evaluate(() => document.fonts.ready)
  const geometry = await page.evaluate(() => {
    const rect = selector => {
      const { x, y, width, height, right, bottom } = document.querySelector(selector).getBoundingClientRect()
      return { x, y, width, height, right, bottom }
    }
    return { screen: rect('.dream-screen'), pause: rect('.pause-trigger'), time: rect('.hud-time'), kills: rect('.hud-kills'), overflow: document.documentElement.scrollWidth > innerWidth, font: getComputedStyle(document.querySelector('.hud-time strong')).fontFamily }
  })
  checks.push({ check: `${width}×${height} viewport, 48px pause, independent centered timer`, geometry, passed: !geometry.overflow && geometry.screen.width === width && geometry.screen.height === height && geometry.pause.width >= 48 && geometry.pause.height >= 48 && Math.abs(geometry.time.x + geometry.time.width / 2 - width / 2) < 1 && geometry.time.x - geometry.pause.right >= 8 && geometry.kills.x - geometry.time.right >= 8 })
  if ([320, 390].includes(width)) await page.screenshot({ path: `${out}/dream-combat-mobile-${width}-${version}.png` })
}
await page.setViewportSize({ width: 390, height: 844 })
await page.goto('http://127.0.0.1:5176/?screen=combat', { waitUntil: 'networkidle' })
await page.evaluate(() => {
  const host = document.querySelector('.solo-screen')
  host.style.setProperty('--device-safe-top', '44px')
  host.style.setProperty('--device-safe-bottom', '34px')
  host.style.setProperty('--device-safe-left', '8px')
  host.style.setProperty('--device-safe-right', '8px')
})
await page.screenshot({ path: `${out}/dream-combat-mobile-safe-${version}.png` })
const pause = page.getByRole('button', { name: '일시정지 메뉴' })
const before = await pause.boundingBox()
const safe = await page.evaluate(() => ({ pauseTop: document.querySelector('.pause-trigger').getBoundingClientRect().top, timeTop: document.querySelector('.hud-time').getBoundingClientRect().top, joystickBottom: document.querySelector('.dream-joystick').getBoundingClientRect().bottom }))
checks.push({ check: 'simulated safe area 44 top / 34 bottom / 8 sides', safe, passed: safe.pauseTop >= 44 && safe.timeTop >= 44 && safe.joystickBottom <= 844 - 34 })
await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
await page.mouse.down()
const pressed = await pause.boundingBox()
await page.screenshot({ path: `${out}/dream-combat-mobile-pressed-${version}.png`, clip: { x: 0, y: 0, width: 390, height: 170 } })
checks.push({ check: 'pressed pause keeps its touch target stable', passed: JSON.stringify(before) === JSON.stringify(pressed) })
await page.mouse.up()
await page.waitForURL('**/?screen=pause')
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: `${out}/dream-pause-mobile-${version}.png` })
await page.getByRole('button', { name: '환경설정' }).tap()
await page.getByRole('checkbox', { name: '피격 효과 줄이기' }).check()
await page.getByRole('button', { name: '돌아가기' }).tap()
await page.getByRole('button', { name: '계속하기' }).tap()
await page.waitForURL('**/?screen=combat')
checks.push({ check: 'touch pause → settings → menu → resume', passed: await pause.isVisible() })
checks.push({ check: 'no runtime errors', passed: errors.length === 0 })
writeFileSync(`${out}/dream-mobile-checks-${version}.json`, JSON.stringify({ checks, errors }, null, 2))
console.log(JSON.stringify({ checks, errors }, null, 2))
await browser.close()
if (checks.some(check => !check.passed)) process.exitCode = 1
