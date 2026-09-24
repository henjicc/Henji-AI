const { findPanePoint, readCanvasState, resetViewport } = require('./canvasPanBench.cjs')

async function checkCanvasViewport(page, session, inspection, context, projectId) {
  const original = await readCanvasState(page)
  if (await page.evaluate(() => window.henjiNative.runtimeInfo.uiInspectionReadOnly)) throw new Error('视口保存验收需要隔离数据模式下的 --allow-writes')
  const point = await findPanePoint(page)
  if (!point) throw new Error('视口交互检查找不到画布空白区域')
  const bounds = await page.locator('.react-flow').boundingBox()
  const anchor = { x: point.x - bounds.x, y: point.y - bounds.y }
  const world = { x: (anchor.x - original.x) / original.zoom, y: (anchor.y - original.y) / original.zoom }
  await page.mouse.move(point.x, point.y)
  await page.mouse.wheel(0, -140)
  await page.waitForFunction(zoom => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.react-flow__viewport')).transform)
    return matrix.a > zoom + 0.02
  }, original.zoom)
  await page.waitForTimeout(250)
  const zoomed = await readCanvasState(page)
  if (Math.abs((anchor.x - zoomed.x) / zoomed.zoom - world.x) > 2
    || Math.abs((anchor.y - zoomed.y) / zoomed.zoom - world.y) > 2) throw new Error('滚轮缩放偏离指针锚点')
  await inspection.capture(`viewport-zoom-${original.nodeCount}`)
  await page.mouse.wheel(0, 140)
  await page.waitForTimeout(250)
  const reversed = await readCanvasState(page)
  if (Math.abs(reversed.zoom - original.zoom) > 0.0001) throw new Error('反向滚轮未恢复原始缩放')

  const minimap = await page.locator('.canvas-minimap svg').boundingBox()
  if (!minimap) throw new Error('小地图缺失')
  const start = { x: minimap.x + minimap.width / 2, y: minimap.y + minimap.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 8, start.y + 4, { steps: 4 })
  await page.mouse.up()
  const minimapMoved = await readCanvasState(page)
  if (Math.abs(minimapMoved.x - reversed.x) < 2 || Math.abs(minimapMoved.zoom - original.zoom) > 0.0001) {
    throw new Error('小地图拖动未改变视口位置或意外改变缩放')
  }
  if (!(await resetViewport(page, session, { x: 125, y: 95, zoom: original.zoom })).ok) throw new Error('视口交互后无法平移复位')

  const expected = await readCanvasState(page)
  await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
  await page.locator(`[data-project-id="${projectId}"]`).waitFor()
  const matchesSaved = () => page.evaluate(async ({ projectId, expected }) => {
    const rows = await window.henjiNative.db.select('SELECT viewport_json FROM storyboard_projects WHERE id = ?', [projectId])
    const saved = JSON.parse(rows[0]?.viewport_json || '{}')
    return Math.abs(saved.x - expected.x) < 2 && Math.abs(saved.y - expected.y) < 2 && Math.abs(saved.zoom - expected.zoom) < 0.0001
  }, { projectId, expected })
  const deadline = Date.now() + 3000
  while (!(await matchesSaved()) && Date.now() < deadline) await page.waitForTimeout(100)
  if (!(await matchesSaved())) {
    const saved = await page.evaluate(async projectId => window.henjiNative.db.select('SELECT viewport_json FROM storyboard_projects WHERE id = ?', [projectId]), projectId)
    throw new Error(`视口保存未匹配：${JSON.stringify({ expected, saved })}`)
  }
  await page.reload({ waitUntil: 'domcontentloaded' })
  await context.setupCanvas(page)
  await page.locator(`[data-project-id="${projectId}"]`).click()
  await page.waitForFunction(expected => {
    const element = document.querySelector('.react-flow__viewport')
    if (!element) return false
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform)
    return Math.abs(matrix.m41 - expected.x) < 2 && Math.abs(matrix.m42 - expected.y) < 2 && Math.abs(matrix.a - expected.zoom) < 0.0001
  }, expected, { timeout: 30000 }).catch(async error => {
    const saved = await page.evaluate(async projectId => window.henjiNative.db.select('SELECT viewport_json FROM storyboard_projects WHERE id = ?', [projectId]), projectId)
    throw new Error(`视口重开未匹配：${JSON.stringify({ original, minimapMoved, expected, saved, actual: await readCanvasState(page) })}；${error.message}`)
  })
  await inspection.capture(`viewport-restored-${original.nodeCount}`)
  return { original, zoomed, minimapMoved, saved: expected, restored: await readCanvasState(page) }
}

module.exports = { checkCanvasViewport }
