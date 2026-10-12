/* eslint-disable @typescript-eslint/no-var-requires -- 正式 ui:tour 场景工厂。 */
const path = require('node:path')
const assert = require('node:assert/strict')
const { loadTypeScript } = require('../check-persistence-compat.cjs')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')
const { stubIpc, restoreIpcStubs } = require('./uiReviewIpcStub.cjs')
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
/** u6 仅摆放隔离夹具、查看 UI；不点击模型验证或生成。 */
function createUiPolishScenes(context) {
  return [
    { id: 'u6-vector-properties', surface: '图片编辑', name: '矢量属性-分组边界与空蒙版目标', writesUserData: true,
      setup: async (page, app, { capture }) => {
        const restore = await blockPaidGeneration(app)
        try {
          const factory = loadTypeScript('src/core/imageEdit/v3/documentFactory.ts')
          const vector = loadTypeScript('src/core/imaging/vectorContent/index.ts')
          const { fill, strokes, shadows } = vector.defaultTextStyle(600)
          const shape = factory.createImageEditPathLayerV3('u6-shape', '可编辑路径', 'shape', {
            operands: [{ operation: 'replace', path: vector.rectanglePath(160, 120, 240, 180) }], paint: { fill, strokes, shadows },
          })
          const { editor } = await openCanvasImageEditorV3Fixture({ page, context, width: 800, height: 600, label: '界面打磨', vectorLayers: [shape] })
          await editor.locator('[data-dock-tab="layers"] > span').first().click()
          await editor.locator('[data-layer-id="reality-gpu-source-layer"] [data-layer-select]').click()
          await editor.locator('[data-tool-id="move"]').click()
          await editor.locator('[data-dock-tab="properties"] > span').first().click()
          await editor.locator('[data-properties-tab="basics"]').click()
          await editor.getByRole('switch', { name: '锁定', exact: true }).click()
          await editor.locator('[data-dock-tab="layers"] > span').first().click()
          await editor.locator(`[data-layer-id="${shape.id}"] [data-layer-select]`).click()
          await editor.locator('[data-dock-tab="properties"] > span').first().click()
          const panel = editor.locator('[data-properties-tab-panel]')
          await context.settlePage(page, 500)
          const gap = await panel.evaluate(element => {
            const rotation = element.querySelector('input[aria-label^="旋转"]')
            const pathTitle = [...element.querySelectorAll('div')].find(item => item.textContent === '路径与组合')?.closest('[data-ui-group]')
            if (!rotation || !pathTitle) throw new Error('分组间距目标未找到')
            return pathTitle.getBoundingClientRect().top - rotation.getBoundingClientRect().bottom
          })
          assert.ok(Math.round(gap) >= 32, `变换和路径组间距须为 32px 分区档（DIP 取整），实际 ${gap}`)
          await capture('group-spacing')
          const target = editor.getByRole('button', { name: '蒙版目标图层', exact: true })
          await target.scrollIntoViewIfNeeded()
          assert.equal(await target.isDisabled(), true)
          assert.match(await target.textContent(), /没有可用图层/)
          await context.settlePage(page, 300)
          await capture('empty-mask-target')
        } finally { await restore() }
      } },
    { id: 'u6-assistant-details', surface: '设置', name: '助手模型详情-未知与已知验证用量', writesUserData: true,
      setup: async (page, app, { capture }) => {
        await stubIpc(app, { channel: 'llm:verifyModelCapabilities', mode: 'reject', message: '界面巡检禁止真实模型验证' })
        const previous = await page.evaluate(() => window.henjiNative.llm.readConfig())
        const provider = { providerId: 'u6-fixture', displayName: '界面验收', adapter: 'openai-compatible', enabled: true, baseUrl: 'http://127.0.0.1:9/v1', setup: { kind: 'custom' } }
        const primary = { providerId: provider.providerId, modelId: 'u6-model' }
        const baseline = previous?.agentProfiles?.length ? previous : {
          providers: [provider], models: [{ ...primary, displayName: '验收助手模型', adapter: provider.adapter, enabled: true,
            capabilities: { text: true, image: false, video: false, audio: false, streaming: true, toolCall: true, parallelTools: false,
              jsonOutput: true, structuredOutputMode: 'json', reasoning: false, sampling: true, contextWindow: 32768, maxOutputTokens: 1024, usage: true } }],
          promptProfiles: [], textProcessingPromptTemplates: [], selectedAgentProfileId: 'u6-agent',
          agentProfiles: [{ id: 'u6-agent', name: '验收助手', primary, settings: { timeoutMs: 60000, maxRetries: 0, maxOutputTokens: 1024, contextWindowBudget: 32768 },
            verifications: [], createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z' }],
          tools: [], policy: { allowedTools: [], requireHumanConfirmation: false }, memory: {},
        }
        try {
          for (const known of [false, true]) {
            await page.evaluate(async ({ baseline, known }) => {
              const config = structuredClone(baseline)
              const profile = config.agentProfiles.find(item => item.id === config.selectedAgentProfileId) ?? config.agentProfiles[0]
              profile.verifications = [{ ...profile.primary, adapterVersion: 'u6-fixture', verifiedAt: '2026-10-13T00:00:00Z',
                checks: [{ id: 'text', status: 'passed', latencyMs: 1 }], totalLatencyMs: 1,
                usage: { inputTokens: known ? 120 : null, outputTokens: known ? 30 : null, reasoningTokens: null,
                  cacheReadTokens: null, cacheWriteTokens: null, totalTokens: null }, cost: { status: 'unknown' } }]
              await window.henjiNative.llm.writeConfig(config)
            }, { baseline, known })
            await page.reload()
            await context.setupSettings(page)
            await context.clickNamedButton(page, /^(助手模型|Assistant Models)$/i)
            await page.getByRole('button', { name: '详情', exact: true }).first().click()
            await context.settlePage(page, 300)
            assert.equal(await page.getByText(/^工具 .*上下文/).count(), 0)
            if (known) assert.ok(await page.getByText('上次验证用量：输入 120、输出 30', { exact: true }).count())
            else assert.equal(await page.getByText(/^上次验证用量：/).count(), 0)
            await capture(known ? 'known-usage' : 'unknown-usage')
          }
        } finally {
          await page.evaluate(config => window.henjiNative.llm.writeConfig(config), baseline)
          await restoreIpcStubs(app)
        }
      } },
    { id: 'u6-settings-search', surface: '设置', name: '设置搜索-记录分隔',
      setup: async page => {
        await context.closeTransientUi(page)
        await context.setupSettings(page)
        await page.getByPlaceholder('搜索设置', { exact: true }).fill('模型')
        await page.getByRole('listitem').first().waitFor()
        await context.settlePage(page, 300)
      } },
    { id: 'u6-preset-records', surface: '生成', name: '提示词预设-记录分隔', writesUserData: true,
      setup: async (page, app) => {
        await context.closeTransientUi(page)
        const restore = await blockPaidGeneration(app)
        try {
          await page.evaluate(async () => {
            for (const [index, name] of ['海边日落', '人像柔光', '城市夜景'].entries()) {
              await window.henjiNative.presets.insert({ id: `u6-preset-${index}`, name, description: null, modelId: null,
                params: { prompt: name, saveMode: 'prompt' }, isFavorite: false })
            }
          })
          // 预设面板常驻生成页，夹具写入后重载以触发正式读取，不借用陈旧的组件状态。
          await page.reload()
          await context.setupGeneration(page)
          await page.getByRole('button', { name: /^预设/ }).first().click()
          await page.locator('[data-preset-item]').first().waitFor()
          await context.settlePage(page, 300)
        } finally { await restore() }
      } },
  ]
}
module.exports = { createSurfaceGrammarScenes, createUiPolishScenes }
