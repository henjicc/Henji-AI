const assert = require('node:assert/strict')

// Existing picture/audio comparisons explicitly retain burned captions and unnormalized sound.
// Check the new default before applying those scene-specific choices.
async function confirmVideoEditExport(page, onOpen, outputPath) {
  await page.getByRole('button', { name: '导出视频', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '导出', exact: true })
  await dialog.waitFor({ state: 'visible' })
  if (outputPath) {
    await dialog.getByRole('textbox', { name: '导出文件名', exact: true }).fill(require('node:path').basename(outputPath))
    await dialog.getByRole('button', { name: '选择导出目录', exact: true }).click()
  }
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
  // 窗口会恢复本机记住的上次导出设置；先回到“与序列一致”，场景才不依赖之前跑过什么。
  await dialog.getByRole('button', { name: '导出预设', exact: true }).click()
  await page.getByRole('option', { name: '与序列一致', exact: true }).click()
  assert.equal(await dialog.getByRole('button', { name: '导出预设', exact: true }).textContent(), '与序列一致')
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
    const error = dialog?.querySelector('[role="alert"]')
    return submit && (!submit.disabled || error?.textContent.includes('当前设备不支持所选编码设置'))
  })
  if (await dialog.getByRole('button', { name: '导出', exact: true }).isDisabled()) {
    await dialog.getByRole('button', { name: '导出格式', exact: true }).click()
    const avc = page.getByRole('option', { name: 'MP4 · H.264', exact: true })
    const codec = !await avc.isDisabled() ? avc : page.getByRole('option', { name: 'MP4 · HEVC (H.265)', exact: true })
    assert.ok(!await codec.isDisabled(), '此场景规格须有可用编码组合')
    await codec.click()
  }
  await dialog.getByRole('button', { name: '导出', exact: true }).click()
  await page.getByRole('dialog', { name: /^(正在导出|准备导出|导出完成|导出失败)$/ }).waitFor({ state: 'visible' })
}
async function finishVideoEditExport(page) {
  const progress = page.getByRole('dialog', { name: /^导出(完成|失败|已取消|已中断)$/ })
  await progress.waitFor({ state: 'visible', timeout: 120000 })
  assert.equal(await page.getByRole('dialog', { name: '导出完成', exact: true }).count(), 1, `导出未成功：${await progress.innerText()}`)
  await progress.getByRole('button', { name: '完成', exact: true }).click()
  await progress.waitFor({ state: 'hidden' })
}
module.exports = { confirmVideoEditExport, finishVideoEditExport }
