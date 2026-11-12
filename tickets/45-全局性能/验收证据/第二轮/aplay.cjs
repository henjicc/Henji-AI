// 音频编辑：播放 10 秒，暂停；缩放到整段后在标尺上点 6 个位置试听，再拖动一次
module.exports = async (page, b, { shot }) => {
  const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 200)))
  { const tk = page.getByText('接管', { exact: true }); const n = await tk.count(); for (let i = 0; i < n; i++) { try { await tk.nth(i).click({ timeout: 1500 }) } catch {} } await page.waitForTimeout(500) }
  const marks = {}
  const tc = () => page.evaluate(() => document.body.innerText.match(/\d\d:\d\d:\d\d\.\d\d\d/)?.[0])
  marks.play = new Date().toISOString()
  await page.mouse.click(543, 1379)
  await page.waitForTimeout(5000); await shot('c2-play.jpg')
  await page.waitForTimeout(5000)
  await page.mouse.click(543, 1379)
  marks.pause = new Date().toISOString(); marks.tcPause = await tc()
  await page.waitForTimeout(800)
  await page.mouse.click(1837, 1379) // 适合整段
  await page.waitForTimeout(1500)
  await shot('c2-fit.jpg')
  marks.scrub = new Date().toISOString()
  const xs = [0.15, 0.8, 0.35, 0.95, 0.55, 0.05]
  const x0 = 497, x1 = 2030, y = 147
  for (const f of xs) { await page.mouse.click(Math.round(x0 + (x1 - x0) * f), y); await page.waitForTimeout(1500) }
  // 拖动试听
  await page.mouse.move(x0 + 200, y); await page.mouse.down()
  for (let i = 0; i <= 40; i++) { await page.mouse.move(x0 + 200 + i * 20, y); await page.waitForTimeout(50) }
  await page.mouse.up()
  marks.scrubEnd = new Date().toISOString(); marks.tcEnd = await tc()
  await page.waitForTimeout(800)
  await shot('c2-after.jpg')
  marks.errs = errs
  return marks
}
