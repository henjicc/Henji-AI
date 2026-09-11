const { writeFile } = require('node:fs/promises')
const { captureInspectionPage } = require('./uiInspectionCapture.cjs')

function createCanvasNodeInteractionsScene(context) {
  return {
    id: 'canvas-node-interactions', surface: '画布', name: '画布-模型面板锚定与Alt复制', writesUserData: true,
    async setup(page, app) {
      const { projectId, panoramaSource } = await context.seedAndOpenCanvasPanoramaProject(page)
      await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
      await page.locator(`[data-project-id="${projectId}"]:visible`).waitFor()
      await page.evaluate(async ({ projectId, panoramaSource }) => {
        const nodes = [
          { id: 'interaction-source', type: 'uploadNode', position: { x: 60, y: 100 },
            style: { width: 240, height: 120 }, data: { imageUrl: panoramaSource, aspectRatio: '2:1', displayName: 'Alt复制原图' } },
          { id: 'interaction-upper', type: 'imageNode', position: { x: 500, y: 60 }, data: { prompt: '上方节点' } },
          { id: 'interaction-lower', type: 'imageNode', position: { x: 500, y: 800 }, data: { prompt: '下方节点' } },
        ]
        await window.henjiNative.db.execute(
          'UPDATE storyboard_projects SET node_count = ?, nodes_json = ?, edges_json = ?, viewport_json = ?, history_json = ? WHERE id = ?',
          [nodes.length, JSON.stringify(nodes), '[]', JSON.stringify({ x: 90, y: 40, zoom: 0.65 }), JSON.stringify({ past: [], future: [], imagePool: [] }), projectId])
      }, { projectId, panoramaSource })
      await page.locator(`[data-project-id="${projectId}"]:visible`).click()
      const source = page.locator('.react-flow__node[data-id="interaction-source"]')
      await source.waitFor()
      const startBox = await source.boundingBox()
      const start = await source.evaluate(element => {
        const box = element.getBoundingClientRect()
        for (const dy of [3, 6, 10, 20]) {
          const x = box.left + box.width / 2, y = box.top + dy
          const hit = document.elementFromPoint(x, y)
          if (hit?.closest('.react-flow__node') === element && !hit.closest('.nodrag')) return { x, y }
        }
        throw new Error('未找到节点的真实拖拽区域')
      })
      await page.keyboard.down('Alt')
      await page.mouse.move(start.x, start.y)
      await page.mouse.down()
      try {
        // ReactFlow 在跨过拖动阈值时记录起点，后续距离从这个点计算。
        await page.mouse.move(start.x + 2, start.y + 2)
        await page.mouse.move(start.x + 122, start.y + 102, { steps: 12 })
        await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 4)
        const dragged = page.locator('.react-flow__node:not([data-id="interaction-source"]):not([data-id="interaction-upper"]):not([data-id="interaction-lower"])')
        const originalBox = await source.boundingBox()
        const copyBox = await dragged.boundingBox()
        if (Math.abs(originalBox.x - startBox.x) > 1 || Math.abs(originalBox.y - startBox.y) > 1) throw new Error('Alt拖动时原节点发生位移')
        if (Math.abs(copyBox.x - startBox.x - 120) > 3 || Math.abs(copyBox.y - startBox.y - 100) > 3) throw new Error(`副本未在松手前跟随指针：${JSON.stringify({ startBox, copyBox })}`)
        if (!(await dragged.getAttribute('class')).includes('selected')) throw new Error('拖动副本没有处于选中状态')
        await writeFile('.ui-tour/canvas-node-interactions-drag.png', await captureInspectionPage(app, page))
        // 提前释放 Alt 仍应结束同一复制手势。
        await page.keyboard.up('Alt')
        await page.mouse.move(start.x + 162, start.y + 112, { steps: 5 })
        await page.mouse.up()
        const finalBox = await dragged.boundingBox()
        if (Math.abs(finalBox.x - startBox.x - 160) > 3) throw new Error('提前释放Alt丢失复制手势')
        if (await page.locator('.react-flow__node').count() !== 4) throw new Error('松手时重复创建副本')
      } finally {
        await page.keyboard.up('Alt')
        await page.mouse.up()
      }

      await page.locator('.react-flow__pane').click({ position: { x: 20, y: 400 } })
      for (const id of ['interaction-upper', 'interaction-lower']) {
        const node = page.locator(`.react-flow__node[data-id="${id}"]`)
        const trigger = node.getByText('模型', { exact: true }).locator('..').getByRole('button')
        await trigger.click()
        const panel = page.locator('[data-model-panel-placement]:visible')
        await panel.waitFor()
        await page.waitForTimeout(300)
        const assertAnchor = async () => {
          const anchor = await trigger.boundingBox(), box = await panel.boundingBox()
          const placement = await panel.getAttribute('data-model-panel-placement')
          const gap = placement === 'above' ? anchor.y - box.y - box.height : box.y - anchor.y - anchor.height
          if (Math.abs(gap - 8) > 2) throw new Error(`模型面板偏离当前节点：${JSON.stringify({ id, gap, anchor, box, placement })}`)
        }
        await assertAnchor()
        await panel.getByRole('textbox').fill('不存在的模型候选')
        await page.waitForTimeout(250)
        await assertAnchor()
        await panel.getByRole('textbox').fill('')
        await page.waitForTimeout(250)
        await assertAnchor()
        await writeFile(`.ui-tour/canvas-node-interactions-${id}.png`, await captureInspectionPage(app, page))
        await trigger.click()
        await panel.waitFor({ state: 'hidden' })
      }
    },
  }
}

function createCanvasFirstResizeScene(context) {
  return {
    id: 'canvas-first-resize', surface: '画布', name: '画布-节点首次缩放', writesUserData: true,
    async setup(page, app) {
      const { projectId } = await context.seedAndOpenCanvasPanoramaProject(page)
      await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
      await page.locator(`[data-project-id="${projectId}"]:visible`).waitFor()
      const types = ['imageNode', 'videoGenNode', 'audioGenNode', 'upscaleGenNode']
      await page.evaluate(async ({ projectId, types }) => {
        const nodes = types.map((type, index) => ({
          id: `resize-${type}`, type,
          position: { x: 80 + (index % 2) * 680, y: 80 + Math.floor(index / 2) * 750 },
          data: { prompt: '第一次缩放应立即生效', isSizeManuallyAdjusted: false },
        }))
        await window.henjiNative.db.execute(
          'UPDATE storyboard_projects SET node_count = ?, nodes_json = ?, edges_json = ?, viewport_json = ?, history_json = ? WHERE id = ?',
          [nodes.length, JSON.stringify(nodes), '[]', JSON.stringify({ x: 90, y: 40, zoom: 0.65 }), JSON.stringify({ past: [], future: [], imagePool: [] }), projectId])
      }, { projectId, types })
      await page.locator(`[data-project-id="${projectId}"]:visible`).click()
      const resizedBoxes = []
      for (const type of types) {
        const node = page.locator(`.react-flow__node[data-id="resize-${type}"]`)
        const root = node.locator('[data-generation-node-id]')
        await root.waitFor()
        await context.resizeCanvasNodeAndAssertHitBox(page, node, root, type)
        const box = await root.boundingBox()
        resizedBoxes.push({ type, width: box.width, height: box.height })
      }
      await page.locator('.react-flow__pane').click({ position: { x: 20, y: 400 } })
      await writeFile('.ui-tour/canvas-first-resize.png', await captureInspectionPage(app, page))
      await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
      await page.locator(`[data-project-id="${projectId}"]:visible`).waitFor()
      await page.locator(`[data-project-id="${projectId}"]:visible`).click()
      for (const expected of resizedBoxes) {
        const root = page.locator(`[data-generation-node-id="resize-${expected.type}"]`)
        await root.waitFor()
        const actual = await root.boundingBox()
        if (Math.abs(actual.width - expected.width) > 2 || Math.abs(actual.height - expected.height) > 2) {
          throw new Error(`首次缩放保存重开后尺寸改变：${JSON.stringify({ expected, actual })}`)
        }
      }
    },
  }
}

module.exports = { createCanvasNodeInteractionsScene, createCanvasFirstResizeScene }
