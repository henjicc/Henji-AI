/* eslint-disable @typescript-eslint/no-var-requires -- 正式 ui:tour 场景工厂。 */
const path = require('node:path')
const assert = require('node:assert/strict')
const { loadTypeScript } = require('../check-persistence-compat.cjs')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')
const { openCanvasImageEditorV3Fixture } = require('./uiInspectionCanvasImageEditorV3.cjs')
const { fixture } = require('./uiInspectionSceneVideoEditMotionDraft.cjs')
const { seedVideoEditProject, openVideoEditProjectCard } = require('./uiInspectionVideoEditDocuments.cjs')

async function assertFormColumns(host) {
  const issues = await host.evaluate(element => {
    const rows = [...element.querySelectorAll('[data-ui-form-row="panel"]')].filter(row => row.getBoundingClientRect().height > 0)
    const issues = []
    const firstLeft = rows[0]?.firstElementChild.getBoundingClientRect().left
    for (const row of rows) {
      const label = row.firstElementChild, control = row.querySelector('[data-ui-form-control]')
      const labelRect = label.getBoundingClientRect(), controlRect = control.getBoundingClientRect()
      if (Math.abs(labelRect.left - firstLeft) > 1) issues.push(`标签左缘不齐：${label.textContent}`)
      if (label.scrollWidth > label.clientWidth + 1) issues.push(`标签溢出：${label.textContent}`)
      // 滑杆 + 数值等复合控件按整体边界判定，不把第一个子控件当作整列。
      const fields = [...control.querySelectorAll('[data-dropdown-button], [data-ui-field-control], [role="radiogroup"], input[type="range"], [role="switch"]')]
      if (fields.length) fields.push(...control.querySelectorAll('button'))
      if (fields.length && Math.abs(Math.max(...fields.map(field => field.getBoundingClientRect().right)) - controlRect.right) > 1) issues.push(`控件右缘不齐：${label.textContent}`)
      if (control.scrollWidth > control.clientWidth + 1) issues.push(`控件溢出：${label.textContent}`)
    }
    // 成对网格首列标签和第二列/通栏数值框，与单行的面板左右边缘对齐。
    const grid = element.querySelector('.grid.grid-cols-2.gap-x-3')
    if (grid && rows.length) {
      const gridRect = grid.getBoundingClientRect(), rowRect = rows[0].getBoundingClientRect()
      if (Math.abs(gridRect.left - firstLeft) > 1 || Math.abs(gridRect.right - rowRect.right) > 1) issues.push('成对网格与单行面板左右边缘不齐')
    }
    if (!rows.length) issues.push('没有实际面板表单行，不能证明列对齐')
    return issues
  })
  assert.deepEqual(issues, [], '标签左缘、控件右缘必须对齐且无横向溢出')
}

/** 只查看本次迁移的控件；不执行图像算法、生成、下载或性能循环。 */
function createSurfaceGrammarScenes(context) {
  const imageScene = (id, name, tool, extra) => ({
    id: `u5-${id}`, surface: '图片编辑', name, writesUserData: true,
    launchArgs: ['--dev-surface=tool.image_edit', '--dev-media=tests/fixtures/image-inpainting/face-scratch-source.png'],
    setup: async (page, app) => {
      const restore = await blockPaidGeneration(app)
      try {
        await page.reload()
        const editor = page.locator('[data-image-editor-v3]:visible').last()
        await editor.waitFor({ timeout: 30000 })
        await editor.locator(`[data-tool-id="${tool}"]`).click()
        if (extra) await extra(page, editor)
        await context.settlePage(page, 500)
      } finally { await restore() }
    },
  })
  return [
    { id: 'u5-settings-segmented', surface: '设置', name: '设置-外观统一分段',
      setup: async (page, _app, { capture }) => {
        await context.setupSettings(page)
        await context.clickNamedButton(page, /^(外观|Appearance)$/i)
        await page.getByRole('radiogroup', { name: /层级对比|contrast/i }).scrollIntoViewIfNeeded()
        await context.settlePage(page, 300)
        await assertFormColumns(page.getByRole('radiogroup', { name: /层级对比|contrast/i }).locator('xpath=ancestor::*[@data-ui-form-row="panel"]/../..'))
        const overflow = await page.locator('[role="radiogroup"] [role="radio"]').evaluateAll(elements => elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.textContent))
        assert.deepEqual(overflow, [], '分段标签须完整落在各自等宽选项内')
        await capture('appearance')
        await page.getByRole('radiogroup', { name: '自动检查更新', exact: true }).evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
        await context.settlePage(page, 400)
      } },
    imageScene('selection-segmented', '图片编辑-选区组合分段', 'select-rect'),
    imageScene('repair-segmented', '图片编辑-修复质量分段', 'remove'),
    imageScene('paint-form', '图片编辑-笔尖参数行', 'raster-brush', async (page, editor) => {
      await editor.getByRole('button', { name: '笔尖设置', exact: true }).click()
      await page.locator('[data-paint-brush-settings]').waitFor()
      await assertFormColumns(page.locator('[data-paint-brush-settings]'))
    }),
    { id: 'u5-vector-form', surface: '画布', name: '图片文档-文字与矢量参数行', writesUserData: true,
      setup: async (page, app, { capture }) => {
        const restore = await blockPaidGeneration(app)
        try {
          const factory = loadTypeScript('src/core/imageEdit/v3/documentFactory.ts')
          const vector = loadTypeScript('src/core/imaging/vectorContent/index.ts')
          const title = factory.createImageEditTextLayerV3('u5-title', '标题与段落')
          const { fill, strokes, shadows } = title.content.paragraphs[0].runs[0].style
          const shape = factory.createImageEditPathLayerV3('u5-path', '可编辑路径', 'shape', {
            operands: [{ operation: 'replace', path: vector.rectanglePath(80, 150, 200, 150) }],
            paint: { fill, strokes, shadows },
          })
          const { editor } = await openCanvasImageEditorV3Fixture({ page, context, width: 800, height: 600, label: '界面语法参数行', vectorLayers: [shape, title] })
          const select = async id => {
            const restorePanel = editor.getByRole('button', { name: '恢复面板大小', exact: true })
            if (await restorePanel.count()) await restorePanel.last().click()
            await editor.locator('[data-dock-tab="layers"] > span').first().click()
            await editor.locator(`[data-layer-id="${id}"] [data-layer-select]`).click()
            await editor.locator('[data-tool-id="move"]').click()
            await editor.locator('[data-dock-tab="properties"] > span').first().click()
            await editor.getByRole('button', { name: '最大化面板', exact: true }).last().click()
            await context.settlePage(page, 500)
          }
          await select(title.id); await assertFormColumns(editor.locator('[data-properties-tab-panel]')); await capture('text-rows')
          await select(shape.id)
          await assertFormColumns(editor.locator('[data-properties-tab-panel]'))
          await capture('path-rows')
          await editor.getByRole('button', { name: '恢复面板大小', exact: true }).last().click()
          await context.settlePage(page, 400)
          await assertFormColumns(editor.locator('[data-properties-tab-panel]'))
        } finally { await restore() }
      } },
    { id: 'u5-video-form', surface: '剪辑', name: '剪辑-批注与调色参数', writesUserData: true,
      setup: async (page, app, { capture }) => {
        const restore = await blockPaidGeneration(app)
        try {
          const source = path.resolve('tests/fixtures/image-inpainting/face-scratch-source.png')
          await context.closeTransientUi(page)
          await page.getByRole('button', { name: '剪辑', exact: true }).first().click()
          const seeded = await seedVideoEditProject(page, fixture(source))
          await page.evaluate(async ({ source, projectId, id }) => {
            const documents = window.henjiNative.documents
            const resource = await documents.importFile({ sourcePath: source, container: { kind: 'project', projectId }, folder: 'materials' })
            const read = await documents.readDocument({ id }); read.content.media[0].path = resource.path
            await documents.saveDocument({ target: { id }, expectedRevision: read.meta.revision, content: read.content })
          }, { source, projectId: seeded.projectId, id: seeded.documentId })
          await openVideoEditProjectCard(page, seeded.projectId)
          await page.locator('[data-video-edit-clip="motion-clip"] [aria-label^="选择片段"]').click()
          await page.getByRole('button', { name: '批注', exact: true }).click()
          await page.getByLabel('筛选批注', { exact: true }).waitFor()
          await context.settlePage(page, 300); await assertFormColumns(page.getByLabel('批注面板', { exact: true })); await capture('annotation-rows')
          await page.getByRole('button', { name: '面板', exact: true }).click()
          await page.getByRole('button', { name: '全能调色', exact: true }).click()
          await page.getByRole('button', { name: '基本校正', exact: true }).click()
          await page.getByRole('button', { name: '曲线', exact: true }).click()
          await page.getByRole('radiogroup', { name: '曲线通道', exact: true }).scrollIntoViewIfNeeded()
          await context.settlePage(page, 500)
          await assertFormColumns(page.locator('div[aria-label="全能调色"]').last())
        } finally { await restore() }
      } },
  ]
}
module.exports = { createSurfaceGrammarScenes }
