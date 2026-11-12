// 播放 10 秒后暂停（节目监视器播放按钮），中途截一张图；收集界面报错文字
// 环境变量：TAG 截图前缀，PX/PY 播放按钮 CSS 坐标，SEEK=1 先把播放头放回 0
module.exports = async (page, b, { shot }) => {
  const tag = process.env.TAG || 'x'
  const px = Number(process.env.PX || 1108), py = Number(process.env.PY || 900)
  const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 200)))
  const findBad = () => page.evaluate(() => {
    const t = document.body.innerText
    return ['过多', '无法显示', '失败', '出错', '错误'].filter(k => t.includes(k)).map(k => { const i = t.indexOf(k); return t.slice(Math.max(0, i - 40), i + 40).replace(/\n/g, ' ') })
  })
  { const tk = page.getByText('接管', { exact: true }); const n = await tk.count(); for (let i = 0; i < n; i++) { try { await tk.nth(i).click({ timeout: 1500 }) } catch {} } await page.waitForTimeout(500) }
  const tc = () => page.evaluate(() => document.body.innerText.match(/\d\d:\d\d:\d\d:\d\d NDF/)?.[0])
  if (process.env.SEEK) { await page.mouse.click(418, 851); await page.waitForTimeout(2500) }
  const tcStart = await tc()
  const t0 = new Date().toISOString()
  await page.mouse.click(px, py)
  await page.waitForTimeout(5000)
  await shot(`${tag}-play.jpg`)
  const bad = await findBad()
  await page.waitForTimeout(5000)
  await page.mouse.click(px, py)
  const t1 = new Date().toISOString()
  await page.waitForTimeout(1000)
  const tcEnd = await tc()
  return { t0, t1, tcStart, tcEnd, errs, bad }
}
