/* eslint-disable @typescript-eslint/no-var-requires -- 正式 Electron 场景沿仓内 CommonJS 工厂注册。 */
const assert = require('node:assert/strict')
const path = require('node:path')
const { loadTypeScript } = require('../check-persistence-compat.cjs')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')

function createImageEditLayerPanelsScene(context) {
  return {
    id: 'image-edit-layer-panels', surface: '图片编辑', name: '图层与通道-密集树、剪贴跨组、蒙版目标与持久区域', writesUserData: true,
    launchArgs: ['--dev-surface=tool.image_edit', '--dev-media=tests/fixtures/image-inpainting/face-scratch-source.png'],
    setup: async (page, app, { capture }) => {
      const restorePaid = await blockPaidGeneration(app)
      let client = null
      const host = () => page.locator('[data-image-editor-v3]:visible').last()
      const tab = async id => {
        await host().locator(`[data-dock-tab="${id}"] > span`).first().click()
        await context.settlePage(page, 200)
      }
      const shoot = async name => {
        assert.equal(await host().locator('[data-command-bar]').count(), 1)
        assert.ok(await host().locator('[data-context-bar]').count() <= 1)
        await context.settlePage(page, 600)
        await capture(name)
      }
      try {
        await host().waitFor({ timeout: 30000 })
        await tab('channels')
        await host().getByText('还没有选区通道', { exact: true }).waitFor()
        await shoot('toolbox-channels-empty')
        const factory = loadTypeScript('src/core/imageEdit/v3/documentFactory.ts')
        const { createImageEditSparseMaskReferenceV3 } = loadTypeScript('src/core/imageEdit/v3/layerTypes.ts')
        const document = factory.createImageEditDocumentV3({ width: 512, height: 384, documentId: 'reality-layer-panels' })
        const source = factory.createImageEditRasterLayerV3('source', '人像底图')
        const base = factory.createImageEditRasterLayerV3('base', '剪贴基底')
        base.mask = createImageEditSparseMaskReferenceV3('base-mask')
        base.maskAttachment.density = .75
        const clip = factory.createImageEditRasterLayerV3('clip', '剪贴纹理'); clip.clipping = true; clip.fillOpacity = .65; clip.opacity = .8
        const group = factory.createImageEditGroupLayerV3('original', '原组合'); group.children = [base, clip]
        const dense = factory.createImageEditGroupLayerV3('dense', '密集层树')
        dense.children = Array.from({ length: 270 }, (_, index) => ({ ...factory.createImageEditRasterLayerV3(`dense-${index}`, `参考图层 ${index + 1}`), visible: false }))
        const locked = factory.createImageEditGroupLayerV3('locked', '锁定组'); locked.locked = true
        const target = factory.createImageEditGroupLayerV3('target', '目标组合')
        document.layers = [source, dense, group, locked, target]
        const { projectId } = await context.seedAndOpenCanvasPanoramaProject(page)
        const nodeId = '__ui_layer_panels'
        const documentRef = await page.evaluate(async ({ document, projectId, nodeId, filePath }) => {
          const managed = await window.henjiNative.imageEditorV3.ingestSource({ requestId: `layers-ingest-${crypto.randomUUID()}`, source: { kind: 'local-path', filePath } })
          document.geometry.width = managed.metadata.width; document.geometry.height = managed.metadata.height
          for (const layer of [document.layers[0], ...document.layers[2].children]) layer.source = { kind: 'resource', resourceId: managed.resource.resourceRef }
          const saved = await window.henjiNative.imageEditorV3.saveDocument({ requestId: `layers-save-${crypto.randomUUID()}`, document, expectedRevision: 0, history: null, resourceRefs: [managed.resource.resourceRef], previewRef: null })
          const canvas = await window.henjiNative.testFixtures.readCanvas(projectId)
          canvas.nodes.push({ id: nodeId, type: 'layerStackResultNode', position: { x: 520, y: 80 }, data: { displayName: '图层通道验收', resultKind: 'layer-stack', isGenerating: false,
            imageUrl: managed.mediaUrl, previewImageUrl: managed.mediaUrl, aspectRatio: '4:3',
            imageEditSession: { kind: 'image-edit-v3', sourceUrl: managed.mediaUrl, documentRef: saved.documentRef, revision: saved.revision, previewRef: null } } })
          await window.henjiNative.testFixtures.writeCanvas(projectId, { ...canvas, viewport: { x: 80, y: 100, zoom: .65 } })
          return saved.documentRef
        }, { document, projectId, nodeId, filePath: path.resolve('tests/fixtures/image-inpainting/face-scratch-source.png') })
        await context.reopenCanvasProjectFromStorage(page, projectId)
        const open = async () => {
          await page.locator(`[data-layer-stack-node-id="${nodeId}"]`).getByRole('button', { name: /^(编辑|Edit)$/i }).click()
          await host().waitFor({ timeout: 30000 }); await tab('layers')
        }
        await open()
        await host().locator('[data-layer-id="dense"]').getByRole('button', { name: '展开图层组', exact: true }).click()
        assert.ok(await host().locator('[role="treeitem"]').count() < 100, '密集树应虚拟化')
        await shoot('dense-tree')
        await host().locator('[data-layer-id="dense"]').getByRole('button', { name: '折叠图层组', exact: true }).click()
        await host().locator('[data-layer-id="original"]').getByRole('button', { name: '展开图层组', exact: true }).click()
        const identity = await authorizeMcpConnection(page, { name: '图层通道验收', allowWrites: true })
        client = await connectMcpClient(identity.config, '图层通道验收')
        const ref = { kind: 'image_edit.document', id: 'v3:reality-layer-panels' }
        const read = async ids => (await callTool(client, 'read_application_entity', { ref, propertyIds: ids })).data.properties
        await host().locator('[data-layer-id="base"] [data-layer-mask-target]').click()
        await tab('properties')
        await host().getByRole('slider', { name: '蒙版密度滑杆', exact: true }).waitFor()
        await host().getByRole('switch', { name: '链接图层与蒙版', exact: true }).click()
        await shoot('mask-target-unlinked')
        await host().locator('[data-properties-tab-panel]').evaluate(element => { element.scrollTop = element.scrollHeight })
        await shoot('mask-transform-properties')
        await host().locator('[data-properties-tab-panel]').evaluate(element => { element.scrollTop = 0 })
        await tab('layers')
        await host().locator('[data-layer-id="clip"] [data-layer-select]').click()
        await tab('properties'); await host().getByRole('tab', { name: '基础', exact: true }).click()
        await host().getByRole('slider', { name: '填充滑杆', exact: true }).waitFor()
        await shoot('pixel-fill-clipping')
        await host().locator('[data-properties-tab-panel]').evaluate(element => { element.scrollTop = element.scrollHeight })
        await shoot('fill-clipping-properties')
        await host().locator('[data-properties-tab-panel]').evaluate(element => { element.scrollTop = 0 })
        await tab('layers')
        await host().locator('[data-layer-id="base"] [data-layer-select]').click()
        await host().locator('[data-layer-id="clip"] [data-layer-select]').click({ modifiers: ['Control'] })
        await host().locator('[data-layer-id="clip"] [data-layer-select]').hover()
        await shoot('multi-selection-hover')
        const before = await read(['image_edit.document.history_length'])
        const from = await host().locator('[data-layer-id="clip"] [data-layer-select]').boundingBox()
        const to = await host().locator('[data-layer-id="target"] [data-layer-select]').boundingBox()
        assert.ok(from && to)
        await page.mouse.move(from.x + from.width * .5, from.y + from.height * .5); await page.mouse.down()
        await page.mouse.move(to.x + to.width * .5, to.y + to.height * .5, { steps: 20 }); await page.mouse.up()
        await context.settlePage(page, 800)
        const positions = (await read(['image_edit.document.layer_order']))['image_edit.document.layer_order']
        assert.equal(positions.find(entry => entry.layerId === 'base').parentId, 'target')
        assert.equal(positions.find(entry => entry.layerId === 'clip').index, 1)
        assert.equal((await read(['image_edit.document.history_length']))['image_edit.document.history_length'], before['image_edit.document.history_length'] + 1)
        assert.equal(await host().locator('[role="treeitem"][aria-selected="true"]').count(), 2, '拖动结束必须保留多选')
        await shoot('multi-drag-into-group')
        await host().locator('[data-layer-id="base"] [data-layer-select]').click()
        await host().getByRole('button', { name: '上移图层', exact: true }).click()
        await host().getByText('剪贴层需要同组下方的内容基底', { exact: true }).waitFor()
        await shoot('invalid-clipping-error')
        // 成功移动整个剪贴链清除错误；领域状态仍由同一公共命令验证。
        await host().locator('[data-layer-id="target"] [data-layer-select]').click()
        await host().getByRole('button', { name: '下移图层', exact: true }).click()
        const selectionRef = { ...ref, kind: 'image_edit.selection' }
        const baseline = await callTool(client, 'read_application_entity', { ref: selectionRef, propertyIds: ['image_edit.selection.region'] })
        const selection = { operations: [{ combine: 'replace', invertBefore: false, shape: { type: 'ellipse', x: .25, y: .15, width: .5, height: .7 } }], feather: .01, inverted: false }
        const changed = await callTool(client, 'change_application_entities', operationEnvelope([baseline], { summary: '参考帧人像区域', changes: [{ kind: 'set_properties', entityType: selectionRef.kind, target: selectionRef, properties: { 'image_edit.selection.region': selection } }] }))
        assert.equal(changed.executionState, 'completed', JSON.stringify(changed))
        await tab('channels')
        await host().getByRole('button', { name: '保存选区为通道', exact: true }).click()
        const name = host().getByRole('textbox', { name: '通道名称', exact: true })
        await name.fill('人像柔边区域'); await name.press('Enter')
        await host().getByRole('button', { name: '载入通道选区', exact: true }).click()
        assert.equal((await read(['image_edit.document.named_regions']))['image_edit.document.named_regions'][0].name, '人像柔边区域')
        await shoot('channel-saved-loaded')
        await host().getByRole('button', { name: '关闭通道面板', exact: true }).click()
        await host().getByRole('button', { name: '面板', exact: true }).click()
        await page.getByRole('menuitem', { name: '显示通道面板', exact: true }).click()
        await host().getByText('人像柔边区域', { exact: true }).waitFor()
        await shoot('channel-panel-reopened')
        await page.getByRole('dialog', { name: /多图层图片编辑器|Multi-layer image editor/i }).getByRole('button', { name: /关闭编辑器|Close editor/i }).click()
        const persisted = await page.evaluate(async documentRef => window.henjiNative.imageEditorV3.loadDocument({ requestId: `channel-check-${crypto.randomUUID()}`, documentRef }), documentRef)
        assert.equal(persisted.document.namedRegions[0].name, '人像柔边区域')
        await page.reload({ waitUntil: 'domcontentloaded' }); await context.reopenCanvasProjectFromStorage(page, projectId); await open(); await tab('channels')
        await host().getByText('人像柔边区域', { exact: true }).waitFor()
        await shoot('channel-document-reopened')
      } finally {
        if (client) await client.close()
        await disableMcp(page); await restorePaid()
      }
    },
  }
}
module.exports = { createImageEditLayerPanelsScene }
