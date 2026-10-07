const assert = require('node:assert/strict')

// Existing picture/audio comparisons explicitly retain burned captions and unnormalized sound.
// Check the new default before applying those scene-specific choices.
async function confirmVideoEditExport(page, onOpen) {
  await page.getByRole('button', { name: '导出视频', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '导出', exact: true })
  await dialog.waitFor({ state: 'visible' })
  // 可选：面板打开后留一张截图，供目视核对布局。
  if (onOpen) {
    // The dialog wrapper itself is opaque; its panel and scrim carry the fade transition.
    await dialog.evaluate(async node => {
      const surfaces = [...node.children]
      await new Promise((resolve, reject) => {
        const deadline = performance.now() + 5000
        const settled = () => {
          if (surfaces.every(surface => getComputedStyle(surface).opacity === '1' && !surface.getAnimations().some(animation => animation.playState === 'running'))) resolve()
          else if (performance.now() > deadline) reject(new Error('导出弹窗淡入未完成，不能截取中途画面。'))
          else requestAnimationFrame(settled)
        }
        requestAnimationFrame(settled)
      })
    })
    await onOpen(dialog)
  }
  assert.match(await dialog.getByRole('button', { name: '导出预设', exact: true }).textContent(), /与序列一致/)
  const loudness = dialog.getByRole('switch', { name: '启用响度', exact: true })
  if (await loudness.getAttribute('aria-checked') === 'true') await loudness.click()
  const captions = dialog.getByRole('switch', { name: '启用字幕', exact: true })
  if (await captions.getAttribute('aria-checked') !== 'true') await captions.click()
  await dialog.getByRole('button', { name: '导出范围', exact: true }).click()
  const marks = page.getByRole('option', { name: '入点到出点', exact: true })
  if (!await marks.isDisabled()) await marks.click()
  else await page.getByRole('option', { name: '整个序列', exact: true }).click()
  await page.waitForFunction(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find(node => node.textContent.includes('文件名'))
    const submit = dialog && [...dialog.querySelectorAll('button')].find(node => node.textContent === '导出')
    return submit && (!submit.disabled || dialog.textContent.includes('当前设备不支持所选编码设置'))
  })
  if (await dialog.getByRole('button', { name: '导出', exact: true }).isDisabled()) {
    await dialog.getByRole('button', { name: '导出格式', exact: true }).click()
    const avc = page.getByRole('option', { name: 'MP4 · H.264', exact: true })
    const codec = !await avc.isDisabled() ? avc : page.getByRole('option', { name: 'MP4 · HEVC (H.265)', exact: true })
    assert.ok(!await codec.isDisabled(), '此场景规格须有可用编码组合')
    await codec.click()
  }
  await dialog.getByRole('button', { name: '导出', exact: true }).click()
  // Close settings while encoding continues, so existing progress/cancel scenarios can reach the toolbar.
  const close = dialog.getByRole('button', { name: '导出 - 关闭', exact: true })
  if (await close.isVisible()) await close.click()
}
module.exports = { confirmVideoEditExport }
