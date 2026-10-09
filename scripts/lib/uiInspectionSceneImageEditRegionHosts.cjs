/* eslint-disable @typescript-eslint/no-var-requires -- 正式 Electron 巡检启动器使用 CommonJS 场景工厂。 */
const assert = require('node:assert/strict')

/** Registered by task 18, using the existing isolated canvas fixture and capturePage pipeline. */
function createImageEditRegionHostsScene(context) {
  return {
    id: 'image-edit-region-hosts', surface: '画布', name: '区域内核-参数蒙版确认、取消、软边与失败恢复', writesUserData: true,
    expectedLogEvents: ['mask_editor.preview.failed'],
    setup: async (page, app, { capture }) => {
      await context.setupCanvasGptMaskEditor(page)
      const dialog = page.getByRole('dialog', { name: /绘制局部重绘遮罩|Draw Inpainting Mask/i })
      const region = dialog.locator('[data-application-observation-region="mask_editor.canvas"]')
      const draw = async (from, to) => {
        const box = await region.locator('canvas').first().boundingBox()
        assert.ok(box && box.width > 0 && box.height > 0, '遮罩场景必须有实际画面')
        await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1])
        await page.mouse.down()
        await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 12 })
        await page.mouse.up()
        await context.settlePage(page, 700)
      }
      await capture('parameter-empty')
      await dialog.getByRole('button', { name: /^矩形/ }).click()
      await draw([0.15, 0.15], [0.5, 0.5])
      await capture('parameter-region')
      await dialog.getByRole('button', { name: /^画笔/ }).click()
      const hardness = dialog.getByRole('slider', { name: '画笔硬度' })
      await hardness.press('Home')
      for (let step = 0; step < 15; step++) await hardness.press('ArrowRight')
      const size = dialog.getByRole('slider', { name: '画笔大小' })
      await size.press('Home')
      for (let step = 0; step < 79; step++) await size.press('ArrowRight')
      await draw([0.45, 0.6], [0.8, 0.8])
      await capture('parameter-soft-edge')

      // The worker boundary is replaced only for a single isolated error state; no paid call or source mutation.
      await page.evaluate(() => {
        window.__regionScenePostMessage = Worker.prototype.postMessage
        Worker.prototype.postMessage = function (message, ...rest) {
          if (message.kind === 'read') {
            queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: { id: message.id, error: '区域场景求值失败替身' } })))
            return
          }
          return window.__regionScenePostMessage.call(this, message, ...rest)
        }
      })
      try {
        await draw([0.3, 0.7], [0.4, 0.8])
        await dialog.getByText('遮罩预览失败', { exact: true }).waitFor({ state: 'visible' })
        await capture('parameter-solve-failed')
      } finally {
        await page.evaluate(() => { Worker.prototype.postMessage = window.__regionScenePostMessage; delete window.__regionScenePostMessage })
      }
      await dialog.getByRole('button', { name: /重试/ }).click()
      await context.settlePage(page, 700)
      await capture('parameter-recovered')
      await dialog.getByRole('button', { name: '取消', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      const node = page.locator('.react-flow__node:has([data-generation-node-model-id="apimart-gpt-image-2"])').last()
      await node.getByRole('button', { name: /^(绘制|Draw)$/i }).click()
      await dialog.waitFor({ state: 'visible' })
      await context.settlePage(page, 700)
      await capture('parameter-cancel-reopen')
      await dialog.getByRole('button', { name: '完成', exact: true }).isDisabled().then(disabled => assert.equal(disabled, true, '取消后必须仍是原始空参数'))
      await dialog.getByRole('button', { name: /^矩形/ }).click()
      await draw([0.25, 0.25], [0.75, 0.75])
      await dialog.getByRole('button', { name: '完成', exact: true }).click()
      await dialog.waitFor({ state: 'hidden', timeout: 20000 })
      await node.getByRole('button', { name: /^(编辑|Edit)$/i }).click()
      await dialog.waitFor({ state: 'visible' })
      await context.settlePage(page, 700)
      await capture('parameter-confirm-reopen')
    },
    cleanup: async page => {
      const dialog = page.getByRole('dialog', { name: /绘制局部重绘遮罩|Draw Inpainting Mask/i })
      if (await dialog.isVisible()) await dialog.getByRole('button', { name: '取消', exact: true }).click()
    },
  }
}

module.exports = { createImageEditRegionHostsScene }
