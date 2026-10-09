/* eslint-disable @typescript-eslint/no-var-requires -- 正式 Electron 截图场景使用现有 CommonJS 巡检入口。 */
const assert = require('node:assert/strict')
const { WHITE_HEX, BLACK_HEX } = require('../../src/core/theme/colorTokens.ts')
const { createGpuBrushScenes } = require('./uiInspectionSceneCatalogGpuBrush.cjs')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')

function createImageEditPaintTargetsScene(context) {
  return {
    id: 'image-edit-paint-targets', surface: '图片编辑', name: '绘画-像素、蒙版、流量、渐变、填充与取消', writesUserData: true,
    expectedLogEvents: ['image_edit.paint.fill.failed'],
    launchArgs: ['--dev-surface=tool.image_edit', '--dev-media=tests/fixtures/image-inpainting/face-scratch-source.png'],
    setup: async (page, app, { capture }) => {
      const restore = await blockPaidGeneration(app)
      try {
        const host = page.locator('[data-image-editor-v3]:visible').last()
        await host.waitFor({ timeout: 30000 })
        const shoot = async name => { await context.settlePage(page, 800); await capture(name) }
        const choose = async name => {
          const ids = { '栅格画笔': 'raster-brush', '橡皮擦': 'eraser', '渐变': 'paint-gradient', '区域填充': 'paint-fill' }
          await host.locator(`[data-tool-id="${ids[name]}"]`).click()
        }
        const draw = async (from, to, cancel = false) => {
          const area = host.locator('[data-raster-brush-overlay], [data-paint-fill-overlay]').last()
          const box = await area.boundingBox(); assert.ok(box)
          const before = Number(await host.locator('[data-command-bar]').getAttribute('data-document-revision'))
          await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]); await page.mouse.down()
          await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 24 })
          if (cancel) await page.keyboard.press('Escape')
          await page.mouse.up()
          if (cancel) { await context.settlePage(page, 400); assert.equal(Number(await host.locator('[data-command-bar]').getAttribute('data-document-revision')), before) }
          else await page.waitForFunction(revision => Number(document.querySelector('[data-image-editor-v3] [data-command-bar]')?.getAttribute('data-document-revision')) === revision + 1, before, { timeout: 30000 })
        }
        await choose('栅格画笔')
        const value = async (name, number) => { const input = host.getByRole('spinbutton', { name, exact: true }); await input.fill(String(number)); await input.press('Enter') }
        await host.getByLabel('绘画颜色', { exact: true }).evaluate((element, color) => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, color)
          element.dispatchEvent(new Event('input', { bubbles: true }))
          element.dispatchEvent(new Event('change', { bubbles: true }))
        }, WHITE_HEX)
        await value('大小', 80); await value('整笔透明度', 50); await value('流量', 20)
        await host.getByRole('button', { name: '笔尖设置', exact: true }).click()
        await page.locator('[data-paint-brush-settings]').waitFor()
        await shoot('tip-pressure-flow-settings')
        await page.getByRole('switch', { name: '倾角控制笔尖', exact: true }).scrollIntoViewIfNeeded()
        await shoot('pressure-curve-settings')
        await page.keyboard.press('Escape')
        await draw([.15, .3], [.85, .3]); await shoot('pixel-opacity-flow')
        await host.getByRole('button', { name: '撤销', exact: true }).click(); await shoot('pixel-undo')
        await host.getByRole('button', { name: '重做', exact: true }).click()
        await choose('橡皮擦'); await draw([.3, .28], [.7, .32]); await shoot('pixel-eraser')
        await host.getByRole('button', { name: '添加蒙版', exact: true }).click()
        await host.getByRole('button', { name: '编辑蒙版', exact: true }).click()
        await value('蒙版覆盖', 70)
        await draw([.25, .5], [.75, .55]); await shoot('same-brush-mask')
        await choose('渐变'); await draw([.2, .4], [.8, .7], true); await shoot('gradient-cancelled')
        await draw([.2, .4], [.8, .7]); await shoot('mask-linear-gradient')
        await choose('区域填充'); await draw([.5, .5], [.5, .5]); await shoot('mask-fill')
        await host.getByRole('button', { name: '蒙版', exact: true }).first().click()
        await page.getByRole('option', { name: '像素', exact: true }).click()
        await choose('渐变')
        await host.getByLabel('终点颜色', { exact: true }).evaluate((element, color) => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, color)
          element.dispatchEvent(new Event('input', { bubbles: true }))
          element.dispatchEvent(new Event('change', { bubbles: true }))
        }, BLACK_HEX)
        await draw([.15, .2], [.85, .8]); await shoot('pixel-linear-gradient')
        await host.getByRole('button', { name: '线性', exact: true }).click()
        await page.getByRole('option', { name: '径向', exact: true }).click()
        await draw([.5, .5], [.8, .5]); await shoot('pixel-radial-gradient')
        await choose('区域填充')
        await page.evaluate(() => {
          window.__paintScenePost = Worker.prototype.postMessage
          Worker.prototype.postMessage = function (message, ...args) {
            if (message.kind === 'fill') { queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: { error: '绘画场景计算失败替身' } }))); return }
            return window.__paintScenePost.call(this, message, ...args)
          }
        })
        try {
          await host.locator('[data-paint-fill-overlay]').click()
          await host.getByText('绘画场景计算失败替身', { exact: true }).waitFor()
          await shoot('fill-failed-recoverable')
        } finally { await page.evaluate(() => { Worker.prototype.postMessage = window.__paintScenePost; delete window.__paintScenePost }) }
        await draw([.5, .5], [.5, .5]); await shoot('pixel-fill-recovered')
      } finally { await restore() }
    },
  }
}

function createImageEditPaintParameterScene(context) {
  return {
    id: 'image-edit-paint-parameter-mask', surface: '画布', name: '共享绘画-参数蒙版软笔与橡皮', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const restore = await blockPaidGeneration(app)
      try {
        await context.setupCanvasGptMaskEditor(page)
        const dialog = page.getByRole('dialog', { name: /绘制局部重绘遮罩|Draw Inpainting Mask/i })
        const draw = async (from, to) => {
          const box = await dialog.locator('[data-application-observation-region="mask_editor.canvas"] canvas').first().boundingBox(); assert.ok(box)
          await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]); await page.mouse.down()
          await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 20 }); await page.mouse.up()
          await context.settlePage(page, 800)
        }
        await capture('parameter-empty')
        await dialog.getByRole('button', { name: /^画笔/ }).click()
        const hardness = dialog.getByRole('slider', { name: '画笔硬度' }); await hardness.press('Home')
        for (let i = 0; i < 30; i++) await hardness.press('ArrowRight')
        await draw([.2, .3], [.8, .7]); await capture('parameter-shared-soft-brush')
        await dialog.getByRole('button', { name: '擦除', exact: true }).click()
        await draw([.3, .5], [.7, .5]); await capture('parameter-shared-eraser')
        await dialog.getByRole('button', { name: '取消', exact: true }).click()
      } finally { await restore() }
    },
  }
}
function createImageEditPaintCrossTilesScene(context) {
  const existing = createGpuBrushScenes(context)[0]
  return { ...existing, id: 'image-edit-paint-cross-tiles', name: '共享绘画-1200像素跨瓦片合成与撤销重做' }
}
module.exports = { createImageEditPaintTargetsScene, createImageEditPaintParameterScene, createImageEditPaintCrossTilesScene }
