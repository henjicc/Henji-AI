// 打开节目监视器“…”里的多机位视图并截图
module.exports = async (page, b, { shot }) => {
  { const tk = page.getByText('接管', { exact: true }); const n = await tk.count(); for (let i = 0; i < n; i++) { try { await tk.nth(i).click({ timeout: 1500 }) } catch {} } await page.waitForTimeout(500) }
  await page.mouse.click(1416, 900); await page.waitForTimeout(600)
  await page.getByText('多机位视图（1–9 切换）').click({ timeout: 3000 })
  const tOpen = new Date().toISOString()
  await page.waitForTimeout(4000)
  await shot('b-open.jpg')
  return { tOpen }
}
