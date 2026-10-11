/* eslint-disable @typescript-eslint/no-var-requires -- 正式 Electron 巡检使用 CommonJS 场景工厂。 */
const assert = require('node:assert/strict')
const { createCanvasDocument, readCanvasDocument } = require('./canvasDocumentFixture.cjs')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')

function createCanvasTidyScene(context) {
  return {
    id: 'canvas-tidy', surface: '画布', name: '画布整理-候选钉住应用与一步撤销', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const restore = await blockPaidGeneration(app)
      const id = '__reality_canvas_tidy'
      const card = (id, title, x, y, width, height) => ({ id, type: 'textAnnotationNode',
        position: { x, y }, width, height, style: { width, height },
        data: { displayName: title, content: `## ${title}\n\n布局参考 · 保留内容和连线` } })
      const nodes = [
        card('a', '主题标题', 40, 160, 240, 130),
        card('b', '构图参考', 410, 300, 300, 200),
        card('c', '镜头说明', 820, 200, 220, 150),
        card('d', '色彩备注', 1200, 380, 240, 160),
        { ...card('container', '分组', 40, 620, 1400, 380), type: 'groupNode', data: { label: '分组参考', displayName: '分组参考' } },
        { ...card('child-a', '组内 A', 45, 90, 240, 140), parentId: 'container', extent: 'parent' },
        { ...card('child-b', '组内 B（锁定）', 430, 150, 280, 170), parentId: 'container', extent: 'parent', draggable: false },
      ]
      const edges = [{ id: 'link', source: 'a', target: 'c', sourceHandle: 'source', targetHandle: 'target', type: 'disconnectableEdge' }]
      const selected = ['a', 'b', 'c', 'd', 'child-a', 'child-b']
      const node = id => page.locator(`.react-flow__node[data-id="${id}"]`)
      const panel = () => page.locator('[data-canvas-tidy-panel]')
      const shot = async name => { await context.settlePage(page, 250); await capture(name) }
      const positions = record => record.nodes.map(n => [n.id, n.position])
      const geometry = async () => page.locator('.react-flow__node').evaluateAll(elements => Object.fromEntries(elements.map(e => [e.dataset.id, e.style.transform])))
      try {
        await createCanvasDocument(page, { id, name: '画布随手摆验收', nodes, edges, imagePool: [], viewport: { x: 120, y: 15, zoom: .64 }, replace: true })
        await page.reload({ waitUntil: 'domcontentloaded' })
        await context.setupCanvas(page)
        await page.locator(`[data-project-id="${id}"]`).click()
        await node('child-b').waitFor({ state: 'visible' })
        for (let i = 0; i < selected.length; i++) await page.locator(`[data-node-header-drag-surface="${selected[i]}"]`).click({ modifiers: i ? ['Control'] : [] })
        await shot('01-rough')
        assert.equal(await page.locator('.react-flow__node.selected').count(), selected.length, '标题多选必须覆盖全部目标')
        await page.getByRole('button', { name: '整理', exact: true }).waitFor()
        const before = await readCanvasDocument(page, id)
        const rough = await geometry()
        await page.getByRole('button', { name: '整理', exact: true }).click()
        await panel().waitFor()
        await shot('02-align')
        assert.deepEqual(positions(await readCanvasDocument(page, id)), positions(before), '预览不能写盘')
        await panel().getByRole('button', { name: '网格规整', exact: true }).click()
        await shot('03-grid')
        await panel().getByRole('button', { name: '钉住节点', exact: true }).click()
        await shot('03a-pin-options')
        await page.locator('[data-dropdown-portal]').getByRole('button', { name: '构图参考', exact: true }).click()
        await panel().getByText('整理', { exact: true }).click()
        await shot('04-pinned')
        const pinned = await geometry()
        assert.equal(pinned.b, rough.b, '钉住节点保持位置')
        assert.equal(pinned['child-b'], rough['child-b'], '锁定节点保持位置')
        assert.deepEqual(positions(await readCanvasDocument(page, id)), positions(before), '切换和钉住不写盘')
        await panel().getByRole('button', { name: '应用', exact: true }).click()
        await panel().waitFor({ state: 'hidden' })
        await shot('05-applied')
        let after
        for (let i = 0; i < 30; i++) {
          after = await readCanvasDocument(page, id)
          if (JSON.stringify(positions(after)) !== JSON.stringify(positions(before))) break
          await page.waitForTimeout(100)
        }
        assert.notDeepEqual(positions(after), positions(before), '应用必须保存真实位置')
        assert.deepEqual(after.edges, before.edges, '连线保持')
        const structure = record => record.nodes.map(n => [n.id, n.width, n.height, n.parentId, n.extent, n.draggable])
        assert.deepEqual(structure(after), structure(before), '尺寸和容器关系保持')
        assert.equal((await geometry()).b, rough.b)
        await page.keyboard.press('Control+z')
        await shot('06-undo')
        for (let i = 0; i < 30; i++) {
          if (JSON.stringify(positions(await readCanvasDocument(page, id))) === JSON.stringify(positions(before))) break
          await page.waitForTimeout(100)
        }
        assert.deepEqual(positions(await readCanvasDocument(page, id)), positions(before), '一次撤销恢复全部节点')
        assert.deepEqual(await geometry(), rough, '缩放平移下的预览和撤销坐标一致')
      } finally { await restore() }
    },
  }
}

module.exports = { createCanvasTidyScene }
