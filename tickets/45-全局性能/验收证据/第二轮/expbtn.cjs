// 只读：查音频编辑顶栏“导出”“加入剪辑”按钮是否禁用，以及红色提示文字
module.exports = async (page, b, { shot }) => {
  await shot('c4-toolbar.jpg')
  return page.evaluate(() => [...document.querySelectorAll('button')].filter(e => /导出|加入剪辑/.test(e.innerText)).map(e => ({ t: e.innerText.trim(), disabled: e.disabled, aria: e.getAttribute('aria-disabled'), title: e.title })))
}
