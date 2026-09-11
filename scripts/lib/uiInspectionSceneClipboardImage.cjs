const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs/promises')

function createClipboardImageScene(context) {
  return {
    id: 'clipboard-image', surface: '剪贴板', name: '剪贴板-原图复制与读取', writesUserData: true,
    async setup(page, app) {
      const originalSource = process.env.HENJI_CLIPBOARD_TEST_IMAGE || path.resolve('resources/icons/icon.png')
      const sharp = require('sharp')
      const bytes = await fs.readFile(originalSource)
      const metadata = await sharp(bytes).metadata()
      // 通过正式导入入口把同一原图放进隔离资料目录，遵守媒体协议访问边界。
      const source = await page.evaluate(async ({ data, extension }) => (
        window.henjiNative.image.persistImageBinary(new Uint8Array(data), extension)
      ), { data: [...bytes], extension: path.extname(originalSource).slice(1) })
      console.log('[clipboard-image] source', JSON.stringify({ width: metadata.width, height: metadata.height }))
      for (const method of ['writeImageFromSource', 'writeImageFromPath']) {
        console.log(`[clipboard-image] ${method} start`)
        const startedAt = Date.now()
        await page.evaluate(async ({ source, method }) => {
          await window.henjiNative.clipboard[method](source)
        }, { source, method })
        const result = await app.evaluate(({ clipboard }) => {
          const image = clipboard.readImage()
          return { empty: image.isEmpty(), size: image.getSize() }
        })
        assert.equal(result.empty, false)
        assert.deepEqual(result.size, { width: metadata.width, height: metadata.height })
        console.log(`[clipboard-image] ${method} completed`, JSON.stringify({ ...result, durationMs: Date.now() - startedAt }))
      }
      await context.setupCanvas(page)
      if (await page.locator('.react-flow').count()) {
        await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
      }
      const projectId = context.canvasFixtureProjectId
      const nodeId = '__clipboard_image_regression__'
      await page.evaluate(async ({ projectId, nodeId, source }) => {
        const node = { id: nodeId, type: 'exportImageNode', position: { x: 180, y: 180 },
          width: 360, height: 270, style: { width: 360, height: 270 },
          data: { displayName: '图片复制验证', imageUrl: source, previewImageUrl: source, aspectRatio: '4:3', resultKind: 'image' } }
        await window.henjiNative.db.execute(
          'UPDATE storyboard_projects SET nodes_json = ?, edges_json = ?, history_json = ?, viewport_json = ?, node_count = ? WHERE id = ?',
          [JSON.stringify([node]), '[]', JSON.stringify({ past: [], future: [], imagePool: [] }), JSON.stringify({ x: 0, y: 0, zoom: 1 }), 1, projectId],
        )
      }, { projectId, nodeId, source })
      await page.locator(`[data-project-id="${projectId}"]`).click()
      await page.locator(`.react-flow__node[data-id="${nodeId}"]`).click()
      await app.evaluate(({ clipboard }) => clipboard.clear())
      console.log('[clipboard-image] canvas copy button start')
      await page.getByRole('button', { name: /^(复制|Copy)$/i }).click()
      await page.getByRole('button', { name: /复制成功|已复制|Copied|Copy successful/i }).waitFor({ timeout: 10000 })
      const copiedSize = await app.evaluate(({ clipboard }) => clipboard.readImage().getSize())
      assert.deepEqual(copiedSize, { width: metadata.width, height: metadata.height })
      console.log('[clipboard-image] canvas copy button completed', JSON.stringify(copiedSize))
    },
  }
}

module.exports = { createClipboardImageScene }
