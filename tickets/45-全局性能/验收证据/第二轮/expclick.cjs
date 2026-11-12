// 点音频编辑顶栏“导出”，截图看弹出什么；列出可点的菜单项
module.exports = async (page, b, { shot }) => {
  await page.locator('button', { hasText: '导出' }).last().click()
  await page.waitForTimeout(800)
  await shot('c4-export-menu.jpg')
  return page.evaluate(() => [...document.querySelectorAll('[role=menuitem],[role=dialog] button,[role=menu] button,[role=option]')].map(e => { const r = e.getBoundingClientRect(); return { t: e.innerText.trim().slice(0, 40), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } }))
}
