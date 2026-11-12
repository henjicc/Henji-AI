// 音频编辑：点左上返回箭头回到文档列表（关闭当前文档），截图
module.exports = async (page, b, { shot }) => {
  { const tk = page.getByText('接管', { exact: true }); const n = await tk.count(); for (let i = 0; i < n; i++) { try { await tk.nth(i).click({ timeout: 1500 }) } catch {} } await page.waitForTimeout(500) }
  await shot('r2-before-back.jpg')
  await page.mouse.click(27, 60)
  await page.waitForTimeout(1500)
  await shot('r2-after-back.jpg')
  return page.evaluate(() => document.body.innerText.slice(0, 300))
}
