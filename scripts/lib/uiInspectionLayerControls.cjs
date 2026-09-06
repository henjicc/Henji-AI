const { openCanvasImageEditorV3Fixture } = require('./uiInspectionCanvasImageEditorV3.cjs')

function createLayerControlsScene(context) {
  return {
    id: 'image-editor-layer-controls', surface: '画布', name: '画布节点-图片图层点击选择与变换控制点', writesUserData: true,
    setup: async (page, _app, inspection) => {
      const { editor, fixture } = await openCanvasImageEditorV3Fixture({
        page, context, width: 960, height: 640, label: '图层交互测试', solidColor: 'rgb(30,90,160)',
        foreground: { width: 960, height: 640, color: 'rgb(230,120,30)', transform: [1, 0, 0, 1, 0, 0],
          contentRect: [160, 160, 200, 160], hole: [220, 210, 40, 40] },
      })
      const preview = editor.locator('[data-preview-surface]')
      await page.waitForFunction(() => document.querySelector('[data-preview-surface]')?.dataset.layerPickingReadyCount === '2')
      await page.waitForFunction(() => document.querySelector('[data-preview-surface]')?.dataset.previewCompositionBackend === 'gpu')
      const frame = await editor.locator('[data-viewport-content]').boundingBox()
      if (!frame) throw new Error('缺少文档视口')
      const point = (x, y) => [frame.x + x * frame.width / 960, frame.y + y * frame.height / 640]
      const revision = async () => Number(await editor.locator('[data-command-bar]').getAttribute('data-document-revision'))
      const expectSelected = async (id) => {
        await editor.locator(`[data-layer-transform-controls="${id}"]`).waitFor({ state: 'attached' })
      }
      await page.mouse.click(...point(180, 180))
      await expectSelected('reality-gpu-foreground-layer')
      if (await revision() !== 0) throw new Error('仅选择图层不应写入文档')
      await page.mouse.click(...point(240, 230))
      await expectSelected('reality-gpu-source-layer')
      await page.mouse.click(...point(180, 180))
      await expectSelected('reality-gpu-foreground-layer')
      const corner = editor.locator('[data-layer-transform-handle="se"]')
      const box = await corner.boundingBox()
      if (!box) throw new Error('缩放控制点不存在')
      const expectedCorner = point(360, 320)
      if (Math.abs(box.x + box.width / 2 - expectedCorner[0]) > 3
        || Math.abs(box.y + box.height / 2 - expectedCorner[1]) > 3) {
        await inspection?.capture?.('layer-controls-misaligned')
        throw new Error(`控制框未贴合有效像素边界：${JSON.stringify({ box, frame, expectedCorner,
          control: await corner.getAttribute('style') })}`)
      }
      const drag = async (from, to, expectedRevision) => {
        await page.mouse.move(...from); await page.mouse.down()
        await page.mouse.move(...to, { steps: 20 })
        if (await revision() !== expectedRevision || await preview.getAttribute('data-preview-override-count') !== '0') {
          throw new Error('GPU 变换过程中写入了持久文档或草稿')
        }
        await page.mouse.up()
        await page.waitForFunction((expected) => Number(document.querySelector('[data-command-bar]')?.dataset.documentRevision) === expected,
          expectedRevision + 1)
      }
      await drag([box.x + box.width / 2, box.y + box.height / 2],
        [box.x + box.width / 2 + 40, box.y + box.height / 2 + 32], 0)
      await editor.getByRole('button', { name: /^(撤销|Undo)$/ }).click()
      await page.waitForFunction(() => Number(document.querySelector('[data-command-bar]')?.dataset.documentRevision) === 2)
      await drag(point(180, 180), point(220, 195), 2)
      const rotation = await editor.locator('[data-layer-transform-handle="rotate"]').boundingBox()
      const nw = await editor.locator('[data-layer-transform-handle="nw"]').boundingBox()
      const se = await corner.boundingBox()
      if (!rotation || !nw || !se) throw new Error('移动后控制点丢失')
      const center = [(nw.x + nw.width / 2 + se.x + se.width / 2) / 2,
        (nw.y + nw.height / 2 + se.y + se.height / 2) / 2]
      const rotationStart = [rotation.x + rotation.width / 2, rotation.y + rotation.height / 2]
      const rotationEnd = [center[0] + center[1] - rotationStart[1], center[1]]
      await drag(rotationStart, rotationEnd, 3)
      // 等正式保存队列确认，而非仅检查 React 数字。
      let snapshot = null
      const deadline = Date.now() + 15000
      while (Date.now() < deadline) {
        snapshot = await page.evaluate(async (documentRef) => window.henjiNative.imageEditorV3.loadDocument({
          requestId: crypto.randomUUID(), documentRef,
        }), fixture.documentRef)
        if (snapshot?.revision === 4) break
        await page.waitForTimeout(100)
      }
      if (snapshot?.revision !== 4) throw new Error('图层变换未及时保存')
      const transform = snapshot.document.layers[1].transform
      if (Math.abs(transform[0]) > 0.02 || Math.abs(transform[1] - 1) > 0.02
        || snapshot.history.undo.length !== 2) throw new Error('旋转矩阵或撤销历史没有正确保存')
      const cancelHandle = await corner.boundingBox()
      await page.mouse.move(cancelHandle.x + cancelHandle.width / 2, cancelHandle.y + cancelHandle.height / 2)
      await page.mouse.down(); await page.mouse.move(cancelHandle.x + 30, cancelHandle.y + 30)
      await page.keyboard.press('Escape'); await page.mouse.up()
      if (await revision() !== 4) throw new Error('取消变换产生了持久修改')
      const handleSize = (await corner.boundingBox()).width
      await editor.locator('[data-viewport-control]').getByRole('button').last().click()
      await context.settlePage(page, 150)
      const zoomedFrame = await editor.locator('[data-viewport-content]').boundingBox()
      const zoomedHandle = await corner.boundingBox()
      if (Math.abs(zoomedHandle.width - handleSize) > 1) throw new Error('视口缩放改变了控制点的屏幕尺寸')
      const transformedPoint = (x, y) => [zoomedFrame.x
        + (transform[0] * x + transform[2] * y + transform[4]) * zoomedFrame.width / 960,
      zoomedFrame.y + (transform[1] * x + transform[3] * y + transform[5]) * zoomedFrame.height / 640]
      await page.mouse.click(...transformedPoint(240, 230))
      await expectSelected('reality-gpu-source-layer')
      await page.mouse.click(...transformedPoint(180, 180))
      await expectSelected('reality-gpu-foreground-layer')
      if (await revision() !== 4) throw new Error('缩放视口或选择图层写入了文档')
      await context.settlePage(page, 400)
      await inspection?.capture?.('layer-controls')
      console.log(`[image-editor-layer-controls] ${JSON.stringify({ alphaClickThrough: true, revision: 4,
        undoCount: snapshot.history.undo.length, transform, gpuTransient: true, cancelPreserved: true,
        zoomedPicking: true, constantHandleSize: true })}`)
    },
  }
}

module.exports = { createLayerControlsScene }
