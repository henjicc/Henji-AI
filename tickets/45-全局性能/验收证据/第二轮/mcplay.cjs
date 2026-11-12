// 打开节目监视器“…”里的多机位视图，等首帧后播放 10 秒再暂停，中途截图
module.exports = async (page, b, { shot }) => {
  const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 200)))
  { const tk = page.getByText('接管', { exact: true }); const n = await tk.count(); for (let i = 0; i < n; i++) { try { await tk.nth(i).click({ timeout: 1500 }) } catch {} } await page.waitForTimeout(500) }
  await page.mouse.click(1416, 900); await page.waitForTimeout(600)
  await page.getByText('多机位视图（1–9 切换）').click({ timeout: 3000 })
  await page.keyboard.press('Escape').catch(() => {})
  const tOpen = new Date().toISOString()
  await page.waitForTimeout(4000)
  await shot('b-open.jpg')
  const tc = () => page.evaluate(() => document.body.innerText.match(/\d\d:\d\d:\d\d:\d\d NDF/)?.[0])
  const tcStart = await tc()
  const t0 = new Date().toISOString()
  await page.mouse.click(1108, 900)
  await page.waitForTimeout(5000)
  await shot('b-play.jpg')
  await page.waitForTimeout(5000)
  await page.mouse.click(1108, 900)
  const t1 = new Date().toISOString()
  await page.waitForTimeout(1500)
  const tcEnd = await tc()
  const bad = await page.evaluate(() => { const t = document.body.innerText; return ['过多', '无法显示', '失败', '出错', '错误'].filter(k => t.includes(k)) })
  return { tOpen, t0, t1, tcStart, tcEnd, errs, bad }
}
