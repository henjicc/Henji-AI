const { findPanePoint, resetViewport } = require('./canvasPanBench.cjs')

async function checkCanvasNodeLayout(page, session, viewport, inspection) {
  const node = page.locator('.react-flow__node[data-id="scale-1"]')
  await node.waitFor({ state: 'visible' })
  const originalText = await node.getByRole('textbox').first().textContent()
  const text = Array.from({ length: 24 }, (_, index) => `布局恢复验收第 ${index + 1} 段：保留构图、色彩和原始细节。`).join('\n')
  await node.getByRole('textbox').first().click()
  const editable = node.locator('[contenteditable="true"]')
  await editable.waitFor({ state: 'visible' })
  await editable.fill(text)
  const scrollTop = await editable.evaluate(element => { element.scrollTop = 100; return element.scrollTop })
  if (scrollTop < 50) throw new Error('节点恢复夹具没有形成滚动内容')
  await page.keyboard.press('Tab')
  await editable.waitFor({ state: 'hidden' })
  const point = await findPanePoint(page)
  if (!point) throw new Error('节点布局检查找不到空白点击位置')
  await page.mouse.click(point.x, point.y)
  const originalNode = await node.elementHandle()
  const before = await node.evaluate(element => ({
    width: element.offsetWidth, height: element.offsetHeight,
    minimum: element.style.getPropertyValue('--generation-node-min-height'),
    scrollTop: element.querySelector('[role="textbox"]').scrollTop,
    text: element.querySelector('[role="textbox"]').textContent,
  }))
  const edge = page.locator('.react-flow__edge[data-id="scale-edge-1"] .react-flow__edge-path').first()
  const edgeBefore = await edge.getAttribute('d')
  const away = { x: -5000, y: -2000, zoom: viewport.zoom }
  try {
    if (!(await resetViewport(page, session, away)).ok) throw new Error('无法平移到节点屏外')
    await page.waitForFunction(() => document.querySelector('.react-flow__node[data-id="scale-1"]')?.getAttribute('data-canvas-layout-suspended') === 'true')
    if (await edge.getAttribute('d') !== edgeBefore) throw new Error('暂停节点布局改变了既有连线几何')
    const suspendedCount = await page.locator('.react-flow__node[data-canvas-layout-suspended="true"]').count()
    if (!(await resetViewport(page, session, viewport)).ok) throw new Error('无法恢复节点视口')
    await node.waitFor({ state: 'visible' })
    const after = await node.evaluate((element, previous) => ({
      sameElement: element === previous,
      width: element.offsetWidth, height: element.offsetHeight,
      minimum: element.style.getPropertyValue('--generation-node-min-height'),
      scrollTop: element.querySelector('[role="textbox"]').scrollTop,
      text: element.querySelector('[role="textbox"]').textContent,
    }), originalNode)
    if (!after.sameElement || before.width !== after.width || before.height !== after.height
      || before.minimum !== after.minimum || Math.abs(after.scrollTop - before.scrollTop) > 1 || before.text !== after.text) {
      throw new Error(`节点恢复后身份、几何或草稿阅读位置变化：${JSON.stringify({ before, after })}`)
    }
    await inspection.capture(`layout-restored-${await page.locator('.react-flow__node').count()}`)
    // 屏外执行正式撤销，再显示；必须先恢复需要测量的节点，不能丢弃更新或归零高度。
    if (!(await resetViewport(page, session, away)).ok) throw new Error('无法再次进入屏外更新场景')
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    await page.keyboard.press(`${modifier}+z`)
    await page.waitForFunction(original => {
      const element = document.querySelector('.react-flow__node[data-id="scale-1"]')
      return element?.getAttribute('data-canvas-layout-suspended') === 'true'
        && element.querySelector('[role="textbox"]')?.textContent === original
    }, originalText, { timeout: 15000 })
    if (!(await resetViewport(page, session, viewport)).ok) throw new Error('屏外更新后无法恢复视口')
    await node.waitFor({ state: 'visible' })
    await page.keyboard.press(`${modifier}+Shift+z`)
    await page.waitForFunction(expected => document.querySelector('.react-flow__node[data-id="scale-1"] [role="textbox"]')?.textContent === expected, before.text)
    return { suspendedCount, before, after, backgroundUndoAndRedo: true }
  } finally { await originalNode?.dispose() }
}

module.exports = { checkCanvasNodeLayout }
