const { writeFile } = require('node:fs/promises')
const { captureInspectionPage } = require('./uiInspectionCapture.cjs')

async function readRelightLayout(page, nodeId) {
  const shell = page.locator(`[data-relight-node-id="${nodeId}"]`)
  await page.waitForTimeout(180)
  const layout = await shell.evaluate(root => {
    const frame = root.closest('.react-flow__node').getBoundingClientRect()
    const box = root.getBoundingClientRect()
    const inspector = root.querySelector('[data-relight-inspector]')
    const field = inspector.querySelector('textarea').getBoundingClientRect()
    const panel = inspector.getBoundingClientRect()
    const scale = box.height / root.offsetHeight
    return { right: box.right, width: box.width, height: box.height,
      frameWidth: frame.width, frameHeight: frame.height,
      fieldHeight: field.height, gap: panel.bottom - field.bottom - parseFloat(getComputedStyle(inspector).paddingBottom) * scale,
      overflow: inspector.scrollHeight - inspector.clientHeight,
      sourceImages: inspector.querySelectorAll('img').length }
  })
  if (Math.abs(layout.width - layout.frameWidth) > 1 || Math.abs(layout.height - layout.frameHeight) > 1) {
    throw new Error(`打光内外框尺寸不一致：${JSON.stringify(layout)}`)
  }
  if (Math.abs(layout.gap) > 2 || layout.overflow > 1) throw new Error(`补充要求未填满剩余高度或溢出：${JSON.stringify(layout)}`)
  return layout
}

async function switchRelightMode(page, nodeId, label) {
  const before = await readRelightLayout(page, nodeId)
  await page.locator(`[data-relight-node-id="${nodeId}"]`).getByRole('button', { name: label, exact: true }).click()
  const after = await readRelightLayout(page, nodeId)
  if (Math.abs(before.right - after.right) > 1) throw new Error(`模式切换未固定右边缘：${before.right} → ${after.right}`)
  if (label === '智能打光' && after.sourceImages) throw new Error('智能打光仍重复显示原图')
  return after
}

async function verifyRelightResizeModes(page, nodeId, resize, electronApp) {
  const manual = await readRelightLayout(page, nodeId)
  const smart = await switchRelightMode(page, nodeId, '智能打光')
  const shell = page.locator(`[data-relight-node-id="${nodeId}"]`)
  const node = shell.locator('xpath=ancestor::*[contains(@class,"react-flow__node")][1]')
  await resize(page, node, shell, '智能打光节点')
  const resized = await readRelightLayout(page, nodeId)
  if (resized.fieldHeight < smart.fieldHeight + 8) throw new Error('智能打光输入框没有随节点增高')
  await writeFile('.ui-tour/relight-smart-resized.png', await captureInspectionPage(electronApp, page))
  const restored = await switchRelightMode(page, nodeId, '手动打光')
  if (Math.abs(restored.width - manual.width) > 1 || Math.abs(restored.height - manual.height) > 1) {
    throw new Error(`切回手动打光未恢复该模式的手动尺寸：${JSON.stringify({ manual, restored })}`)
  }
  await writeFile('.ui-tour/relight-manual-restored.png', await captureInspectionPage(electronApp, page))
  const smartAgain = await switchRelightMode(page, nodeId, '智能打光')
  if (Math.abs(smartAgain.width - resized.width) > 1 || Math.abs(smartAgain.height - resized.height) > 1) {
    throw new Error('智能打光的手动尺寸未被保留')
  }
  await switchRelightMode(page, nodeId, '手动打光')
}

async function ensureWorkbenchInViewport(page, shell) {
  // 小窗口缩放节点后，用真实画布缩放把完整工作面纳入截图，不裁掉待验证区域。
  for (let attempt = 0; attempt < 8; attempt++) {
    const box = await shell.boundingBox()
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    if (box && box.x >= 16 && box.y >= 64 && box.x + box.width <= viewport.width - 16
      && box.y + box.height <= viewport.height - 16) return
    const point = await page.evaluate(() => {
      for (let y = 110; y < innerHeight - 80; y += 40)
        for (let x = 60; x < innerWidth - 80; x += 40)
          if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) return { x, y }
      return null
    })
    if (!point) throw new Error('找不到可缩放画布的空白区域')
    await page.mouse.move(point.x, point.y)
    await page.mouse.wheel(0, 220)
    await page.waitForTimeout(250)
  }
  throw new Error('完整工作面无法进入当前巡检视口')
}

module.exports = { readRelightLayout, switchRelightMode, verifyRelightResizeModes, ensureWorkbenchInViewport }
