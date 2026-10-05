const assert = require('node:assert/strict')

/**
 * 任务 4.3 用户反馈修复的视觉验收场景：生成底栏单行与“更多参数”、模式在首位、菜单选中项不截断、
 * 嵌套浮层不关父层；画布节点参数行悬停与行内触发器可辨、选中与菜单打开态。
 * 尺寸由 ui:tour / check:ui-visual 的 --size 决定（验收跑 1440 与 960）。
 */
function createSelectionFeedbackScenes(context) {
  const {
    settlePage,
    canvasFixtureProjectId,
    setupCanvas,
    reopenCanvasProjectFromStorage,
  } = context

  async function overflowItemIds(page) {
    return page.locator('[data-ui-overflow-row]:visible [data-overflow-item]').evaluateAll(
      (items) => items.map((item) => item.getAttribute('data-overflow-item')),
    )
  }

  async function assertSingleRow(page) {
    const row = page.locator('[data-ui-overflow-row]:visible').first()
    const box = await row.boundingBox()
    assert.ok(box, '生成底栏找不到参数行')
    assert.ok(box.height <= 40, `生成底栏参数行应为单行，实际高 ${box.height}`)
    const footer = row.locator('xpath=ancestor::div[contains(@class,"justify-between")][1]')
    const footerBox = await footer.boundingBox()
    assert.ok(footerBox && footerBox.height <= 44, `生成底栏应为单行，实际高 ${footerBox?.height}`)
  }

  async function assertMenuOptionsFit(page) {
    const clipped = await page.locator('[role="listbox"]:visible [role="option"]').evaluateAll((options) => options
      .flatMap((option) => [option, ...option.querySelectorAll('*')])
      .filter((element) => element.childNodes.length && [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim()))
      .filter((element) => element.scrollWidth > element.clientWidth)
      .map((element) => {
        const panel = element.closest('[data-dropdown-portal]')
        return `${element.textContent.trim()}（文字 ${element.scrollWidth}/${element.clientWidth}，浮层 ${panel ? Math.round(panel.getBoundingClientRect().width) : '?'}，字体 ${getComputedStyle(element).font}）`
      }))
    assert.deepEqual(clipped, [], `菜单选项不应被截断：${clipped.join('、')}`)
  }

  /** 打开“更多参数”，再在浮层里打开一个子浮层并在其中点击：父浮层必须保持打开。 */
  async function exerciseMorePanel(page, capture) {
    const more = page.locator('[data-more-params-trigger]:visible').first()
    if (!await more.count()) return false
    await more.click()
    await page.waitForFunction(() => document.querySelector('[data-more-params-trigger]')?.getAttribute('aria-expanded') === 'true')
    const panel = page.locator('[data-panel-scroll-region]:visible').last()
    await panel.waitFor({ state: 'visible', timeout: 8000 })
    await settlePage(page)
    if (capture) await capture('more-open')
    const nested = panel.locator('[data-dropdown-button], [data-panel-trigger-button]').filter({ visible: true }).first()
    if (await nested.count()) {
      await nested.click()
      await settlePage(page, 300)
      const nestedLayer = page.locator('[data-dropdown-portal="true"]:visible, [data-panel-placement]:visible').last()
      await nestedLayer.waitFor({ state: 'visible', timeout: 8000 })
      if (await page.locator('[role="listbox"]:visible').count()) await assertMenuOptionsFit(page)
      if (capture) await capture('more-nested')
      const box = await nestedLayer.boundingBox()
      if (box) await page.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height - 4, 18))
      await settlePage(page, 300)
      assert.equal(await more.getAttribute('aria-expanded'), 'true', '在“更多参数”的子浮层里点击不应关闭“更多参数”')
    }
    return true
  }

  async function setupGenerationBar(page, capture, { modelName, modelId, providerId, primaryParamId }) {
    await context.selectGenerationModel(page, modelName, modelId, providerId)
    await settlePage(page, 500)
    const ids = await overflowItemIds(page)
    assert.equal(ids[0], 'leading', `模型选择应在最前：${ids.join(',')}`)
    if (primaryParamId) assert.equal(ids[1], `param:${primaryParamId}`, `模式应排在第一个参数：${ids.join(',')}`)
    await assertSingleRow(page)
    if (capture) await capture('bar')
    if (primaryParamId) {
      const modeItem = page.locator(`[data-overflow-item="param:${primaryParamId}"]:visible`)
      await modeItem.locator('[data-dropdown-button]').click()
      await page.locator('[role="listbox"]:visible').first().waitFor({ state: 'visible', timeout: 8000 })
      await settlePage(page, 300)
      await assertMenuOptionsFit(page)
      if (capture) await capture('mode-menu')
      await page.keyboard.press('Escape')
      await settlePage(page, 300)
    }
    await exerciseMorePanel(page, capture)
    await settlePage(page)
  }

  async function setupCanvasImageNodeSelection(page, capture) {
    await setupCanvas(page)
    if (await page.locator('.react-flow').count()) {
      await page.getByRole('button', { name: /返回画布列表|Back to Canvases/ }).click()
      await settlePage(page)
    }
    const fixtureCard = page.locator(`[data-project-id="${canvasFixtureProjectId}"]:visible`)
    const projectCard = await fixtureCard.count() ? fixtureCard : page.locator('[data-project-id]:visible').first()
    await projectCard.waitFor({ state: 'visible', timeout: 12000 })
    const projectId = await projectCard.getAttribute('data-project-id')
    if (!projectId) throw new Error('画布选中态场景找不到专用画布工程')
    const node = {
      id: '__ui_selection_image_node', type: 'imageNode', position: { x: 300, y: 120 },
      width: 360, height: 560, measured: { width: 360, height: 560 }, style: { width: 360, height: 560 },
      data: {
        displayName: '图片生成', prompt: 'a quiet harbor at dawn', modelId: 'kie-gpt-image-2',
        params: {}, mediaInputs: {}, imageUrl: null, previewImageUrl: null, aspectRatio: '1:1',
        isGenerating: false, generationStartedAt: null,
      },
    }
    await page.evaluate(async (payload) => {
      await window.henjiNative.testFixtures.writeCanvas(payload.projectId, { nodes: [payload.node], edges: [], viewport: { x: 180, y: 90, zoom: 1 } })
    }, { projectId, node })
    await reopenCanvasProjectFromStorage(page, projectId)
    const flowNode = page.locator('.react-flow__node:has([data-generation-node-model-id="kie-gpt-image-2"])').last()
    await flowNode.waitFor({ state: 'visible', timeout: 12000 })
    await flowNode.click()
    await settlePage(page, 500)
    if (capture) await capture('node-selected')

    // 参数行：行内取值触发器（下拉或面板）
    // 优先文字下拉（分辨率“1K”），菜单打开态能看到选中项的淡强调底与勾
    const dropdownTriggers = flowNode.locator('.group\\/row [data-dropdown-button]').filter({ visible: true })
    const trigger = await dropdownTriggers.count()
      ? dropdownTriggers.last()
      : flowNode.locator('.group\\/row [data-panel-trigger-button]').filter({ visible: true }).first()
    await trigger.waitFor({ state: 'visible', timeout: 8000 })
    const row = trigger.locator('xpath=ancestor::div[contains(@class,"group/row")][1]')
    const rowLabel = row.locator('> *').nth(1)
    await rowLabel.hover()
    await settlePage(page, 300)
    if (capture) await capture('row-hover')

    // 菜单打开态（玻璃浮层，当前项淡强调底 + 勾，选项不截断）
    await trigger.click()
    await settlePage(page, 400)
    if (await page.locator('[role="listbox"]:visible').count()) await assertMenuOptionsFit(page)
    if (capture) await capture('menu-open')
    await page.keyboard.press('Escape')
    await settlePage(page, 300)

    // 终态停在“指针在行内触发器上”：DOM 审计的 nestedSameBackground 在此判定行与触发器可辨
    await trigger.hover()
    await settlePage(page, 300)
    const colors = await trigger.evaluate((element) => {
      const rowElement = element.closest('.group\\/row')
      return { trigger: getComputedStyle(element).backgroundColor, row: rowElement ? getComputedStyle(rowElement).backgroundColor : '' }
    })
    assert.notEqual(colors.trigger, colors.row, `悬停时行内触发器与行底同色：${JSON.stringify(colors)}`)
  }

  return [
    {
      id: 'selection-generation-bar-seedance',
      surface: '生成',
      name: '生成-底栏单行与模式首位（Seedance 2.0 KIE）',
      setup: async (page, _app, { capture } = {}) => setupGenerationBar(page, capture, {
        modelName: 'Seedance 2.0', modelId: 'kie-seedance-2.0', providerId: 'kie', primaryParamId: 'kieSeedance20Mode',
      }),
    },
    {
      id: 'selection-generation-bar-midjourney',
      surface: '生成',
      name: '生成-底栏单行与更多参数（Midjourney 参数最多）',
      setup: async (page, _app, { capture } = {}) => setupGenerationBar(page, capture, {
        modelName: 'Midjourney', modelId: 'apimart-midjourney', providerId: 'apimart', primaryParamId: 'apimartMidjourneyMode',
      }),
    },
    {
      id: 'selection-canvas-image-node',
      surface: '画布',
      writesUserData: true,
      name: '画布-图片生成节点参数行悬停、选中与菜单',
      setup: async (page, _app, { capture } = {}) => setupCanvasImageNodeSelection(page, capture),
    },
  ]
}

module.exports = { createSelectionFeedbackScenes }
