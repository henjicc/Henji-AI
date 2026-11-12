// 找“多机位视图”入口：列出含“多机位”的可点击元素与节目面板菜单项
module.exports = async (page, b, { shot }) => {
  const list = () => page.evaluate(() => [...document.querySelectorAll('button,[role=menuitem],[role=menuitemcheckbox],[title],[aria-label]')]
    .filter(e => /多机位/.test((e.innerText || '') + (e.title || '') + (e.getAttribute('aria-label') || '')))
    .map(e => { const r = e.getBoundingClientRect(); return { t: (e.innerText || e.title || e.getAttribute('aria-label')).slice(0, 40), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } }))
  const before = await list()
  // 打开节目面板菜单（标题旁 ≡）
  await page.mouse.click(Math.round(373 * 1.28), Math.round(79 * 1.28)); await page.waitForTimeout(600)
  const menu = await page.evaluate(() => [...document.querySelectorAll('[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio]')].map(e => { const r = e.getBoundingClientRect(); return { t: e.innerText.slice(0, 30), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } }))
  await shot('b0-menu.jpg')
  await page.keyboard.press('Escape')
  return { before, menu }
}
