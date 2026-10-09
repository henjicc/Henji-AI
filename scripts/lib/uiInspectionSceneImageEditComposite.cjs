/* eslint-disable @typescript-eslint/no-var-requires -- 正式 Electron 巡检使用 CommonJS 场景。 */
const assert = require('node:assert/strict')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { loadTypeScript } = require('../check-persistence-compat.cjs')

function createImageEditCompositeScene(context) {
  return {
    id: 'image-edit-composite-contract', surface: '画布', name: '图片编辑共同模型-填充、剪贴、组与局部滤镜', writesUserData: true,
    setup: async (page, _app, { capture }) => {
      // 夹具采用正式构造器，不在场景里维护第二份格式或默认字段。
      const factory = loadTypeScript('src/core/imageEdit/v3/documentFactory.ts')
      const { createImageEditSparseMaskReferenceV3 } = loadTypeScript('src/core/imageEdit/v3/layerTypes.ts')
      const document = factory.createImageEditDocumentV3({ width: 512, height: 384, documentId: 'reality-composite-contract' })
      const background = factory.createImageEditRasterLayerV3('background', '背景')
      const group = factory.createImageEditGroupLayerV3('group', '剪贴组合')
      group.opacity = .85
      const base = factory.createImageEditRasterLayerV3('base', '半透明基底 · 填充 65%')
      base.fillOpacity = .65
      base.opacity = .8
      base.mask = createImageEditSparseMaskReferenceV3('independent-mask')
      base.maskAttachment = { enabled: true, linked: false, density: .7, transform: [1, 0, 0, 1, 70, 0] }
      base.filters = [{ id: 'grade', operationType: 'adjustment', effectId: 'exposure', params: { stops: 1.5 }, enabled: true, opacity: .7, blendMode: 'normal', mask: createImageEditSparseMaskReferenceV3('filter-region', false, 0) }]
      const clipped = factory.createImageEditRasterLayerV3('clip', '剪贴纹理')
      clipped.clipping = true
      clipped.blendMode = 'screen'
      clipped.opacity = .55
      group.children = [base, clipped]
      document.layers = [background, group]
      const { projectId } = await context.seedAndOpenCanvasPanoramaProject(page)
      const nodeId = '__ui_composite_contract'
      const saved = await page.evaluate(async ({ projectId, nodeId, document }) => {
        const resources = []
        let first = null
        for (const layer of [document.layers[0], ...document.layers[1].children]) {
          const canvas = window.document.createElement('canvas')
          canvas.width = 512; canvas.height = 384
          const paint = canvas.getContext('2d')
          assertCanvas(paint)
          if (layer.id === 'background') { paint.fillStyle = 'rgb(28, 52, 76)'; paint.fillRect(0, 0, 512, 384) }
          else if (layer.id === 'base') { paint.fillStyle = 'rgba(220, 94, 66, .75)'; paint.beginPath(); paint.ellipse(255, 190, 180, 120, 0, 0, Math.PI * 2); paint.fill() }
          else { paint.fillStyle = 'rgba(62, 182, 210, .7)'; for (let x = 0; x < 512; x += 48) paint.fillRect(x, 0, 24, 384) }
          const managed = await window.henjiNative.imageEditorV3.ingestSource({ requestId: `composite-ingest-${crypto.randomUUID()}`, source: { kind: 'data-url', dataUrl: canvas.toDataURL('image/png') } })
          layer.source = { kind: 'resource', resourceId: managed.resource.resourceRef }
          resources.push(managed.resource.resourceRef)
          first ??= managed
        }
        const coverage = new Float32Array(512 * 384)
        for (let y = 0; y < 384; y++) for (let x = 0; x < 512; x++) coverage[y*512+x] = Math.max(0, Math.min(1, (x-220)/80))
        const masks = await window.henjiNative.imageEditorV3.persistBrushTiles({ requestId: `composite-mask-${crypto.randomUUID()}`,
          tiles: [{ tileKey: '0/0/0', tile: { storage: 'mask-float32', width: 512, height: 384, data: coverage.buffer } }] })
        const maskRef = masks.tiles[0].resource.resourceRef
        document.layers[1].children[0].filters[0].mask.tiles = { '0/0/0': maskRef }
        resources.push(maskRef)
        const saved = await window.henjiNative.imageEditorV3.saveDocument({ requestId: `composite-save-${crypto.randomUUID()}`, document, expectedRevision: 0, history: null, resourceRefs: resources, previewRef: null })
        const canvas = await window.henjiNative.testFixtures.readCanvas(projectId)
        canvas.nodes.push({ id: nodeId, type: 'layerStackResultNode', position: { x: 520, y: 80 }, data: { displayName: '共同合成验收', resultKind: 'layer-stack', isGenerating: false,
          imageUrl: first.mediaUrl, previewImageUrl: first.mediaUrl, aspectRatio: '4:3',
          imageEditSession: { kind: 'image-edit-v3', sourceUrl: first.mediaUrl, documentRef: saved.documentRef, revision: saved.revision, previewRef: saved.previewRef } } })
        await window.henjiNative.testFixtures.writeCanvas(projectId, { ...canvas, viewport: { x: 80, y: 100, zoom: .65 } })
        return saved
        function assertCanvas(value) { if (!value) throw new Error('共同合成夹具画布不可用') }
      }, { projectId, nodeId, document })
      assert.ok(saved.documentRef)
      await context.reopenCanvasProjectFromStorage(page, projectId)
      await page.locator(`[data-layer-stack-node-id="${nodeId}"]`).getByRole('button', { name: /^(编辑|Edit)$/i }).click()
      const editor = page.locator('[data-image-editor-v3]:visible').last()
      await editor.waitFor({ state: 'visible', timeout: 20000 })
      await page.waitForFunction(() => {
        const root = window.document.querySelector('[data-image-editor-v3]')
        const front = root?.querySelector('[data-presentation-front-surface]')
        return front instanceof HTMLCanvasElement && front.width > 0 && front.height > 0
          && Number(front.getAttribute('data-render-generation') ?? 0) > 0
      }, undefined, { timeout: 30000 }).catch(async error => {
        await capture('presentation-failed')
        throw error
      })
      await context.settlePage(page, 1200)
      await editor.getByRole('button', { name: /^(展开图层组|Expand layer group)$/ }).click()
      await context.settlePage(page, 300)
      assert.equal(await editor.locator('[role="treeitem"]').count(), 4, '背景、组和两个子图层均应可见')
      await capture('combined')
      const identity = await authorizeMcpConnection(page, { name: '图片共同模型验收', allowWrites: true })
      const client = await connectMcpClient(identity.config, '图片共同模型验收')
      try {
        const baseRef = { kind: 'image_edit.layer', id: 'v3:reality-composite-contract:base' }
        const clipRef = { kind: 'image_edit.layer', id: 'v3:reality-composite-contract:clip' }
        const filterRef = { kind: 'image_edit.layer_filter', id: 'v3:reality-composite-contract:base:grade' }
        const change = async (target, property, value, screenshot) => {
          const before = await callTool(client, 'read_application_entity', { ref: target, propertyIds: [property] })
          const generation = await editor.locator('[data-presentation-front-surface]').getAttribute('data-render-generation')
          const changed = await callTool(client, 'change_application_entities', operationEnvelope([before], {
            summary: screenshot, changes: [{ kind: 'set_properties', entityType: target.kind, target, properties: { [property]: value } }],
          }))
          assert.equal(changed.executionState, 'completed', JSON.stringify(changed))
          assert.equal(changed.verificationState, 'verified', JSON.stringify(changed))
          const after = await callTool(client, 'read_application_entity', { ref: target, propertyIds: [property] })
          assert.deepEqual(after.data.properties[property], value)
          await page.waitForFunction(previous => {
            const front = window.document.querySelector('[data-image-editor-v3] [data-presentation-front-surface]')
            return Number(front?.getAttribute('data-render-generation') ?? 0) > Number(previous)
          }, generation, { timeout: 30000 })
          await context.settlePage(page, 400)
          await capture(screenshot)
        }
        await change(clipRef, 'image_edit.layer.clipping', false, 'clipping-off')
        await change(clipRef, 'image_edit.layer.clipping', true, 'clipping-on')
        await change(baseRef, 'image_edit.layer.fill_opacity', 1, 'fill-full')
        await change(baseRef, 'image_edit.layer.fill_opacity', .65, 'fill-65')
        await change(filterRef, 'image_edit.layer_filter.enabled', false, 'filter-off')
        await change(filterRef, 'image_edit.layer_filter.enabled', true, 'filter-on')
      } finally { await client.close(); await disableMcp(page) }
      assert.equal(await editor.locator('[data-command-bar-actions]').count(), 1, '只能存在一条顶部命令区')
      assert.equal(await editor.locator('nav').count(), 1, '只能存在一条左侧工具区')
      await editor.getByRole('button', { name: '面板', exact: true }).click()
      await page.getByRole('menuitem', { name: '关闭属性面板', exact: true }).click()
      await context.settlePage(page, 400)
      await capture('properties-closed')
      await editor.getByRole('button', { name: '面板', exact: true }).click()
      await page.getByRole('menuitem', { name: '恢复默认布局', exact: true }).click()
      await context.settlePage(page, 400)
      await capture('restored')
    },
  }
}

module.exports = { createImageEditCompositeScene }
