/* eslint-disable @typescript-eslint/no-var-requires -- 正式 Electron 场景复用 CommonJS 巡检工厂。 */
const assert = require('node:assert/strict')
const path = require('node:path')
const { loadTypeScript } = require('../check-persistence-compat.cjs')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')

function createImageEditFilterScopesScene(context, { injectSelectionFailure = false } = {}) {
  return {
    id: 'image-edit-filter-scopes', surface: '图片编辑', name: '调整库与双挂载、局部滤镜蒙版、组级停靠', writesUserData: true,
    ...(injectSelectionFailure ? { expectedLogEvents: ['image_edit.selection.materialize.failed', 'image_edit.filter.add.failed'] } : {}),
    launchArgs: ['--dev-surface=tool.image_edit', '--dev-media=tests/fixtures/image-inpainting/face-scratch-source.png'],
    setup: async (page, app, { capture }) => {
      const restorePaid = await blockPaidGeneration(app)
      const host = () => page.locator('[data-image-editor-v3]:visible').last()
      const tab = async id => { await host().locator(`[data-dock-tab="${id}"] > span`).first().click(); await context.settlePage(page, 200) }
      const shoot = async name => {
        await context.settlePage(page, 700)
        assert.equal(await host().locator('[data-command-bar]').count(), 1, '命令带不得重复')
        assert.ok(await host().locator('[data-context-bar]').count() <= 1)
        await capture(name)
      }
      const add = async name => {
        await host().getByRole('button', { name: '添加滤镜或调整', exact: true }).click()
        await page.getByRole('menuitem', { name, exact: true }).click()
        await context.settlePage(page, 900)
      }
      let client = null
      try {
        await host().waitFor({ timeout: 30000 })
        await tab('adjustments')
        await shoot('toolbox-filter-empty')
        await host().getByRole('button', { name: '添加滤镜或调整', exact: true }).click()
        await shoot('shared-adjustment-filter-menu')
        await page.keyboard.press('Escape')
        await add('曝光')
        await host().locator('[data-filter-parameters]').waitFor()
        const slider = host().locator('[data-filter-parameters]').getByRole('slider').first()
        await slider.scrollIntoViewIfNeeded()
        await shoot('content-filter-parameters')
        const initialParameter = await slider.inputValue()
        const bounds = await slider.boundingBox(); assert.ok(bounds)
        const revision = await host().locator('[data-document-revision]').getAttribute('data-document-revision')
        await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height * .5); await page.mouse.down()
        await page.mouse.move(bounds.x + bounds.width * .8, bounds.y + bounds.height * .5, { steps: 6 })
        await shoot('content-filter-live-preview')
        assert.notEqual(await slider.inputValue(), initialParameter, '必须实际命中参数拖动，不能在视口外模拟手势')
        assert.equal(await host().locator('[data-document-revision]').getAttribute('data-document-revision'), revision, '拖动预览不得写历史')
        await page.mouse.up()
        await host().locator('[data-filter-row]').last().getByRole('button', { name: '滤镜操作', exact: true }).click()
        await page.getByRole('menuitem', { name: '转为滤镜图层', exact: true }).click()
        const confirm = page.getByRole('dialog', { name: '转换滤镜作用范围', exact: true })
        await confirm.waitFor(); await shoot('conversion-confirm-content-to-composite')
        await confirm.getByRole('button', { name: '确认转换', exact: true }).click()
        await host().getByRole('button', { name: '转为下方图层滤镜', exact: true }).click()
        await confirm.waitFor(); await shoot('conversion-confirm-composite-to-content')
        await confirm.getByRole('button', { name: '确认转换', exact: true }).click()
        await shoot('conversion-content-restored')
        await add('曲线')
        assert.equal(await host().locator('[data-filter-row]').count(), 2)
        await host().locator('[data-filter-row]').last().getByRole('button', { name: '滤镜操作', exact: true }).click()
        await page.getByRole('menuitem', { name: '提前执行', exact: true }).click()
        await host().locator('[data-filter-row]').first().getByRole('switch').click()
        await shoot('ordered-disabled-filters')
        await host().getByRole('button', { name: '关闭调整与滤镜面板', exact: true }).click()
        await host().getByRole('button', { name: '面板', exact: true }).click()
        await page.getByRole('menuitem', { name: '显示调整与滤镜面板', exact: true }).click()
        await host().locator('[data-filter-row]').first().waitFor()
        await shoot('filter-panel-reopened')

        const factory = loadTypeScript('src/core/imageEdit/v3/documentFactory.ts')
        const document = factory.createImageEditDocumentV3({ width: 512, height: 384, documentId: 'reality-filter-scopes' })
        const base = factory.createImageEditRasterLayerV3('base', '局部滤镜底图')
        const other = factory.createImageEditRasterLayerV3('other', '下方参考层'); other.visible = false; other.locked = true
        document.layers = [other, base]
        const { projectId } = await context.seedAndOpenCanvasPanoramaProject(page)
        const nodeId = '__ui_filter_scopes'
        const documentRef = await page.evaluate(async ({ document, projectId, nodeId, filePath }) => {
          const managed = await window.henjiNative.imageEditorV3.ingestSource({ requestId: `filter-ingest-${crypto.randomUUID()}`, source: { kind: 'local-path', filePath } })
          document.geometry.width = managed.metadata.width; document.geometry.height = managed.metadata.height
          for (const layer of document.layers) layer.source = { kind: 'resource', resourceId: managed.resource.resourceRef }
          const saved = await window.henjiNative.imageEditorV3.saveDocument({ requestId: `filter-save-${crypto.randomUUID()}`, document, expectedRevision: 0, history: null, resourceRefs: [managed.resource.resourceRef], previewRef: null })
          const canvas = await window.henjiNative.testFixtures.readCanvas(projectId)
          canvas.nodes.push({ id: nodeId, type: 'layerStackResultNode', position: { x: 520, y: 80 }, data: { displayName: '局部滤镜验收', resultKind: 'layer-stack', isGenerating: false,
            imageUrl: managed.mediaUrl, previewImageUrl: managed.mediaUrl, aspectRatio: '4:3',
            imageEditSession: { kind: 'image-edit-v3', sourceUrl: managed.mediaUrl, documentRef: saved.documentRef, revision: saved.revision, previewRef: null } } })
          await window.henjiNative.testFixtures.writeCanvas(projectId, { ...canvas, viewport: { x: 80, y: 100, zoom: .65 } })
          return saved.documentRef
        }, { document, projectId, nodeId, filePath: path.resolve('tests/fixtures/image-inpainting/face-scratch-source.png') })
        await context.reopenCanvasProjectFromStorage(page, projectId)
        await page.locator(`[data-layer-stack-node-id="${nodeId}"]`).getByRole('button', { name: /^(编辑|Edit)$/i }).click()
        await host().waitFor({ timeout: 30000 }); await tab('layers')
        await host().locator('[data-layer-id="base"] [data-layer-select]').click()
        const modal = page.getByRole('dialog', { name: /多图层图片编辑器|Multi-layer image editor/i })
        const geometry = await host().boundingBox(), modalGeometry = await modal.boundingBox()
        assert.ok(geometry.height >= modalGeometry.height - 125, '工作区应铺满弹窗的剩余高度')
        assert.equal(await host().locator('[data-dock-tab]').getByRole('button').count(), 2, '每组仅当前标签显示关闭')
        await host().getByRole('button', { name: '更多图层操作', exact: true }).click()
        await shoot('canvas-height-layer-toolbar')
        await page.keyboard.press('Escape')
        const identity = await authorizeMcpConnection(page, { name: '局部滤镜验收', allowWrites: true, allowDestructive: true })
        client = await connectMcpClient(identity.config, '局部滤镜验收')
        const ref = { kind: 'image_edit.document', id: 'v3:reality-filter-scopes' }
        const selectionRef = { ...ref, kind: 'image_edit.selection' }
        const baseline = await callTool(client, 'read_application_entity', { ref: selectionRef, propertyIds: ['image_edit.selection.region'] })
        const selection = { operations: [{ combine: 'replace', invertBefore: false, shape: { type: 'ellipse', x: .25, y: .15, width: .5, height: .7 } }], feather: .01, inverted: false }
        const changed = await callTool(client, 'change_application_entities', operationEnvelope([baseline], { summary: '局部滤镜参考区域', changes: [{ kind: 'set_properties', entityType: selectionRef.kind, target: selectionRef, properties: { 'image_edit.selection.region': selection } }] }))
        assert.equal(changed.executionState, 'completed', JSON.stringify(changed))
        await tab('adjustments')
        if (injectSelectionFailure) {
        // 只替换选区 Worker 的失败边界，恢复后仍走正式资源持久化与滤镜提交。
        await page.evaluate(() => {
          window.__filterScopePostMessage = Worker.prototype.postMessage
          Worker.prototype.postMessage = function (message, ...rest) {
            if (message.selection && message.region && message.size && message.matrix) {
              queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: { error: '选区无法应用，请重新尝试' } })))
              return
            }
            return window.__filterScopePostMessage.call(this, message, ...rest)
          }
        })
        try {
          await add('曝光')
          await host().getByText('选区无法应用，请重新尝试', { exact: true }).waitFor()
          await shoot('selection-filter-error')
        } finally {
          await page.evaluate(() => { Worker.prototype.postMessage = window.__filterScopePostMessage; delete window.__filterScopePostMessage })
        }
        await host().getByRole('button', { name: '关闭提示', exact: true }).click()
        }
        await add('曝光')
        await host().getByRole('button', { name: '移除滤镜蒙版', exact: true }).waitFor()
        await host().locator('[data-filter-parameters]').getByRole('slider').first().press('End')
        await shoot('selection-filter-mask')
        await add('高斯模糊')
        const blurScale = host().locator('[data-filter-parameters]').getByRole('spinbutton', { name: '模糊尺度', exact: true })
        await blurScale.fill('0.02')
        await blurScale.press('Enter')
        await shoot('local-spatial-filter')
        const layerRef = { kind: 'image_edit.layer', id: 'v3:reality-filter-scopes:base' }
        const selectionBefore = await callTool(client, 'read_application_entity', { ref: selectionRef })
        const layerBefore = await callTool(client, 'read_application_entity', { ref: layerRef })
        const computed = await callTool(client, 'compute_image_edit_selection', operationEnvelope([selectionBefore, layerBefore], {
          targetRef: layerRef, operation: { kind: 'modify', mode: 'feather', radiusRatio: .005 }, combine: 'replace' }))
        assert.equal(computed.executionState, 'completed', JSON.stringify(computed))
        const filterId = await host().locator('[data-filter-row]').last().getAttribute('data-filter-row')
        const filterRef = { kind: 'image_edit.layer_filter', id: `v3:reality-filter-scopes:base:${encodeURIComponent(filterId)}` }
        const filterBefore = await callTool(client, 'read_application_entity', { ref: filterRef })
        const currentSelection = await callTool(client, 'read_application_entity', { ref: selectionRef })
        const applied = await callTool(client, 'apply_image_edit_selection', operationEnvelope([filterBefore, currentSelection], { targetRef: filterRef, action: 'mask' }))
        assert.equal(applied.executionState, 'completed', JSON.stringify(applied))
        await shoot('assistant-selection-filter-snapshot')
        await host().locator('[data-filter-row]').last().getByRole('button', { name: '滤镜操作', exact: true }).click()
        await page.getByRole('menuitem', { name: '转为滤镜图层', exact: true }).click()
        const scopeConfirm = page.getByRole('dialog', { name: '转换滤镜作用范围', exact: true })
        await scopeConfirm.waitFor(); await shoot('canvas-conversion-expanded-scope')
        await scopeConfirm.getByRole('button', { name: '确认转换', exact: true }).click()
        await host().getByRole('button', { name: '转为下方图层滤镜', exact: true }).click()
        await scopeConfirm.waitFor(); await shoot('canvas-conversion-restricted-scope')
        await scopeConfirm.getByRole('button', { name: '确认转换', exact: true }).click()
        await host().getByRole('button', { name: '滤镜作用范围', exact: true }).click()
        await page.getByRole('option', { name: '下方合成', exact: true }).click()
        await add('曲线')
        await tab('layers'); await shoot('below-composite-adjustment-layer')
        await tab('adjustments'); await shoot('below-composite-parameters')
        const groupButton = host().getByRole('button', { name: '收起调整与滤镜', exact: true })
        await groupButton.click(); await shoot('group-collapsed')
        await tab('layers'); await shoot('group-collapsed-switched-tab')
        await host().getByRole('button', { name: '展开图层', exact: true }).click()
        await tab('layers'); await host().locator('[data-layer-id="base"] [data-layer-select]').click()
        await tab('adjustments')
        await host().getByRole('button', { name: '关闭调整与滤镜面板', exact: true }).click()
        await host().getByRole('button', { name: '面板', exact: true }).click()
        await page.getByRole('menuitem', { name: '显示调整与滤镜面板', exact: true }).click()
        await shoot('canvas-filter-reopened')
        await tab('layers'); await host().locator('[data-layer-id="other"] [data-layer-select]').click(); await tab('adjustments')
        assert.equal(await host().getByRole('button', { name: '添加滤镜或调整', exact: true }).isDisabled(), true)
        await shoot('locked-filter-target')
        await modal.getByRole('button', { name: /关闭编辑器|Close editor/i }).click()
        await modal.waitFor({ state: 'hidden', timeout: 30000 })
        await context.settlePage(page, 800)
        const persisted = await page.evaluate(documentRef => window.henjiNative.imageEditorV3.loadDocument({ requestId: `filter-check-${crypto.randomUUID()}`, documentRef }), documentRef)
        const filters = persisted.document.layers.find(layer => layer.id === 'base').filters
        assert.equal(filters.length, 2)
        assert.equal(filters.find(filter => filter.effectId === 'gaussian_blur').params.sigma_fraction_height, 0.02, '快输入完成值必须保存，而非只停留在控件草稿')
        assert.ok(filters.every(filter => filter.mask), '局部滤镜蒙版必须持久化')
        assert.equal(persisted.document.layers.filter(layer => layer.type === 'adjustment').length, 1)
      } finally { if (client) await client.close(); await disableMcp(page); await restorePaid() }
    },
  }
}
function createImageEditFilterFailureScene(context) {
  return { ...createImageEditFilterScopesScene(context, { injectSelectionFailure: true }),
    id: 'image-edit-filter-failure', name: '局部滤镜失败恢复与日志核对' }
}
module.exports = { createImageEditFilterScopesScene, createImageEditFilterFailureScene }
