/* eslint-disable @typescript-eslint/no-var-requires -- 正式 Electron 巡检目录使用 CommonJS 场景工厂，与现有启动器一致。 */
const assert = require('node:assert/strict')
const path = require('node:path')

/** 由 18 在 createUiInspectionScenes 的 context 装配后收集，复用正式 Electron capture。 */
function createImageEditDockingScene(context) {
  const { setupToolbox, clickNamedButton, seedAndOpenCanvasPanoramaProject, reopenCanvasProjectFromStorage, settlePage } = context
  const editor = page => page.locator('[data-image-editor-v3]:visible').last()
  const menu = async (page, label) => {
    await editor(page).getByRole('button', { name: '面板', exact: true }).click()
    await page.getByRole('menuitem', { name: label, exact: true }).click()
    await settlePage(page)
  }
  const drag = async (page, from, to) => {
    const start = await from.boundingBox()
    const end = await to.boundingBox()
    assert.ok(start && end, '缺少真实拖动目标')
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
    await page.mouse.down()
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 16 })
    await page.mouse.up()
    await settlePage(page)
  }
  const inspect = async (page, inspection, prefix) => {
    const host = editor(page)
    const capture = async suffix => {
      await settlePage(page)
      await host.locator('.animate-spin').waitFor({ state: 'hidden', timeout: 30000 })
      if (suffix !== 'tabs' && suffix !== 'panels-hidden') {
        try {
          await host.locator('[data-editor-panel-id="properties"]').getByText('水平缩放 (%)', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })
        } catch (error) {
          const geometry = await host.locator('[data-editor-panel-id="properties"]').evaluate(element => {
            const ancestors = []
            for (let current = element; current && ancestors.length < 8; current = current.parentElement) {
              const style = getComputedStyle(current)
              ancestors.push({ class: current.className, rect: current.getBoundingClientRect().toJSON(), display: style.display, visibility: style.visibility })
            }
            return { html: element.outerHTML.slice(0, 250), ancestors }
          })
          throw new Error(`${prefix}-${suffix} 属性不可见：${JSON.stringify(geometry)}`, { cause: error })
        }
      }
      await inspection.capture(`${prefix}-${suffix}`)
    }
    await host.waitFor({ state: 'visible', timeout: 15000 })
    await host.locator('[data-raster-pasteboard-layer][data-raster-source-ready="true"]').waitFor({ state: 'attached', timeout: 30000 })
    await host.locator('.animate-spin').waitFor({ state: 'hidden', timeout: 30000 })
    await settlePage(page)
    assert.equal(await host.locator('[data-command-bar]').count(), 1, '只能有一条命令带')
    assert.ok(await host.locator('[data-context-bar]').count() <= 1, '从属选项最多一条')
    assert.equal(await host.locator('[data-editor-panel-id]').count(), 2, '默认图层/属性必须完整')
    await capture('default')

    await host.getByRole('button', { name: '收起图层', exact: true }).click()
    await settlePage(page)
    await capture('collapsed')
    await host.getByRole('button', { name: '展开图层', exact: true }).click()
    await host.getByRole('button', { name: '关闭图层面板', exact: true }).click()
    await host.locator('[data-editor-panel-id="layers"]').waitFor({ state: 'detached' })
    await menu(page, '显示图层面板')
    await host.locator('[data-editor-panel-id="layers"]').waitFor({ state: 'visible' })
    await capture('reopened')

    const layerGroup = host.locator('.dv-groupview').filter({ has: page.locator('[data-dock-tab="layers"]') })
    const propertiesTitle = host.locator('[data-dock-tab="properties"] > span').first()
    await drag(page, propertiesTitle, layerGroup.locator('.dv-content-container').first())
    assert.equal(await layerGroup.locator('[data-dock-tab]').count(), 2, '拖入中间应编组为两个标签')
    await host.locator('[data-dock-tab="layers"] > span').first().click()
    await settlePage(page)
    await capture('tabs')

    await menu(page, '浮动属性面板')
    await host.locator('[data-editor-panel-id="properties"][data-panel-mode="floating"]').waitFor({ state: 'visible' })
    assert.equal(await host.locator('[data-editor-panel-id="properties"]').count(), 1, '浮动不能复制面板')
    await capture('floating')
    await menu(page, '停靠属性面板')
    await host.locator('[data-editor-panel-id="properties"][data-panel-mode="docked"]').waitFor({ state: 'visible' })
    await menu(page, '恢复默认布局')
    await settlePage(page)
    const sashes = host.locator('[data-editor-panel-workspace] .dv-sash:visible')
    assert.ok(await sashes.count() >= 2, '左右与上下分隔条应存在')
    await capture('restored')
    const widthSash = host.locator('[data-editor-panel-workspace] .dv-split-view-container.dv-horizontal > .dv-sash-container > .dv-sash:not(.dv-disabled):visible').first()
    const before = await host.locator('[data-preview-surface]').boundingBox()
    const sash = await widthSash.boundingBox()
    assert.ok(sash && before, '缺少 Dockview 宽度分隔条')
    const sashHit = await widthSash.evaluate(element => {
      const rect = element.getBoundingClientRect()
      return { class: element.className, rect: rect.toJSON(), hit: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.outerHTML.slice(0, 300) }
    })
    await page.mouse.move(sash.x + sash.width / 2, sash.y + sash.height / 2)
    await page.mouse.down()
    await page.mouse.move(sash.x - 48, sash.y + sash.height / 2, { steps: 12 })
    await page.mouse.up()
    await settlePage(page)
    const after = await host.locator('[data-preview-surface]').boundingBox()
    assert.ok(after && Math.abs(after.width - before.width) >= 12, `拖动分隔条应真正调整画面与停靠宽度：${JSON.stringify({ before, after, sashHit })}`)
    await capture('resized')
    await host.getByRole('button', { name: '关闭图层面板', exact: true }).click()
    await host.getByRole('button', { name: '关闭属性面板', exact: true }).click()
    assert.equal(await host.locator('[data-editor-panel-id]').count(), 0, '所有面板应关闭')
    assert.ok(await host.getByRole('button', { name: '面板', exact: true }).isVisible(), '空布局保留恢复入口')
    await capture('panels-hidden')
    await menu(page, '恢复默认布局')
  }
  const openCanvasDocument = async page => {
    const { projectId } = await seedAndOpenCanvasPanoramaProject(page)
    const nodeId = '__ui_image_docking_document'
    await page.evaluate(async ({ projectId, nodeId, filePath }) => {
      const managed = await window.henjiNative.imageEditorV3.ingestSource({
        requestId: `ui-docking-ingest-${crypto.randomUUID()}`, source: { kind: 'local-path', filePath },
      })
      const saved = await window.henjiNative.imageEditorV3.saveDocument({
        requestId: `ui-docking-save-${crypto.randomUUID()}`,
        document: {
          version: 3, id: `ui-docking-${crypto.randomUUID()}`, revision: 0,
          geometry: { width: managed.metadata.width, height: managed.metadata.height, orientation: { rotate: 0, mirrored: false }, crop: null },
          color: { workingSpace: 'srgb', bitDepth: 8, transferFunction: 'srgb', hdrMetadata: null, iccProfileResourceId: null },
          layers: [{
            id: 'source', name: '底图', type: 'raster', visible: true, locked: false, opacity: 1, blendMode: 'normal',
            transform: [1, 0, 0, 1, 0, 0], mask: null, source: { kind: 'resource', resourceId: managed.resource.resourceRef }, tiles: {},
          }],
        },
        expectedRevision: 0, history: null, resourceRefs: [managed.resource.resourceRef], previewRef: null,
      })
      const canvas = await window.henjiNative.testFixtures.readCanvas(projectId)
      const nodes = canvas.nodes.filter(node => node.id !== nodeId)
      nodes.push({
        id: nodeId, type: 'layerStackResultNode', position: { x: 520, y: 80 },
        data: {
          displayName: '停靠验收图片', resultKind: 'layer-stack', isGenerating: false,
          imageUrl: managed.mediaUrl, previewImageUrl: managed.mediaUrl,
          aspectRatio: `${managed.metadata.width}:${managed.metadata.height}`,
          imageEditSession: { kind: 'image-edit-v3', sourceUrl: managed.mediaUrl, documentRef: saved.documentRef, revision: saved.revision, previewRef: saved.previewRef },
        },
      })
      await window.henjiNative.testFixtures.writeCanvas(projectId, { ...canvas, nodes, viewport: { x: 80, y: 100, zoom: 0.65 } })
    }, { projectId, nodeId, filePath: path.resolve(__dirname, '../../tests/fixtures/image-inpainting/face-scratch-source.png') })
    await reopenCanvasProjectFromStorage(page, projectId)
    const node = page.locator(`[data-layer-stack-node-id="${nodeId}"]`)
    await node.waitFor({ state: 'visible', timeout: 15000 })
    await node.getByRole('button', { name: /^(编辑|Edit)$/i }).click()
    await page.getByRole('dialog', { name: /多图层图片编辑器|Multi-layer image editor/i }).waitFor({ state: 'visible', timeout: 15000 })
  }
  return {
    id: 'image-edit-docking',
    surface: '图片编辑',
    name: '图片编辑-Shell 与多宿主停靠',
    writesUserData: true,
    setup: async (page, electronApp, inspection) => {
      await setupToolbox(page)
      await clickNamedButton(page, /^(图片编辑|Image Edit)/i)
      await page.getByRole('button', { name: /^(打开图片|Open image)$/i }).waitFor({ state: 'visible', timeout: 15000 })
      await settlePage(page)
      await inspection.capture('toolbox-empty')
      // 仅替换本测试实例的系统文件选择；夹具入库走正式宿主，无付费模型。
      await electronApp.evaluate(({ dialog }, selectedPath) => {
        const key = '__henjiImageDockingOriginalDialog'
        if (globalThis[key]) throw new Error('图片停靠场景对话框替身重复安装')
        globalThis[key] = dialog.showOpenDialog
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] })
      }, path.resolve(__dirname, '../../tests/fixtures/image-inpainting/face-scratch-source.png'))
      try {
        await page.getByRole('button', { name: /^(打开图片|Open image)$/i }).click()
      } finally {
        await electronApp.evaluate(({ dialog }) => {
          const key = '__henjiImageDockingOriginalDialog'
          dialog.showOpenDialog = globalThis[key]
          delete globalThis[key]
        })
      }
      await inspect(page, inspection, 'toolbox')
      await openCanvasDocument(page)
      await inspect(page, inspection, 'canvas')
    },
    cleanup: async page => {
      const dialog = page.getByRole('dialog', { name: /多图层图片编辑器|Multi-layer image editor/i })
      if (await dialog.isVisible()) await dialog.getByRole('button', { name: /关闭编辑器|Close editor/i }).click()
    },
  }
}

function createImageEditLayoutFailureScene(context) {
  return {
    id: 'image-edit-layout-failure', surface: '工具箱', name: '图片编辑-布局存取失败与恢复', writesUserData: true,
    launchArgs: ['--dev-surface=tool.image_edit', '--dev-media=tests/fixtures/image-inpainting/face-scratch-source.png'],
    expectedLogEvents: ['image_editor.layout.restore.failed', 'image_editor.layout.save.failed'],
    setup: async (page, app, { capture: captureRaw }) => {
      const editor = page.locator('[data-image-editor-v3]:visible')
      const capture = async suffix => {
        await editor.locator('[data-raster-pasteboard-layer][data-raster-source-ready="true"]').waitFor({ state: 'attached', timeout: 30000 })
        await editor.locator('.animate-spin').waitFor({ state: 'hidden', timeout: 30000 })
        await context.settlePage(page)
        await captureRaw(suffix)
      }
      await editor.waitFor({ state: 'visible', timeout: 30000 })
      const panelAction = async label => {
        await editor.getByRole('button', { name: '面板', exact: true }).click()
        await page.getByRole('menuitem', { name: label, exact: true }).click()
        await context.settlePage(page)
      }
      await panelAction('恢复默认布局')
      await page.waitForTimeout(300) // 正式布局仓库的 200ms 保存 debounce。
      const replaceImage = async () => {
        await app.evaluate(({ dialog }, filePath) => {
          globalThis.__imageLayoutOpenDialog = dialog.showOpenDialog
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
        }, path.resolve(__dirname, '../../tests/fixtures/image-inpainting/face-scratch-source.png'))
        try {
          const previous = await editor.elementHandle()
          await editor.getByRole('button', { name: '打开', exact: true }).click()
          await page.getByRole('button', { name: '打开图片', exact: true }).click()
          await page.getByRole('button', { name: '不保存', exact: true }).click()
          await page.waitForFunction(element => !element.isConnected, previous, { timeout: 20000 })
          await editor.waitFor({ state: 'visible', timeout: 20000 })
        } finally {
          await app.evaluate(({ dialog }) => {
            dialog.showOpenDialog = globalThis.__imageLayoutOpenDialog
            delete globalThis.__imageLayoutOpenDialog
          })
        }
      }
      await page.evaluate(() => {
        window.__imageLayoutGet = Map.prototype.get
        Map.prototype.get = function (key) {
          const value = window.__imageLayoutGet.call(this, key)
          if (key === 'full' && value?.dock && Array.isArray(value.collapsed)) throw new Error('巡检布局读取失败夹具')
          return value
        }
      })
      try {
        await replaceImage()
        await editor.getByText('面板布局无法恢复，已使用默认布局', { exact: true }).waitFor({ state: 'visible' })
        await capture('layout-load-failed')
      } finally {
        await page.evaluate(() => { Map.prototype.get = window.__imageLayoutGet; delete window.__imageLayoutGet })
      }
      await editor.getByRole('button', { name: '恢复默认布局', exact: true }).click()
      await context.settlePage(page)
      await capture('layout-load-recovered')
      await page.evaluate(() => {
        window.__imageLayoutClone = window.structuredClone
        window.structuredClone = function (value, options) {
          if (value?.dock && Array.isArray(value.collapsed)) throw new Error('巡检布局保存失败夹具')
          return window.__imageLayoutClone(value, options)
        }
      })
      try {
        await panelAction('关闭图层面板')
        await editor.getByText('面板布局未能保存', { exact: true }).waitFor({ state: 'visible' })
        await capture('layout-save-failed')
      } finally {
        await page.evaluate(() => { window.structuredClone = window.__imageLayoutClone; delete window.__imageLayoutClone })
      }
      await editor.getByRole('button', { name: '恢复默认布局', exact: true }).click()
      await context.settlePage(page)
      await editor.getByText('面板布局未能保存', { exact: true }).waitFor({ state: 'hidden' })
      await capture('layout-save-recovered')
    },
  }
}

module.exports = { createImageEditDockingScene, createImageEditLayoutFailureScene }
