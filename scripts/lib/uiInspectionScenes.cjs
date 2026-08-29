const { diffBuffers } = require('./canvasVisualDiff.cjs')

const TAB_NAMES = Object.freeze({
  generation: /^(生成|Generation)$/i,
  canvas: /^(画布|Canvas)$/i,
  toolbox: /^(工具箱|Toolbox)$/i,
  assets: /^(资产|Assets)$/i,
})

const REFERENCE_FIXTURE_IMAGE = `${process.cwd()}/resources/icons/icon.png`

function createUiInspectionScenes({ canvasFixtureProjectId, settlePage }) {
  async function closeTransientUi(page) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(240)

    const dialog = page.locator('[data-dialog="true"]:visible').last()
    if (await dialog.count()) {
      const closeButton = dialog.getByRole('button', { name: /关闭|Close/i }).last()
      if (await closeButton.count()) {
        await closeButton.click()
        await page.waitForTimeout(240)
      }
    }

    if (await page.locator('[data-asset-floating-panel]:visible').count()) {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(240)
    }

    const assistant = page.locator('aside[aria-label="智能助手"]:visible')
    if (await assistant.count()) {
      const toggleAssistant = page.locator('[title="智能助手"]').first()
      if (await toggleAssistant.count()) {
        await toggleAssistant.click()
        await page.waitForTimeout(240)
      }
    }
  }

  async function clickNamedButton(page, name) {
    const button = page.getByRole('button', { name }).filter({ visible: true }).first()
    await button.click({ timeout: 8000 })
  }

  async function firstLocatorInViewport(page, locator) {
    const viewport = page.viewportSize() ?? await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }))
    for (let index = 0; index < await locator.count(); index += 1) {
      const candidate = locator.nth(index)
      const box = await candidate.boundingBox()
      if (box && box.x < viewport.width && box.y < viewport.height
        && box.x + box.width > 0 && box.y + box.height > 0) {
        return candidate
      }
    }
    return null
  }

  async function clickCanvasCapabilityAction(page, { directName, menuName, missingMessage }) {
    const directCandidates = page.getByRole('button', { name: directName }).filter({ visible: true })
    const directAction = await firstLocatorInViewport(page, directCandidates)
    if (directAction) {
      await directAction.click()
      return
    }

    const moreButton = page.getByRole('button').filter({ hasText: /^(更多|More)$/i }).filter({ visible: true }).first()
    if (!(await moreButton.count())) throw new Error(missingMessage)
    await moreButton.click()
    const menuAction = page.getByRole('menuitem', { name: menuName }).filter({ visible: true }).first()
    await menuAction.waitFor({ state: 'visible', timeout: 8000 })
    await menuAction.click()
  }

  function paramFieldFromLabel(page, name) {
    return page.getByText(name).filter({ visible: true }).first()
      .locator('xpath=ancestor::div[.//*[@data-dropdown-button or @data-panel-trigger-button]][1]')
  }

  async function openWorkspace(page, workspace) {
    await closeTransientUi(page)
    await clickNamedButton(page, TAB_NAMES[workspace])
    await settlePage(page, workspace === 'canvas' || workspace === 'assets' ? 700 : 400)
  }

  async function waitForPageHeader(page) {
    await page.locator('[data-ui-page-title]:visible').first().waitFor({ state: 'visible', timeout: 12000 })
  }

  async function setupGeneration(page) {
    await openWorkspace(page, 'generation')
    await waitForPageHeader(page)
  }

  async function openGenerationModelPanel(page) {
    await setupGeneration(page)
    const modelLabel = page.locator('label').filter({ hasText: /^(模型|Model)$/i }).first()
    await modelLabel.locator('..').locator('[data-panel-trigger-button]').click()
    const modelPanel = page.locator('[data-model-selector-panel]:visible')
    await modelPanel.waitFor({ state: 'visible', timeout: 8000 })
    const searchInput = modelPanel.locator('input[placeholder*="模型"], input[placeholder*="model" i]').first()
    await searchInput.waitFor({ state: 'visible', timeout: 8000 })
    return searchInput
  }

  async function selectGenerationModel(page, modelName, modelId) {
    const searchInput = await openGenerationModelPanel(page)
    await searchInput.fill(modelName)
    const modelPanel = page.locator('[data-model-selector-panel]:visible')
    const modelButton = modelId
      ? modelPanel.locator(`[data-model-id="${modelId}"][data-provider-id="apimart"]`).first()
      : modelPanel.getByRole('button').filter({ hasText: modelName }).first()
    await modelButton.waitFor({ state: 'visible', timeout: 8000 })
    await modelButton.click()
    await modelPanel.waitFor({ state: 'hidden', timeout: 8000 })
  }

  async function setupGenerationModelSearch(page, query, expectedModelId, excludedModelIds = []) {
    const searchInput = await openGenerationModelPanel(page)
    await searchInput.fill(query)
    const panel = page.locator('[data-model-selector-panel]:visible')
    const expected = panel.locator(`[data-provider-id="apimart"][data-model-id="${expectedModelId}"]`)
    await expected.waitFor({ state: 'visible', timeout: 8000 })
    for (const modelId of excludedModelIds) {
      if (await panel.locator(`[data-provider-id="apimart"][data-model-id="${modelId}"]`).count()) {
        throw new Error(`模型合并后仍显示旧入口：${modelId}`)
      }
    }
    await settlePage(page)
    return expected
  }

  async function setupGenerationMidjourneySettings(page, withCharacterReference) {
    // 生成页草稿是内存态；真实资料巡检时 ImageUpload 也会切换为 data URL 预览，
    // 不会把夹具导入用户媒体目录。
    await selectGenerationModel(page, 'Midjourney', 'apimart-midjourney')
    const settingsField = paramFieldFromLabel(page, /^(MJ 设置|MJ Settings)$/i)
    await settingsField.waitFor({ state: 'visible', timeout: 8000 })
    await settingsField.locator('[data-panel-trigger-button]').click()
    const panel = page.locator('[data-panel-scroll-region]:visible').last()
    await panel.waitFor({ state: 'visible', timeout: 8000 })
    await panel.getByText(/^(参考控制|References)$/i).waitFor({ state: 'visible', timeout: 8000 })
    if (withCharacterReference) {
      const characterReference = panel.getByText(/^(角色参考图|Character Reference)$/i).filter({ visible: true }).first()
        .locator('xpath=ancestor::div[.//input[@type="file"]][1]')
      await characterReference.locator('input[type="file"]').setInputFiles(REFERENCE_FIXTURE_IMAGE)
      await panel.getByText(/^(角色权重|Character Weight)$/i).waitFor({ state: 'visible', timeout: 8000 })
    }
    await settlePage(page)
  }

  async function setupGenerationGptMask(page, openEditor) {
    await selectGenerationModel(page, 'GPT Image 2', 'apimart-gpt-image-2')
    const channelField = paramFieldFromLabel(page, /^(渠道|Channel)$/i)
    await channelField.locator('[data-dropdown-button]').click()
    await page.getByRole('option', { name: /^(官方|Official)$/i }).filter({ visible: true }).first().click()

    const promptArea = page.locator('[data-onboarding-target="prompt"]').first().locator('..')
    await promptArea.locator('input[type="file"]').first().setInputFiles(REFERENCE_FIXTURE_IMAGE)
    const maskLabel = page.getByText(/^(局部重绘遮罩|Inpainting Mask)$/i).filter({ visible: true }).first()
    await maskLabel.waitFor({ state: 'visible', timeout: 8000 })
    if (await page.getByText('定义基于首张参考图创建的局部重绘区域；遮罩与源图同尺寸并使用 Alpha 通道。').count()) {
      throw new Error('description 不应显示在参数界面')
    }
    if (openEditor) {
      await page.getByRole('button', { name: /^(绘制|Draw)$/i }).filter({ visible: true }).first().click()
      const dialog = page.getByRole('dialog', { name: /绘制局部重绘遮罩|Draw Inpainting Mask/i })
      await dialog.waitFor({ state: 'visible', timeout: 12000 })
      const canvasRegion = dialog.locator('[data-application-observation-region="mask_editor.canvas"]')
      const box = await canvasRegion.boundingBox()
      if (!box) throw new Error('遮罩编辑器找不到可绘制区域')
      await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.45)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.55, { steps: 8 })
      await page.mouse.up()
      await dialog.getByRole('button', { name: /^(完成|Done)$/i }).click()
      await dialog.waitFor({ state: 'hidden', timeout: 12000 })
      await page.getByRole('button', { name: /^(编辑|Edit)$/i }).filter({ visible: true }).first().click()
      await dialog.waitFor({ state: 'visible', timeout: 12000 })
      const reopenedBox = await canvasRegion.boundingBox()
      if (!reopenedBox) throw new Error('重新打开后遮罩编辑器找不到可绘制区域')
      await dialog.getByRole('slider', { name: '画笔硬度' }).fill('45')
      await dialog.getByRole('button', { name: /^矩形$/ }).click()
      await page.mouse.move(reopenedBox.x + reopenedBox.width * 0.2, reopenedBox.y + reopenedBox.height * 0.2)
      await page.mouse.down()
      await page.mouse.move(reopenedBox.x + reopenedBox.width * 0.34, reopenedBox.y + reopenedBox.height * 0.36)
      await page.mouse.up()
      await dialog.getByRole('button', { name: /^擦除$/ }).click()
      await dialog.getByRole('button', { name: /^圆形$/ }).click()
      await page.mouse.move(reopenedBox.x + reopenedBox.width * 0.23, reopenedBox.y + reopenedBox.height * 0.23)
      await page.mouse.down()
      await page.mouse.move(reopenedBox.x + reopenedBox.width * 0.3, reopenedBox.y + reopenedBox.height * 0.3)
      await page.mouse.up()
      await dialog.getByRole('button', { name: /^绘制$/ }).click()
      await dialog.getByRole('button', { name: /^圆形$/ }).click()
      await page.mouse.move(reopenedBox.x + reopenedBox.width * 0.62, reopenedBox.y + reopenedBox.height * 0.24)
      await page.mouse.down()
      await page.mouse.move(reopenedBox.x + reopenedBox.width * 0.76, reopenedBox.y + reopenedBox.height * 0.4)
      await page.mouse.up()
      await dialog.getByRole('button', { name: /^自由框选$/ }).click()
      await page.mouse.move(reopenedBox.x + reopenedBox.width * 0.25, reopenedBox.y + reopenedBox.height * 0.62)
      await page.mouse.down()
      await page.mouse.move(reopenedBox.x + reopenedBox.width * 0.35, reopenedBox.y + reopenedBox.height * 0.54, { steps: 3 })
      await page.mouse.move(reopenedBox.x + reopenedBox.width * 0.43, reopenedBox.y + reopenedBox.height * 0.68, { steps: 3 })
      await page.mouse.move(reopenedBox.x + reopenedBox.width * 0.3, reopenedBox.y + reopenedBox.height * 0.74, { steps: 3 })
      await page.mouse.up()
      await dialog.getByRole('button', { name: /^擦除$/ }).click()
      await dialog.getByRole('button', { name: /^画笔$/ }).click()
      await page.mouse.move(reopenedBox.x + reopenedBox.width * 0.46, reopenedBox.y + reopenedBox.height * 0.48)
      await page.mouse.down()
      await page.mouse.move(reopenedBox.x + reopenedBox.width * 0.54, reopenedBox.y + reopenedBox.height * 0.52, { steps: 5 })
      await page.mouse.up()
      await page.mouse.move(reopenedBox.x + reopenedBox.width * 0.52, reopenedBox.y + reopenedBox.height * 0.52)
    } else {
      const maskTooltipTrigger = maskLabel.locator('xpath=ancestor-or-self::*[@tabindex="0"][1]')
      await maskTooltipTrigger.focus()
      await page.getByRole('tooltip').filter({ visible: true }).waitFor({ state: 'visible', timeout: 8000 })
    }
    await settlePage(page, 700)
  }

  async function setupSettings(page) {
    await setupGeneration(page)
    await clickNamedButton(page, /^(设置|Settings)$/i)
    await page.getByRole('dialog', { name: /设置|Settings/i }).waitFor({ state: 'visible', timeout: 8000 })
    await settlePage(page)
  }

  async function setupCanvas(page) {
    await openWorkspace(page, 'canvas')
    const viewport = page.locator('[data-application-observation-region="canvas.viewport_observer"]:visible')
    if (await viewport.count()) return
    await waitForPageHeader(page)
  }

  async function seedAndOpenCanvasPanoramaProject(page) {
    await setupCanvas(page)
    if (await page.locator('.react-flow').count()) {
      await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
      await settlePage(page)
    }
    const fixtureCard = page.locator(`[data-project-id="${canvasFixtureProjectId}"]:visible`)
    const projectCard = await fixtureCard.count() ? fixtureCard : page.locator('[data-project-id]:visible').first()
    await projectCard.waitFor({ state: 'visible', timeout: 12000 })
    const projectId = await projectCard.getAttribute('data-project-id')
    if (!projectId) throw new Error('全景查看器场景找不到专用画布工程')
    const panoramaSource = await page.evaluate(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = 1600
      canvas.height = 800
      const context = canvas.getContext('2d')
      if (!context) throw new Error('全景场景无法创建本地 PNG')
      const sky = context.createLinearGradient(0, 0, 0, 800)
      sky.addColorStop(0, 'rgb(24,84,156)')
      sky.addColorStop(1, 'rgb(250,180,100)')
      context.fillStyle = sky
      context.fillRect(0, 0, 1600, 800)
      context.fillStyle = 'rgb(32,75,72)'
      context.fillRect(0, 500, 1600, 300)
      context.fillStyle = 'rgb(24,48,58)'
      context.fillRect(0, 650, 1600, 150)
      context.fillStyle = 'rgb(236,245,255)'
      context.font = '700 38px sans-serif'
      ;[['WEST', 80], ['NORTH', 470], ['EAST', 900], ['SOUTH', 1320]].forEach(([label, x]) => {
        context.fillText(String(label), Number(x), 110)
      })
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error('PNG 编码失败')), 'image/png')
      })
      return await window.henjiNative.image.persistImageBinary(
        new Uint8Array(await blob.arrayBuffer()),
        'png'
      )
    })
    const nodes = [{
      id: '__ui_panorama_source', type: 'uploadNode', position: { x: 100, y: 80 },
      width: 420, height: 210, measured: { width: 420, height: 210 }, style: { width: 420, height: 210 },
      data: {
        displayName: '本地全景参考图', imageUrl: panoramaSource,
        previewImageUrl: panoramaSource, aspectRatio: '2:1', isGenerating: false,
      },
    }, {
      id: '__ui_panorama_result', type: 'exportImageNode', hidden: true, position: { x: 1400, y: 900 },
      width: 520, height: 260, measured: { width: 520, height: 260 }, style: { width: 520, height: 260 },
      data: {
        displayName: '720°全景', resultKind: 'panorama', imageUrl: panoramaSource,
        previewImageUrl: panoramaSource, aspectRatio: '2:1', isGenerating: false,
      },
    }]
    const viewportWidth = await page.evaluate(() => window.innerWidth)
    const viewportX = Math.max(80, Math.round(viewportWidth / 2 - 202))
    await page.evaluate(async (payload) => {
      await window.henjiNative.db.execute(
        'UPDATE storyboard_projects SET node_count = ?, nodes_json = ?, edges_json = ?, viewport_json = ?, history_json = ? WHERE id = ?',
        [payload.nodes.length, JSON.stringify(payload.nodes), '[]', JSON.stringify({ x: payload.viewportX, y: 80, zoom: 0.65 }), JSON.stringify({ past: [], future: [] }), payload.projectId]
      )
    }, { projectId, nodes, viewportX })
    await projectCard.click()
    await page.locator('.react-flow__node[data-id="__ui_panorama_source"]').waitFor({ state: 'visible', timeout: 12000 })
    return { panoramaSource, projectId }
  }

  async function setupCanvasImageCapabilityToolbar(page) {
    const { projectId } = await seedAndOpenCanvasPanoramaProject(page)
    const sourceNode = page.locator('.react-flow__node[data-id="__ui_panorama_source"]')
    await sourceNode.click()
    await page.waitForTimeout(350)

    const viewportWidth = await page.evaluate(() => window.innerWidth)
    const expectedInlineIds = viewportWidth >= 1360
      ? ['image.element-edit', 'image.upscale', 'image.relight', 'image.panorama']
      : viewportWidth >= 1080
        ? ['image.element-edit', 'image.upscale', 'image.relight']
        : viewportWidth >= 760
          ? ['image.element-edit', 'image.upscale']
          : ['image.element-edit']
    const inlineIds = await page
      .locator('[data-image-capability-placement="inline"]:visible')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-image-capability-id')))
    if (JSON.stringify(inlineIds) !== JSON.stringify(expectedInlineIds)) {
      throw new Error(`图片能力直达项不符合响应式排序：${JSON.stringify({ viewportWidth, inlineIds, expectedInlineIds })}`)
    }
    if (await page.locator('[role="separator"][aria-orientation="vertical"]:visible').count() !== 1) {
      throw new Error('图片能力与基础动作之间必须且只能有一条分隔线')
    }

    const moreButton = page.locator('[data-image-capability-more="true"]:visible')
    await moreButton.focus()
    await page.keyboard.press('Enter')
    const menu = page.locator('[data-image-capability-menu="true"]:visible')
    await menu.waitFor({ state: 'visible', timeout: 8000 })
    const menuItems = menu.getByRole('menuitem')
    if (await menuItems.count() !== 9 - expectedInlineIds.length) {
      throw new Error('更多菜单未完整承接非直达能力')
    }
    for (const groupName of [/生成与变换|Generate & Transform/i, /结构化|Structured Output/i, /本地处理|Local Processing/i]) {
      await menu.getByText(groupName).waitFor({ state: 'visible', timeout: 8000 })
    }
    if (!(await menu.getByText(/实验|Experimental/i).count())) {
      throw new Error('实验能力缺少明确状态标识')
    }
    const firstMenuItem = menuItems.first()
    await page.waitForFunction(() => document.activeElement?.getAttribute('role') === 'menuitem', undefined, {
      timeout: 8000,
    })
    if (!(await firstMenuItem.evaluate((element) => element === document.activeElement))) {
      throw new Error('更多菜单打开后未聚焦首个菜单项')
    }
    await page.keyboard.press('End')
    if (!(await menuItems.last().evaluate((element) => element === document.activeElement))) {
      throw new Error('End 未移动到最后一个菜单项')
    }
    await page.keyboard.press('Home')
    if (!(await firstMenuItem.evaluate((element) => element === document.activeElement))) {
      throw new Error('Home 未返回第一个菜单项')
    }
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'hidden', timeout: 8000 })
    await page.waitForTimeout(240)
    if (!(await moreButton.evaluate((element) => element === document.activeElement))) {
      throw new Error('Escape 关闭菜单后未把焦点还给触发按钮')
    }

    await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
    await settlePage(page, 500)
    await page.evaluate(async (targetProjectId) => {
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json FROM storyboard_projects WHERE id = ? LIMIT 1',
        [targetProjectId]
      )
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
      if (!nodes.some((node) => node.id === '__ui_empty_image_source')) {
        nodes.push({
          id: '__ui_empty_image_source', type: 'uploadNode', position: { x: 100, y: 470 },
          width: 360, height: 180, measured: { width: 360, height: 180 }, style: { width: 360, height: 180 },
          data: {
            displayName: '等待图片的节点', imageUrl: null, previewImageUrl: null,
            aspectRatio: '2:1', isGenerating: false,
          },
        })
      }
      await window.henjiNative.db.execute(
        'UPDATE storyboard_projects SET node_count = ?, nodes_json = ?, viewport_json = ? WHERE id = ?',
        [nodes.length, JSON.stringify(nodes), JSON.stringify({ x: 330, y: 80, zoom: 0.65 }), targetProjectId]
      )
    }, projectId)
    await page.locator(`[data-project-id="${projectId}"]:visible`).click()
    const emptyNode = page.locator('.react-flow__node[data-id="__ui_empty_image_source"]')
    await emptyNode.waitFor({ state: 'visible', timeout: 12000 })
    await emptyNode.click()
    await page.locator('[data-image-capability-more="true"]:visible').click()
    const disabledMenu = page.locator('[data-image-capability-menu="true"]:visible')
    await disabledMenu.waitFor({ state: 'visible', timeout: 8000 })
    const disabledItems = disabledMenu.getByRole('menuitem')
    const disabledStates = await disabledItems.evaluateAll((elements) => (
      elements.map((element) => element.getAttribute('aria-disabled'))
    ))
    if (disabledStates.length !== 9 || disabledStates.some((state) => state !== 'true')) {
      throw new Error(`等待图片节点的能力禁用状态不完整：${JSON.stringify(disabledStates)}`)
    }
    await disabledMenu.getByText(/请先等待图片完成或上传图片|Wait for the image to finish/i)
      .first().waitFor({ state: 'visible', timeout: 8000 })
    await disabledItems.first().evaluate((element) => element.click())
    if (!(await disabledMenu.count())) throw new Error('点击禁用能力不应关闭菜单')
    await page.keyboard.press('Escape')
    await disabledMenu.waitFor({ state: 'hidden', timeout: 8000 })

    const reopenedSource = page.locator('.react-flow__node[data-id="__ui_panorama_source"]')
    await reopenedSource.click()
    const upscaleAction = page.locator('[data-image-capability-id="image.upscale"][data-image-capability-placement="inline"]:visible')
    await upscaleAction.click()
    const upscaleShell = page.locator('[data-generation-node-id][data-generation-node-model-id="fal-ai-topaz-image-upscale"]').last()
    await upscaleShell.waitFor({ state: 'visible', timeout: 12000 })
    const upscaleNode = upscaleShell.locator('xpath=ancestor::*[contains(@class,"react-flow__node")][1]')
    if (!(await upscaleNode.evaluate((element) => element.classList.contains('selected')))) {
      throw new Error('工具条直达能力创建后未选中新节点')
    }
    if (await page.locator('.react-flow__edge').count() < 1) {
      throw new Error('工具条直达能力未创建来源连线')
    }

    await reopenedSource.click()
    await page.locator('[data-image-capability-more="true"]:visible').click()
    const finalMenu = page.locator('[data-image-capability-menu="true"]:visible')
    await finalMenu.waitFor({ state: 'visible', timeout: 8000 })
    const bounds = await finalMenu.evaluate((element) => {
      const scrollRegion = element.closest('[data-panel-scroll-region]')
      const rect = (scrollRegion ?? element).getBoundingClientRect()
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        scrollHeight: scrollRegion?.scrollHeight ?? 0,
        clientHeight: scrollRegion?.clientHeight ?? 0,
      }
    })
    if (bounds.left < 0 || bounds.right > bounds.viewportWidth || bounds.top < 0 || bounds.bottom > bounds.viewportHeight) {
      throw new Error(`更多菜单超出视口：${JSON.stringify(bounds)}`)
    }
    if (bounds.clientHeight <= 0 || bounds.scrollHeight < bounds.clientHeight) {
      throw new Error(`更多菜单滚动区域无效：${JSON.stringify(bounds)}`)
    }
    await settlePage(page, 900)
  }

  async function setupCanvasPanoramaToolbar(page) {
    const fixture = await seedAndOpenCanvasPanoramaProject(page)
    const sourceNode = page.locator('.react-flow__node[data-id="__ui_panorama_source"]')
    await sourceNode.click()
    let panoramaAction = page.getByRole('button', { name: /^720°全景$/i }).filter({ visible: true }).first()
    if (!(await panoramaAction.count())) {
      await page.locator('[data-image-capability-more="true"]:visible').click()
      panoramaAction = page.getByRole('menuitem', { name: /720°全景/i }).filter({ visible: true }).first()
    }
    await panoramaAction.waitFor({ state: 'visible', timeout: 8000 })
    await panoramaAction.click()
    const generatedShell = page.locator('[data-generation-node-id][data-generation-node-model-id]').filter({ hasText: /720°全景/ }).last()
    await generatedShell.waitFor({ state: 'visible', timeout: 12000 })
    const generatedNode = generatedShell.locator('xpath=ancestor::*[contains(@class,"react-flow__node")][1]')
    const generatedNodeId = await generatedNode.getAttribute('data-id')
    if (!generatedNodeId || generatedNodeId === '__ui_panorama_source') {
      throw new Error('全景工具条未创建独立相邻节点')
    }
    await generatedNode.waitFor({ state: 'visible', timeout: 8000 })
    if (!(await generatedNode.evaluate((element) => element.classList.contains('selected')))) {
      throw new Error('全景工具条创建后未选中新节点')
    }
    if (await page.locator('[data-image-capability-more="true"]:visible').count()) {
      throw new Error('全景生成节点不应显示没有可执行内容的“更多”菜单')
    }
    await generatedShell.getByText(
      '生成一张完整、自然、可沉浸浏览的 360°×180° 等距柱状全景图，左右边缘无缝衔接。',
      { exact: true },
    ).waitFor({ state: 'visible', timeout: 8000 })
    const generatedModelId = await generatedShell.getAttribute('data-generation-node-model-id')
    if (generatedModelId === 'apimart-gpt-image-2') {
      const channelField = paramFieldFromLabel(generatedShell, /^(渠道|Channel)$/i)
      await channelField.waitFor({ state: 'visible', timeout: 8000 })
      await channelField.locator('[data-dropdown-button]').click()
      await page.getByRole('option', { name: /^(官方|Official)$/i }).filter({ visible: true }).first().click()
      await generatedShell.getByText(/^(画质|质量|Quality)$/i)
        .waitFor({ state: 'visible', timeout: 8000 })
    }
    await generatedShell.getByText(/^(分辨率|Resolution)$/i)
      .waitFor({ state: 'visible', timeout: 8000 })
    if (await generatedShell.getByText(/^(宽高比|Aspect Ratio)$/i).count()) {
      throw new Error('全景生成节点不应开放固定的 2:1 比例')
    }
    if (await page.locator('.react-flow__edge').count() < 1) {
      throw new Error('全景工具条未创建来源连线')
    }
    await settlePage(page, 800)
    return { ...fixture, generatedNodeId }
  }

  async function setupCanvasRelightEditor(page) {
    const { projectId } = await seedAndOpenCanvasPanoramaProject(page)
    const sourceNode = page.locator('.react-flow__node[data-id="__ui_panorama_source"]')
    await sourceNode.click()
    let relightAction = page.getByRole('button', { name: /^(打光|Relight)$/i })
      .filter({ visible: true }).first()
    if (!(await relightAction.count())) {
      await page.locator('[data-image-capability-more="true"]:visible').click()
      relightAction = page.getByRole('menuitem', { name: /^(打光|Relight)/i })
        .filter({ visible: true }).first()
    }
    await relightAction.waitFor({ state: 'visible', timeout: 8000 })
    await relightAction.click()

    const relightShell = page.locator('[data-relight-node-id][data-relight-mode="manual"]').last()
    await relightShell.waitFor({ state: 'visible', timeout: 12000 })
    const relightNodeId = await relightShell.getAttribute('data-relight-node-id')
    if (!relightNodeId) throw new Error('图片打光工具条未创建专用节点')
    if (await page.locator('.react-flow__edge').count() < 1) {
      throw new Error('图片打光工具条未创建源图连线')
    }

    await relightShell.getByRole('button', { name: /^(调整打光)$/i }).click()
    const editor = page.getByRole('dialog', { name: /^(图片打光)$/i })
    await editor.waitFor({ state: 'visible', timeout: 12000 })
    await editor.getByText('主光方向 · 离散偏好', { exact: true })
      .waitFor({ state: 'visible', timeout: 8000 })
    await editor.getByRole('button', { name: /智能打光/ }).click()
    await editor.getByRole('button', { name: /霓虹氛围/ }).click()
    await editor.getByPlaceholder('例如：在保留背景布局的前提下增强商品高光')
      .fill('保留主体与文字，只调整光照氛围')
    await editor.getByRole('button', { name: /^(应用设置)$/i }).click()
    await editor.waitFor({ state: 'hidden', timeout: 12000 })
    const smartRelightShell = page.locator(`[data-relight-node-id="${relightNodeId}"][data-relight-mode="smart"]`)
    await smartRelightShell.getByText(/智能 · neon/).waitFor({ state: 'visible', timeout: 8000 })

    await page.waitForTimeout(900)
    await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
    await settlePage(page, 500)
    const persisted = await page.evaluate(async ({ targetProjectId, targetNodeId }) => {
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json, edges_json FROM storyboard_projects WHERE id = ? LIMIT 1',
        [targetProjectId]
      )
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
      const edges = JSON.parse(rows[0]?.edges_json ?? '[]')
      const node = nodes.find((candidate) => candidate.id === targetNodeId)
      return {
        nodeType: node?.type,
        lightingMode: node?.data?.relightSettings?.lightingMode,
        preset: node?.data?.relightSettings?.smart?.preset,
        templateVersion: node?.data?.promptTemplateVersion,
        referenceCount: node?.data?.relightSettings?.smart?.lightingReferenceImages?.length,
        hasSourceEdge: edges.some((edge) => edge.source === '__ui_panorama_source' && edge.target === targetNodeId),
      }
    }, { targetProjectId: projectId, targetNodeId: relightNodeId })
    if (persisted.nodeType !== 'relightGenNode'
      || persisted.lightingMode !== 'smart'
      || persisted.preset !== 'neon'
      || persisted.templateVersion !== 'relight-smart-gpt-image-2-v1'
      || persisted.referenceCount !== 0
      || !persisted.hasSourceEdge) {
      throw new Error(`图片打光保存语义或连线丢失：${JSON.stringify(persisted)}`)
    }

    await page.locator(`[data-project-id="${projectId}"]:visible`).click()
    const reopened = page.locator(`[data-relight-node-id="${relightNodeId}"][data-relight-mode="smart"]`)
    await reopened.waitFor({ state: 'visible', timeout: 12000 })
    await reopened.getByRole('button', { name: /^(调整打光)$/i }).click()
    await editor.waitFor({ state: 'visible', timeout: 12000 })
    await editor.getByText('氛围预设 · 模型近似').waitFor({ state: 'visible', timeout: 8000 })
    await settlePage(page, 900)
  }

  async function setupCanvasMultiAngleEditor(page) {
    const { projectId } = await seedAndOpenCanvasPanoramaProject(page)
    const sourceNode = page.locator('.react-flow__node[data-id="__ui_panorama_source"]')
    await sourceNode.click()
    await page.waitForTimeout(350)
    await clickCanvasCapabilityAction(page, {
      directName: /^(多角度|Multi-angle)$/i,
      menuName: /^(多角度|Multi-angle)(?:\s|$)/i,
      missingMessage: '多角度工具入口不可见',
    })

    const shell = page.locator('[data-multi-angle-node-id][data-multi-angle-profile="continuous-v1"]').last()
    await shell.waitFor({ state: 'visible', timeout: 12000 })
    const nodeId = await shell.getAttribute('data-multi-angle-node-id')
    if (!nodeId) throw new Error('多角度工具条未创建专用节点')
    if (await page.locator('.react-flow__edge').count() < 1) throw new Error('多角度工具条未创建源图连线')
    if (await shell.locator('[contenteditable="true"], textarea').count()) {
      throw new Error('多角度节点不应显示伪提示词编辑器')
    }

    await shell.getByRole('button', { name: /^(调整角度)$/i }).click()
    const editor = page.getByRole('dialog', { name: /^(多角度视图)$/i })
    await editor.waitFor({ state: 'visible', timeout: 12000 })
    await editor.locator('[data-multi-angle-orbit="demand"] canvas').waitFor({ state: 'visible', timeout: 12000 })
    await editor.getByText(/不代表真实相机焦距/).waitFor({ state: 'visible', timeout: 8000 })
    if (await editor.locator('textarea, [contenteditable="true"]').count()) throw new Error('角度编辑器不应显示提示词')

    // 修改后取消，验证草稿不会污染节点。
    await editor.getByRole('slider', { name: /水平控制/ }).fill('20')
    await editor.getByRole('button', { name: /^(取消)$/i }).click()
    await editor.getByRole('button', { name: /^(放弃更改)$/i }).click()
    await editor.waitFor({ state: 'hidden', timeout: 12000 })
    if (await page.locator('[data-multi-angle-orbit="demand"] canvas').count()) {
      throw new Error('关闭多角度编辑器后 Three 画布未卸载')
    }

    await shell.getByRole('button', { name: /^(调整角度)$/i }).click()
    await editor.waitFor({ state: 'visible', timeout: 12000 })
    await editor.getByRole('button', { name: /完整方位/ }).click()
    await editor.getByRole('button', { name: /^顶视$/ }).click()
    await editor.getByRole('button', { name: /^(应用设置)$/i }).click()
    await editor.waitFor({ state: 'hidden', timeout: 12000 })
    await page.locator(`[data-multi-angle-node-id="${nodeId}"][data-multi-angle-profile="discrete-v1"]`)
      .waitFor({ state: 'visible', timeout: 8000 })

    await page.waitForTimeout(900)
    await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
    await settlePage(page, 500)
    const persisted = await page.evaluate(async ({ targetProjectId, targetNodeId }) => {
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json, edges_json FROM storyboard_projects WHERE id = ? LIMIT 1',
        [targetProjectId]
      )
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
      const edges = JSON.parse(rows[0]?.edges_json ?? '[]')
      const node = nodes.find((candidate) => candidate.id === targetNodeId)
      return {
        nodeType: node?.type,
        capabilityId: node?.data?.capabilityId,
        modelId: node?.data?.modelId,
        profile: node?.data?.multiAngleConfig?.controlProfile,
        viewCount: node?.data?.multiAngleConfig?.views?.length,
        hasTopDown: node?.data?.multiAngleConfig?.views?.some((view) => view.preset === 'top_down'),
        hasPrompt: Boolean(node?.data?.prompt),
        hasSourceEdge: edges.some((edge) => edge.source === '__ui_panorama_source' && edge.target === targetNodeId),
      }
    }, { targetProjectId: projectId, targetNodeId: nodeId })
    if (persisted.nodeType !== 'multiAngleGenNode'
      || persisted.capabilityId !== 'image.multi-angle'
      || persisted.modelId !== 'fal-perspective-change'
      || persisted.profile !== 'discrete-v1'
      || persisted.viewCount !== 5
      || !persisted.hasTopDown
      || persisted.hasPrompt
      || !persisted.hasSourceEdge) {
      throw new Error(`多角度保存语义或连线丢失：${JSON.stringify(persisted)}`)
    }

    await page.locator(`[data-project-id="${projectId}"]:visible`).click()
    const reopened = page.locator(`[data-multi-angle-node-id="${nodeId}"][data-multi-angle-profile="discrete-v1"]`)
    await reopened.waitFor({ state: 'visible', timeout: 12000 })
    await reopened.getByRole('button', { name: /^(调整角度)$/i }).click()
    await editor.waitFor({ state: 'visible', timeout: 12000 })
    await editor.getByRole('button', { name: /^顶视$/ }).waitFor({ state: 'visible', timeout: 8000 })
    await settlePage(page, 900)
  }

  async function setupCanvasUpscaleNode(page) {
    const { panoramaSource, projectId } = await seedAndOpenCanvasPanoramaProject(page)
    const sourceNode = page.locator('.react-flow__node[data-id="__ui_panorama_source"]')
    await sourceNode.click()
    await page.waitForTimeout(350)
    let upscaleAction = page.getByRole('button', { name: /^(高清|Upscale)$/i }).filter({ visible: true }).first()
    if (!(await upscaleAction.count())) {
      const moreButton = page.getByRole('button').filter({ hasText: /^(更多|More)$/i }).filter({ visible: true }).first()
      if (!(await moreButton.count())) {
        const labels = await page.getByRole('button').filter({ visible: true }).allTextContents()
        throw new Error(`高清工具入口不可见；当前按钮：${JSON.stringify(labels)}`)
      }
      await moreButton.click()
      upscaleAction = page.getByRole('button', { name: /^(高清|Upscale)$/i }).filter({ visible: true }).first()
    }
    await upscaleAction.waitFor({ state: 'visible', timeout: 8000 })
    await upscaleAction.click()

    const shell = page.locator('[data-generation-node-id][data-generation-node-model-id="fal-ai-topaz-image-upscale"]')
      .filter({ hasText: /高清放大|Upscale/ }).last()
    await shell.waitFor({ state: 'visible', timeout: 12000 })
    const node = shell.locator('xpath=ancestor::*[contains(@class,"react-flow__node")][1]')
    const nodeId = await node.getAttribute('data-id')
    if (!nodeId || nodeId === '__ui_panorama_source') throw new Error('高清工具条未创建独立相邻节点')
    if (!(await node.evaluate((element) => element.classList.contains('selected')))) {
      throw new Error('高清工具条创建后未选中新节点')
    }
    if (await page.locator('.react-flow__edge').count() < 1) {
      throw new Error('高清工具条未创建源图连线')
    }
    if (await shell.locator('[contenteditable="true"], textarea').count()) {
      throw new Error('忠实高清放大节点不应显示提示词编辑器')
    }
    await shell.getByText(/^(处理模式|Processing Mode)$/i).waitFor({ state: 'visible', timeout: 8000 })
    await shell.getByText(/^(放大倍率|Upscale Factor)$/i).waitFor({ state: 'visible', timeout: 8000 })
    await shell.getByText(/^(人脸增强|Face Enhancement)$/i).waitFor({ state: 'visible', timeout: 8000 })

    await page.waitForTimeout(900)
    await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
    await settlePage(page, 500)
    const persisted = await page.evaluate(async ({ targetProjectId, targetNodeId }) => {
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json, edges_json FROM storyboard_projects WHERE id = ? LIMIT 1',
        [targetProjectId]
      )
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
      const edges = JSON.parse(rows[0]?.edges_json ?? '[]')
      const target = nodes.find((candidate) => candidate.id === targetNodeId)
      return {
        nodeType: target?.type,
        capabilityId: target?.data?.capabilityId,
        modelId: target?.data?.modelId,
        factor: target?.data?.params?.falTopazUpscaleFactor,
        mode: target?.data?.params?.falTopazUpscaleModel,
        hasSourceEdge: edges.some((edge) => edge.source === '__ui_panorama_source' && edge.target === targetNodeId),
      }
    }, { targetProjectId: projectId, targetNodeId: nodeId })
    if (persisted.nodeType !== 'upscaleGenNode'
      || persisted.capabilityId !== 'image.upscale'
      || persisted.modelId !== 'fal-ai-topaz-image-upscale'
      || persisted.factor !== 2
      || persisted.mode !== 'High Fidelity V2'
      || !persisted.hasSourceEdge) {
      throw new Error(`高清放大保存语义或连线丢失：${JSON.stringify(persisted)}`)
    }

    // 不触发供应商请求：以确定性本地图片模拟一次成功输出，验证普通 image 结果和继续连接可持久化。
    await page.evaluate(async ({ targetProjectId, targetNodeId, resultSource }) => {
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json, edges_json FROM storyboard_projects WHERE id = ? LIMIT 1',
        [targetProjectId]
      )
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
      const edges = JSON.parse(rows[0]?.edges_json ?? '[]')
      const generator = nodes.find((candidate) => candidate.id === targetNodeId)
      nodes.push({
        id: '__ui_upscale_result',
        type: 'exportImageNode',
        position: { x: (generator?.position?.x ?? 720) + 430, y: generator?.position?.y ?? 80 },
        width: 384,
        height: 220,
        measured: { width: 384, height: 220 },
        style: { width: 384, height: 220 },
        data: {
          displayName: '高清结果（本地模拟）',
          resultKind: 'image',
          sourceCapabilityId: 'image.upscale',
          imageUrl: resultSource,
          previewImageUrl: resultSource,
          aspectRatio: '2:1',
          isGenerating: false,
        },
      })
      edges.push({
        id: `__ui_upscale_result_edge_${targetNodeId}`,
        source: targetNodeId,
        target: '__ui_upscale_result',
        sourceHandle: 'source',
        targetHandle: 'target',
      })
      await window.henjiNative.db.execute(
        'UPDATE storyboard_projects SET node_count = ?, nodes_json = ?, edges_json = ?, viewport_json = ? WHERE id = ?',
        [nodes.length, JSON.stringify(nodes), JSON.stringify(edges), JSON.stringify({ x: 80, y: 120, zoom: 0.62 }), targetProjectId]
      )
    }, { targetProjectId: projectId, targetNodeId: nodeId, resultSource: panoramaSource })

    await page.locator(`[data-project-id="${projectId}"]:visible`).click()
    await page.locator(`[data-generation-node-id="${nodeId}"][data-generation-node-model-id="fal-ai-topaz-image-upscale"]`)
      .waitFor({ state: 'visible', timeout: 12000 })
    const resultNode = page.locator('.react-flow__node[data-id="__ui_upscale_result"]')
    await resultNode.waitFor({ state: 'visible', timeout: 12000 })
    await resultNode.getByText('高清结果（本地模拟）').waitFor({ state: 'visible', timeout: 8000 })
    await page.mouse.move(1200, 700)
    await settlePage(page, 900)
  }

  async function setupCanvasPortraitTextureNode(page) {
    const { panoramaSource, projectId } = await seedAndOpenCanvasPanoramaProject(page)
    const sourceNode = page.locator('.react-flow__node[data-id="__ui_panorama_source"]')
    await sourceNode.click()
    await page.waitForTimeout(350)
    await clickCanvasCapabilityAction(page, {
      directName: /^(人像质感|Portrait Texture)$/i,
      menuName: /^(人像质感|Portrait Texture)(?:\s|$)/i,
      missingMessage: '人像质感工具入口不可见',
    })

    const shell = page.locator('[data-generation-node-id][data-generation-node-model-id="fal-ai-gpt-image-2"]')
      .filter({ hasText: /人像质感|Portrait Texture/ }).last()
    await shell.waitFor({ state: 'visible', timeout: 12000 })
    const node = shell.locator('xpath=ancestor::*[contains(@class,"react-flow__node")][1]')
    const nodeId = await node.getAttribute('data-id')
    if (!nodeId || nodeId === '__ui_panorama_source') throw new Error('人像质感工具条未创建独立相邻节点')
    if (!(await node.evaluate((element) => element.classList.contains('selected')))) {
      throw new Error('人像质感工具条创建后未选中新节点')
    }
    if (await page.locator('.react-flow__edge').count() < 1) throw new Error('人像质感工具条未创建源图连线')
    await shell.getByText(/^(质感预设|Finish preset)$/i).waitFor({ state: 'visible', timeout: 8000 })
    await shell.getByText(/^(处理强度|Edit strength)$/i).waitFor({ state: 'visible', timeout: 8000 })
    await shell.getByText(/未做人脸检测|No face detection/i).waitFor({ state: 'visible', timeout: 8000 })

    const presetField = paramFieldFromLabel(page, /^(质感预设|Finish preset)$/i)
    await presetField.locator('[data-dropdown-button]').click()
    await page.getByRole('option', { name: /^(柔和胶片|Soft film)$/i }).click()
    const strengthField = paramFieldFromLabel(page, /^(处理强度|Edit strength)$/i)
    await strengthField.locator('[data-dropdown-button]').click()
    await page.getByRole('option', { name: /^(适中|Balanced)$/i }).click()
    await settlePage(page, 900)

    await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
    await settlePage(page, 500)
    const persisted = await page.evaluate(async ({ targetProjectId, targetNodeId }) => {
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json, edges_json FROM storyboard_projects WHERE id = ? LIMIT 1',
        [targetProjectId]
      )
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
      const edges = JSON.parse(rows[0]?.edges_json ?? '[]')
      const target = nodes.find((candidate) => candidate.id === targetNodeId)
      return {
        nodeType: target?.type,
        capabilityId: target?.data?.capabilityId,
        modelId: target?.data?.modelId,
        preset: target?.data?.portraitTextureSettings?.preset,
        strength: target?.data?.portraitTextureSettings?.strength,
        templateVersion: target?.data?.promptTemplateVersion,
        hasSourceEdge: edges.some((edge) => edge.source === '__ui_panorama_source' && edge.target === targetNodeId),
      }
    }, { targetProjectId: projectId, targetNodeId: nodeId })
    if (persisted.nodeType !== 'portraitTextureGenNode'
      || persisted.capabilityId !== 'image.portrait-texture'
      || persisted.modelId !== 'fal-ai-gpt-image-2'
      || persisted.preset !== 'film-soft'
      || persisted.strength !== 'balanced'
      || persisted.templateVersion !== 'portrait-texture-gpt-image-2-v1'
      || !persisted.hasSourceEdge) {
      throw new Error(`人像质感保存语义或连线丢失：${JSON.stringify(persisted)}`)
    }

    // 不触发供应商请求：以确定性本地图片模拟成功输出，验证普通 image 语义与后续连接口。
    await page.evaluate(async ({ targetProjectId, targetNodeId, resultSource }) => {
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json, edges_json FROM storyboard_projects WHERE id = ? LIMIT 1',
        [targetProjectId]
      )
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
      const edges = JSON.parse(rows[0]?.edges_json ?? '[]')
      const generator = nodes.find((candidate) => candidate.id === targetNodeId)
      nodes.push({
        id: '__ui_portrait_texture_result',
        type: 'exportImageNode',
        position: { x: (generator?.position?.x ?? 720) + 430, y: generator?.position?.y ?? 80 },
        width: 384,
        height: 220,
        measured: { width: 384, height: 220 },
        style: { width: 384, height: 220 },
        data: {
          displayName: '人像质感结果（本地模拟）',
          resultKind: 'image',
          sourceCapabilityId: 'image.portrait-texture',
          imageUrl: resultSource,
          previewImageUrl: resultSource,
          aspectRatio: '2:1',
          isGenerating: false,
        },
      })
      edges.push({
        id: `__ui_portrait_texture_result_edge_${targetNodeId}`,
        source: targetNodeId,
        target: '__ui_portrait_texture_result',
        sourceHandle: 'source',
        targetHandle: 'target',
      })
      await window.henjiNative.db.execute(
        'UPDATE storyboard_projects SET node_count = ?, nodes_json = ?, edges_json = ?, viewport_json = ? WHERE id = ?',
        [nodes.length, JSON.stringify(nodes), JSON.stringify(edges), JSON.stringify({ x: 80, y: 120, zoom: 0.62 }), targetProjectId]
      )
    }, { targetProjectId: projectId, targetNodeId: nodeId, resultSource: panoramaSource })

    await page.locator(`[data-project-id="${projectId}"]:visible`).click()
    const reopened = page.locator(`[data-generation-node-id="${nodeId}"][data-generation-node-model-id="fal-ai-gpt-image-2"]`)
    await reopened.waitFor({ state: 'visible', timeout: 12000 })
    await reopened.getByText(/柔和胶片|Soft film/).waitFor({ state: 'visible', timeout: 8000 })
    const resultNode = page.locator('.react-flow__node[data-id="__ui_portrait_texture_result"]')
    await resultNode.waitFor({ state: 'visible', timeout: 12000 })
    await resultNode.getByText('人像质感结果（本地模拟）').waitFor({ state: 'visible', timeout: 8000 })
    await page.mouse.move(1200, 700)
    await settlePage(page, 900)
  }

  async function setupCanvasElementEditNode(page) {
    const { panoramaSource, projectId } = await seedAndOpenCanvasPanoramaProject(page)
    const sourceNode = page.locator('.react-flow__node[data-id="__ui_panorama_source"]')
    await sourceNode.click()
    await page.waitForTimeout(350)
    await clickCanvasCapabilityAction(page, {
      directName: /^(元素编辑|Element Edit)$/i,
      menuName: /^(元素编辑|Element Edit)/i,
      missingMessage: '元素编辑工具入口不可见',
    })

    const editor = page.getByRole('dialog', { name: /绘制局部重绘遮罩|Draw Inpainting Mask/i })
    await editor.waitFor({ state: 'visible', timeout: 12000 })
    const canvasRegion = editor.locator('[data-application-observation-region="mask_editor.canvas"]')
    const box = await canvasRegion.boundingBox()
    if (!box) throw new Error('元素编辑遮罩没有可绘制区域')
    await page.mouse.move(box.x + box.width * 0.36, box.y + box.height * 0.42)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.58, { steps: 10 })
    await page.mouse.up()
    await editor.getByRole('button', { name: /^(完成|Done)$/i }).click()
    await editor.waitFor({ state: 'hidden', timeout: 12000 })

    const shell = page.locator('[data-generation-node-id][data-generation-node-model-id="apimart-gpt-image-2"]')
      .filter({ hasText: /元素编辑|Element Edit/ }).last()
    await shell.waitFor({ state: 'visible', timeout: 12000 })
    const node = shell.locator('xpath=ancestor::*[contains(@class,"react-flow__node")][1]')
    const nodeId = await node.getAttribute('data-id')
    if (!nodeId || nodeId === '__ui_panorama_source') throw new Error('元素编辑工具条未创建独立相邻节点')
    if (!(await node.evaluate((element) => element.classList.contains('selected')))) {
      throw new Error('元素编辑工具条创建后未选中新节点')
    }
    if (await page.locator('.react-flow__edge').count() < 1) throw new Error('元素编辑工具条未创建源图连线')
    const prompt = shell.getByRole('textbox', { name: /描述要如何修改蒙版选区|Describe how to change the masked area/i })
    await prompt.waitFor({ state: 'visible', timeout: 8000 })
    await prompt.click()
    const activePrompt = shell.locator('[contenteditable="true"]').first()
    await activePrompt.waitFor({ state: 'visible', timeout: 8000 })
    await activePrompt.fill('将选区替换为柔和的云层')
    await activePrompt.blur()
    await settlePage(page, 800)

    await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
    await settlePage(page, 500)
    const persisted = await page.evaluate(async ({ targetProjectId, targetNodeId, source }) => {
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json, edges_json FROM storyboard_projects WHERE id = ? LIMIT 1',
        [targetProjectId]
      )
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
      const edges = JSON.parse(rows[0]?.edges_json ?? '[]')
      const target = nodes.find((candidate) => candidate.id === targetNodeId)
      const params = target?.data?.params ?? {}
      const maskKey = Object.keys(params).find((key) => key.endsWith('MaskUrl'))
      const maskValues = maskKey && Array.isArray(params[maskKey]) ? params[maskKey] : []
      const document = maskKey ? params[`__henjiDerivedMediaAuthoring__${maskKey}`] : null
      return {
        nodeType: target?.type,
        capabilityId: target?.data?.capabilityId,
        modelId: target?.data?.modelId,
        prompt: target?.data?.prompt,
        hasManagedMask: maskValues.length === 1 && typeof maskValues[0] === 'string' && maskValues[0] !== source,
        documentVersion: document?.version,
        documentSourceRef: document?.sourceRef,
        strokeCount: document?.strokes?.length ?? 0,
        hasSourceEdge: edges.some((edge) => edge.source === '__ui_panorama_source' && edge.target === targetNodeId),
      }
    }, { targetProjectId: projectId, targetNodeId: nodeId, source: panoramaSource })
    if (persisted.nodeType !== 'elementEditGenNode'
      || persisted.capabilityId !== 'image.element-edit'
      || persisted.modelId !== 'apimart-gpt-image-2'
      || persisted.prompt !== '将选区替换为柔和的云层'
      || !persisted.hasManagedMask
      || persisted.documentVersion !== 1
      || !String(persisted.documentSourceRef ?? '').startsWith('__img_ref__:')
      || persisted.strokeCount < 1
      || !persisted.hasSourceEdge) {
      throw new Error(`元素编辑保存语义或连线丢失：${JSON.stringify(persisted)}`)
    }

    await page.evaluate(async ({ targetProjectId, targetNodeId, resultSource }) => {
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json, edges_json FROM storyboard_projects WHERE id = ? LIMIT 1',
        [targetProjectId]
      )
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
      const edges = JSON.parse(rows[0]?.edges_json ?? '[]')
      const generator = nodes.find((candidate) => candidate.id === targetNodeId)
      nodes.push({
        id: '__ui_element_edit_result', type: 'exportImageNode',
        position: { x: (generator?.position?.x ?? 720) + 430, y: generator?.position?.y ?? 80 },
        width: 384, height: 220, measured: { width: 384, height: 220 }, style: { width: 384, height: 220 },
        data: {
          displayName: '元素编辑结果（本地模拟）', resultKind: 'image', sourceCapabilityId: 'image.element-edit',
          imageUrl: resultSource, previewImageUrl: resultSource, aspectRatio: '2:1', isGenerating: false,
        },
      })
      edges.push({
        id: `__ui_element_edit_result_edge_${targetNodeId}`,
        source: targetNodeId, target: '__ui_element_edit_result', sourceHandle: 'source', targetHandle: 'target',
      })
      await window.henjiNative.db.execute(
        'UPDATE storyboard_projects SET node_count = ?, nodes_json = ?, edges_json = ?, viewport_json = ? WHERE id = ?',
        [nodes.length, JSON.stringify(nodes), JSON.stringify(edges), JSON.stringify({ x: 80, y: 120, zoom: 0.62 }), targetProjectId]
      )
    }, { targetProjectId: projectId, targetNodeId: nodeId, resultSource: panoramaSource })

    await page.locator(`[data-project-id="${projectId}"]:visible`).click()
    const reopened = page.locator(`[data-generation-node-id="${nodeId}"][data-generation-node-model-id="apimart-gpt-image-2"]`)
    await reopened.waitFor({ state: 'visible', timeout: 12000 })
    await page.locator('.react-flow__node[data-id="__ui_element_edit_result"]')
      .getByText('元素编辑结果（本地模拟）').waitFor({ state: 'visible', timeout: 8000 })
    await node.click()
    const editButton = page.getByRole('button', { name: /^(编辑|Edit)$/i }).filter({ visible: true }).first()
    await editButton.click()
    await editor.waitFor({ state: 'visible', timeout: 12000 })
    await settlePage(page, 900)
  }

  async function setupCanvasLayerStack(page) {
    const { panoramaSource, projectId } = await seedAndOpenCanvasPanoramaProject(page)
    const completionId = 'generation-output:__ui_layer_stack_result'
    let hash = 2166136261
    for (let index = 0; index < completionId.length; index += 1) {
      hash ^= completionId.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
    const stackId = `layer-stack:${(hash >>> 0).toString(36)}`
    await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
    // 离开画布会异步保存当前节点；必须等保存收口后再注入图层夹具，
    // 否则旧的 source-only 快照会把刚写入 SQLite 的图层结果覆盖掉。
    await settlePage(page, 700)
    await page.evaluate(async ({ targetProjectId, source, stackId, completionId }) => {
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json, edges_json FROM storyboard_projects WHERE id = ? LIMIT 1',
        [targetProjectId]
      )
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
      const edges = JSON.parse(rows[0]?.edges_json ?? '[]')
      const layerResourceId = `${stackId}:resource:0`
      const document = {
        version: 1, stackId, status: 'ready',
        source: { capabilityId: 'image.layer-separation', sourceNodeId: '__ui_panorama_source', inputResourceId: source, providerId: 'volcengine', modelId: 'volcengine-seedream-5.0-pro', completionId },
        canvas: { width: 1600, height: 800, colorSpace: 'srgb', alphaMode: 'straight', compositeOperation: 'source-over', clipPolicy: 'canvas-bounds' },
        compositeResourceId: `${stackId}:composite`, thumbnailResourceId: `${stackId}:thumbnail`,
        layers: [{ version: 1, layerId: `${stackId}:layer:0`, sourceOutputIndex: 0, providerZIndex: 0, order: 0, role: 'base', name: '本地模拟底图', resourceId: layerResourceId, placement: { x: 0, y: 0, width: 1600, height: 800 }, opacity: 1, visible: true, blendMode: 'normal', alpha: 'opaque' }],
        resources: [
          { version: 1, resourceId: layerResourceId, status: 'ready', filePath: source, mimeType: 'image/png', width: 1600, height: 800, hasAlpha: false, byteLength: null, sha256: 'ui-base' },
          { version: 1, resourceId: `${stackId}:composite`, status: 'ready', filePath: source, mimeType: 'image/png', width: 1600, height: 800, hasAlpha: true, byteLength: null, sha256: 'ui-composite' },
          { version: 1, resourceId: `${stackId}:thumbnail`, status: 'ready', filePath: source, mimeType: 'image/png', width: 1600, height: 800, hasAlpha: false, byteLength: null, sha256: 'ui-thumbnail' },
        ],
      }
      nodes.push({
        id: '__ui_layer_stack_result', type: 'layerStackResultNode', position: { x: 720, y: 80 },
        width: 520, height: 300, measured: { width: 520, height: 300 }, style: { width: 520, height: 300 },
        data: { displayName: '图层结果（本地模拟）', imageUrl: source, previewImageUrl: source, aspectRatio: '2:1', resultKind: 'layer-stack', layerStackDocument: document, isGenerating: false },
      })
      edges.push({ id: '__ui_layer_stack_edge', source: '__ui_panorama_source', target: '__ui_layer_stack_result', sourceHandle: 'source', targetHandle: 'target' })
      await window.henjiNative.db.execute(
        'UPDATE storyboard_projects SET node_count = ?, nodes_json = ?, edges_json = ?, viewport_json = ? WHERE id = ?',
        [nodes.length, JSON.stringify(nodes), JSON.stringify(edges), JSON.stringify({ x: 50, y: 120, zoom: 0.7 }), targetProjectId]
      )
    }, { targetProjectId: projectId, source: panoramaSource, stackId, completionId })
    await page.locator(`[data-project-id="${projectId}"]:visible`).click()
    const result = page.locator('[data-layer-stack-node-id="__ui_layer_stack_result"][data-layer-stack-status="ready"]')
    await result.waitFor({ state: 'visible', timeout: 12000 })
    await result.getByRole('button', { name: /^图层$/ }).click()
    const editor = page.getByRole('dialog', { name: /^图层 · 1$/ })
    await editor.waitFor({ state: 'visible', timeout: 12000 })
    await editor.getByText('本地模拟底图').waitFor({ state: 'visible', timeout: 8000 })
    await editor.getByRole('button', { name: /^合成$/ }).waitFor({ state: 'visible', timeout: 8000 })
    await settlePage(page, 900)
  }

  async function setupCanvasNineGrid(page) {
    const { projectId } = await seedAndOpenCanvasPanoramaProject(page)
    const sourceNode = page.locator('.react-flow__node[data-id="__ui_panorama_source"]')
    await sourceNode.click()
    await page.waitForTimeout(350)

    await clickCanvasCapabilityAction(page, {
      directName: /^(九宫格|Nine-grid)$/i,
      menuName: /^(九宫格|Nine-grid)(?:\s|$)/i,
      missingMessage: '九宫格工具入口不可见',
    })

    const presetShell = page.locator('[data-storyboard-preset="nine-grid-v1"]').last()
    await presetShell.waitFor({ state: 'visible', timeout: 12000 })
    const storyboardNode = presetShell.locator('xpath=ancestor::*[contains(@class,"react-flow__node")][1]')
    const storyboardNodeId = await storyboardNode.getAttribute('data-id')
    if (!storyboardNodeId || storyboardNodeId === '__ui_panorama_source') {
      throw new Error('九宫格入口未复用现有分镜生成节点创建相邻预设')
    }
    if (!(await storyboardNode.evaluate((element) => element.classList.contains('selected')))) {
      throw new Error('九宫格入口创建后未选中新节点')
    }
    await presetShell.getByText(/固定 3×3/).waitFor({ state: 'visible', timeout: 8000 })
    for (const label of ['行数减少', '行数增加', '列数减少', '列数增加']) {
      const control = presetShell.getByRole('button', { name: label })
      if (!(await control.isDisabled())) throw new Error(`固定九宫格仍允许修改：${label}`)
    }
    if (await page.locator('.react-flow__edge').count() < 1) throw new Error('九宫格工具条未创建源图连线')

    // 不触发任何供应商请求；在同一真实 Electron 场景中执行现有本地宫格切分。
    await sourceNode.click()
    await page.waitForTimeout(350)
    await clickCanvasCapabilityAction(page, {
      directName: /^(宫格切分|Grid Split)$/i,
      menuName: /^(宫格切分|Grid Split)(?:\s|$)/i,
      missingMessage: '宫格切分工具入口不可见',
    })
    const splitDialog = page.getByRole('dialog', { name: /切割工具|Split.*tool/i })
    await splitDialog.waitFor({ state: 'visible', timeout: 12000 })
    await splitDialog.getByText(/输出小格数量/).waitFor({ state: 'visible', timeout: 8000 })
    await splitDialog.getByText('9', { exact: true }).last().waitFor({ state: 'visible', timeout: 8000 })
    await splitDialog.getByRole('button', { name: /^(应用|Apply)$/i }).click()
    await splitDialog.waitFor({ state: 'hidden', timeout: 30000 })

    const group = page.locator('.react-flow__node').filter({ hasText: /宫格切分 · 3×3/ }).last()
    await group.waitFor({ state: 'visible', timeout: 30000 })
    await group.locator('[data-asset-group-preview-count="9"]').waitFor({ state: 'visible', timeout: 12000 })

    await page.waitForTimeout(900)
    await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
    await settlePage(page, 500)
    const persisted = await page.evaluate(async ({ targetProjectId, targetNodeId }) => {
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json, edges_json FROM storyboard_projects WHERE id = ? LIMIT 1',
        [targetProjectId]
      )
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
      const edges = JSON.parse(rows[0]?.edges_json ?? '[]')
      const target = nodes.find((candidate) => candidate.id === targetNodeId)
      const groups = nodes.filter((candidate) => candidate.type === 'assetGroupNode')
      const splitGroup = groups.find((candidate) => candidate.data?.displayName === '宫格切分 · 3×3')
      const members = splitGroup ? nodes.filter((candidate) => candidate.parentId === splitGroup.id) : []
      return {
        nodeType: target?.type,
        capabilityId: target?.data?.capabilityId,
        preset: target?.data?.storyboardPreset,
        templateVersion: target?.data?.promptTemplateVersion,
        rows: target?.data?.gridRows,
        cols: target?.data?.gridCols,
        frameCount: target?.data?.frames?.length,
        hasSourceEdge: edges.some((edge) => edge.source === '__ui_panorama_source' && edge.target === targetNodeId),
        groupCount: groups.length,
        memberCount: members.length,
        memberOrderCount: splitGroup?.data?.memberOrder?.length,
      }
    }, { targetProjectId: projectId, targetNodeId: storyboardNodeId })
    if (persisted.nodeType !== 'storyboardGenNode'
      || persisted.capabilityId !== 'image.nine-grid'
      || persisted.preset !== 'nine-grid-v1'
      || persisted.templateVersion !== 'nine-grid-storyboard-v1'
      || persisted.rows !== 3
      || persisted.cols !== 3
      || persisted.frameCount !== 9
      || !persisted.hasSourceEdge
      || persisted.groupCount !== 1
      || persisted.memberCount !== 9
      || persisted.memberOrderCount !== 9) {
      throw new Error(`九宫格或宫格切分保存语义丢失：${JSON.stringify(persisted)}`)
    }

    await page.locator(`[data-project-id="${projectId}"]:visible`).click()
    await page.locator(`[data-storyboard-preset="nine-grid-v1"]`).waitFor({ state: 'visible', timeout: 12000 })
    await page.locator('[data-asset-group-preview-count="9"]').waitFor({ state: 'visible', timeout: 12000 })
    await page.mouse.move(1200, 700)
    await settlePage(page, 900)
  }

  async function setupCanvasPanoramaViewer(page) {
    const { generatedNodeId, projectId } = await setupCanvasPanoramaToolbar(page)
    await page.waitForTimeout(900)
    await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
    await settlePage(page, 500)
    await page.evaluate(async (payload) => {
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json FROM storyboard_projects WHERE id = ? LIMIT 1',
        [payload.projectId]
      )
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]').map((node) => {
        if (node.id !== '__ui_panorama_result') return node
        const { height: _height, measured: _measured, ...rest } = node
        return {
          ...rest,
          type: 'panoramaViewerNode',
          hidden: false,
          width: 448,
          style: { width: 448 },
          data: {
            ...node.data,
            displayName: '全景查看',
            resultKind: 'panorama',
            viewMode: 'sphere',
            viewportAspectRatio: '16:9',
            cameraView: { yaw: 0, pitch: 0, fov: 70 },
          },
        }
      })
      const primary = nodes.find((node) => node.id === '__ui_panorama_result')
      if (!primary) throw new Error('全景节点场景缺少专用结果 fixture')
      if (!nodes.some((node) => node.id === '__ui_panorama_result_secondary')) {
        nodes.push({
          ...primary,
          id: '__ui_panorama_result_secondary',
          hidden: false,
          position: { x: 2060, y: 900 },
          data: { ...primary.data, displayName: '全景查看·次节点' },
        })
      }
      await window.henjiNative.db.execute(
        'UPDATE storyboard_projects SET nodes_json = ?, viewport_json = ? WHERE id = ?',
        [JSON.stringify(nodes), JSON.stringify({ x: -920, y: -510, zoom: 0.82 }), payload.projectId]
      )
    }, { projectId })
    await page.locator(`[data-project-id="${projectId}"]:visible`).click()
    const resultNode = page.locator('.react-flow__node[data-id="__ui_panorama_result"]')
    const secondaryResultNode = page.locator('.react-flow__node[data-id="__ui_panorama_result_secondary"]')
    await resultNode.waitFor({ state: 'visible', timeout: 12000 })
    await secondaryResultNode.waitFor({ state: 'visible', timeout: 12000 })
    const inlineViewer = resultNode.locator('[data-panorama-viewer-node-id="__ui_panorama_result"]')
    const secondaryInlineViewer = secondaryResultNode.locator('[data-panorama-viewer-node-id="__ui_panorama_result_secondary"]')
    await inlineViewer.waitFor({ state: 'visible', timeout: 12000 })
    await secondaryInlineViewer.waitFor({ state: 'visible', timeout: 12000 })

    // 选中时只保留通用工具条，全景派生能力和“更多”不能重复出现。
    await resultNode.click({ position: { x: 20, y: 20 } })
    await page.waitForTimeout(320)
    if (await page.locator('[data-image-capability-more="true"]:visible').count()) {
      throw new Error('全景查看节点顶部仍显示图片能力“更多”')
    }
    if (await page.locator('[data-image-capability-id]:visible').count()) {
      throw new Error('全景查看节点顶部仍重复显示图片派生能力')
    }

    const activeInlineCanvases = page.locator(
      '[data-panorama-inline-surface] [data-panorama-surface="sphere"] canvas'
    )
    const primarySurface = inlineViewer.locator('[data-panorama-inline-surface]')
    const secondarySurface = secondaryInlineViewer.locator('[data-panorama-inline-surface]')
    const initialPreview = primarySurface.locator('img[data-panorama-frozen-preview="true"]')
    await initialPreview.waitFor({ state: 'visible', timeout: 12000 })
    await page.waitForFunction(() => (
      document.querySelectorAll('[data-panorama-inline-surface] [data-panorama-surface="sphere"] canvas').length === 0
    ), undefined, { timeout: 8000 })
    const initialPreviewFrame = await primarySurface.screenshot({ animations: 'disabled' })
    await page.mouse.move(20, 80)
    await primarySurface.hover()
    const primarySphere = primarySurface.locator('[data-panorama-surface="sphere"] canvas')
    await primarySphere.waitFor({ state: 'visible', timeout: 12000 })
    await primarySurface.locator('[data-panorama-transition-preview="true"]')
      .waitFor({ state: 'detached', timeout: 8000 })
    const initialSphereFrame = await primarySurface.screenshot({ animations: 'disabled' })
    const initialPreviewDiff = await diffBuffers(initialPreviewFrame, initialSphereFrame)
    if (initialPreviewDiff.changedPct > 1) {
      throw new Error(`全景结果初始预览不是默认球面视角：变化像素 ${initialPreviewDiff.changedPct}%`)
    }
    if (await activeInlineCanvases.count() > 1) throw new Error('全景节点内嵌 WebGL Canvas 超过 1 个')
    await secondarySurface.hover()
    await secondarySurface.locator('[data-panorama-surface="sphere"] canvas')
      .waitFor({ state: 'visible', timeout: 12000 })
    if (await activeInlineCanvases.count() > 1) throw new Error('租约切换后全景内嵌 Canvas 超过 1 个')
    await primarySurface.hover()
    await primarySphere.waitFor({ state: 'visible', timeout: 12000 })
    await primarySurface.locator('[data-panorama-transition-preview="true"]')
      .waitFor({ state: 'detached', timeout: 8000 })

    await page.waitForTimeout(240)
    const contextLossResult = await primarySphere.evaluate((canvas) => {
      const event = new WebGLContextEvent('webglcontextlost', {
        cancelable: true,
        statusMessage: 'Reality 主动模拟上下文丢失',
      })
      canvas.dispatchEvent(event)
      return { defaultPrevented: event.defaultPrevented }
    })
    if (!contextLossResult.defaultPrevented) throw new Error('WebGL context lost 事件未执行 preventDefault')
    await primarySphere.waitFor({ state: 'detached', timeout: 8000 })
    await primarySurface.locator('img').waitFor({ state: 'visible', timeout: 8000 })
    if (await activeInlineCanvases.count()) throw new Error('WebGL context lost 后仍保留内嵌 Canvas')
    await resultNode.getByRole('button', { name: /^(球面|Sphere)$/i }).click()
    await primarySphere.waitFor({ state: 'visible', timeout: 12000 })
    await page.waitForTimeout(240)

    // 节点内第一次指针手势就直接环视，不得带动节点或 ReactFlow 视口。
    const nodeBoxBeforeDrag = await resultNode.boundingBox()
    const viewportTransformBeforeDrag = await page.locator('.react-flow__viewport').getAttribute('style')
    const inlineBox = await primarySphere.boundingBox()
    if (!nodeBoxBeforeDrag || !inlineBox) throw new Error('全景节点内没有可交互球面区域')
    await page.mouse.move(inlineBox.x + inlineBox.width * 0.45, inlineBox.y + inlineBox.height * 0.44)
    await page.mouse.down()
    await page.mouse.move(inlineBox.x + inlineBox.width * 0.62, inlineBox.y + inlineBox.height * 0.61, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(280)
    const nodeBoxAfterDrag = await resultNode.boundingBox()
    const viewportTransformAfterDrag = await page.locator('.react-flow__viewport').getAttribute('style')
    if (!nodeBoxAfterDrag
      || Math.abs(nodeBoxAfterDrag.x - nodeBoxBeforeDrag.x) > 1
      || Math.abs(nodeBoxAfterDrag.y - nodeBoxBeforeDrag.y) > 1) {
      throw new Error('节点内环视错误带动了节点位置')
    }
    if (viewportTransformAfterDrag !== viewportTransformBeforeDrag) {
      throw new Error('节点内环视错误带动了 ReactFlow 视口')
    }

    // 指针移出后释放 WebGL，但节点必须冻结在刚才停下的视角，不能回退到原始全景图。
    const interactiveFrame = await primarySurface.screenshot({ animations: 'disabled' })
    await page.mouse.move(20, 80)
    await page.waitForFunction(() => (
      document.querySelectorAll('[data-panorama-inline-surface] [data-panorama-surface="sphere"] canvas').length === 0
    ), undefined, { timeout: 8000 })
    const frozenPreview = primarySurface.locator('img[data-panorama-frozen-preview="true"]')
    await frozenPreview.waitFor({ state: 'visible', timeout: 8000 })
    const frozenFrame = await primarySurface.screenshot({ animations: 'disabled' })
    const frozenFrameDiff = await diffBuffers(interactiveFrame, frozenFrame)
    if (frozenFrameDiff.changedPct > 1) {
      throw new Error(`全景冻结帧不是所见即所得：变化像素 ${frozenFrameDiff.changedPct}%`)
    }
    if (await activeInlineCanvases.count()) throw new Error('指针移出全景节点后仍保留内嵌 WebGL Canvas')

    // 项目重开后直接显示上次冻结视角，并从同一相机状态继续交互。
    await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
    await settlePage(page, 500)
    await page.locator(`[data-project-id="${projectId}"]:visible`).click()
    await resultNode.waitFor({ state: 'visible', timeout: 12000 })
    await frozenPreview.waitFor({ state: 'visible', timeout: 12000 })
    const reopenedFrozenFrame = await primarySurface.screenshot({ animations: 'disabled' })
    const reopenedFrozenDiff = await diffBuffers(frozenFrame, reopenedFrozenFrame)
    if (reopenedFrozenDiff.changedPct > 1) {
      throw new Error(`项目重开后没有恢复上次全景预览：变化像素 ${reopenedFrozenDiff.changedPct}%`)
    }
    await page.mouse.move(20, 80)
    await primarySurface.hover()
    await primarySphere.waitFor({ state: 'visible', timeout: 12000 })
    await primarySurface.locator('[data-panorama-transition-preview="true"]')
      .waitFor({ state: 'detached', timeout: 8000 })
    const reopenedSphereFrame = await primarySurface.screenshot({ animations: 'disabled' })
    const reopenedSphereDiff = await diffBuffers(frozenFrame, reopenedSphereFrame)
    if (reopenedSphereDiff.changedPct > 1) {
      throw new Error(`项目重开后全景相机没有从上次视角继续：变化像素 ${reopenedSphereDiff.changedPct}%`)
    }

    const flatButton = resultNode.getByRole('button', { name: /^(平面|Flat)$/i })
    const sphereButton = resultNode.getByRole('button', { name: /^(球面|Sphere)$/i })
    await flatButton.click()
    await primarySurface.locator('img').waitFor({ state: 'visible', timeout: 8000 })
    if (await primarySphere.count()) throw new Error('平面模式仍保留全景 WebGL Canvas')
    await sphereButton.click()
    await primarySphere.waitFor({ state: 'visible', timeout: 12000 })

    const viewportRatioButton = resultNode.getByRole('button', { name: /^(视口比例|Viewport ratio)$/i })
    await viewportRatioButton.click()
    const visibleRatioOptions = page.locator('[data-dropdown-portal="true"] [role="option"]:visible')
    const ratioLabels = await visibleRatioOptions.evaluateAll((elements) => (
      elements.map((element) => element.textContent?.trim()).filter(Boolean)
    ))
    const expectedRatioLabels = ['21:9', '16:9', '3:2', '4:3', '1:1']
    if (JSON.stringify(ratioLabels) !== JSON.stringify(expectedRatioLabels)) {
      throw new Error(`全景视口比例选项不符合五档约定：${JSON.stringify(ratioLabels)}`)
    }
    await page.getByRole('option', { name: '4:3', exact: true }).click()
    await page.waitForFunction(() => (
      document.querySelector('[data-panorama-viewer-node-id="__ui_panorama_result"]')
        ?.getAttribute('data-panorama-viewport-ratio') === '4:3'
    ))

    const exportNodeIdsBeforeCapture = await page.locator('.react-flow__node-exportImageNode')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-id')).filter(Boolean))
    await resultNode.getByRole('button', { name: /^(截取视角|Capture view)$/i }).click()
    await page.waitForFunction((knownIds) => (
      Array.from(document.querySelectorAll('.react-flow__node-exportImageNode'))
        .some((element) => !knownIds.includes(element.getAttribute('data-id')))
    ), exportNodeIdsBeforeCapture, { timeout: 20000 })
    const snapshotNodeId = await page.locator('.react-flow__node-exportImageNode')
      .evaluateAll((elements, knownIds) => (
        elements.map((element) => element.getAttribute('data-id'))
          .find((nodeId) => nodeId && !knownIds.includes(nodeId)) ?? null
      ), exportNodeIdsBeforeCapture)
    if (!snapshotNodeId) throw new Error('截取视角未创建普通图片节点')

    // 节点内交互完成后，双击仍可进入沉浸式查看器。
    await primarySurface.hover()
    await primarySphere.waitFor({ state: 'visible', timeout: 12000 })
    await primarySurface.dblclick({ position: { x: 80, y: 80 } })

    const viewer = page.locator('[data-panorama-viewer="true"]')
    await viewer.waitFor({ state: 'visible', timeout: 12000 })
    const sphere = viewer.locator('[data-panorama-surface="sphere"] canvas')
    await sphere.waitFor({ state: 'visible', timeout: 12000 })
    await page.mouse.wheel(0, -180)

    await viewer.getByRole('button', { name: /^(平面|Flat)$/i }).click()
    await viewer.locator('[data-panorama-surface="flat"]').waitFor({ state: 'visible', timeout: 8000 })
    await viewer.getByRole('button', { name: /^(球面|Sphere)$/i }).click()
    await sphere.waitFor({ state: 'visible', timeout: 8000 })
    await viewer.getByTitle(/^(重置视图|Reset View)$/i).click()

    await viewer.getByTitle(/^(关闭|Close)$/i).click()
    await viewer.waitFor({ state: 'hidden', timeout: 8000 })
    const downloadDir = await page.evaluate(async () => {
      const root = await window.henjiNative.paths.tempDir()
      const target = await window.henjiNative.paths.join(root, `henji-panorama-ui-${Date.now()}`)
      await window.henjiNative.fs.mkdir(target, { recursive: true })
      localStorage.setItem('enable_quick_download', 'true')
      localStorage.setItem('quick_download_path', target)
      return target
    })
    await resultNode.click()
    await page.getByRole('button', { name: /^(下载|Download)$/i }).filter({ visible: true }).first().click()
    let downloadedPath = null
    for (let attempt = 0; attempt < 30; attempt += 1) {
      downloadedPath = await page.evaluate(async (targetDir) => {
        const entries = await window.henjiNative.fs.readDir(targetDir)
        const file = entries.find((entry) => !entry.isDirectory && /\.png$/i.test(entry.name))
        return file ? await window.henjiNative.paths.join(targetDir, file.name) : null
      }, downloadDir)
      if (downloadedPath) break
      await page.waitForTimeout(200)
    }
    if (!downloadedPath) throw new Error('全景快速下载未落盘')
    const downloadedMetadata = await page.evaluate(
      async (source) => await window.henjiNative.image.readPanoramaImageMetadata(source),
      downloadedPath
    )
    if (downloadedMetadata.status !== 'valid' || downloadedMetadata.metadata?.projectionType !== 'equirectangular') {
      throw new Error(`全景下载文件 GPano 往返失败：${JSON.stringify(downloadedMetadata)}`)
    }

    const packageRoundTrip = await page.evaluate(async ({ targetDir, mediaPath }) => {
      const packagePath = await window.henjiNative.paths.join(targetDir, 'panorama-roundtrip.henjiproj')
      const packageMediaPath = 'media/1-panorama.png'
      const manifest = {
        formatVersion: 1,
        app: 'henji-ai',
        nodes: [{
          id: '__ui_panorama_package_result',
          type: 'exportImageNode',
          position: { x: 0, y: 0 },
          data: { imageUrl: packageMediaPath, resultKind: 'panorama', aspectRatio: '2:1' },
        }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }
      await window.henjiNative.projectPackage.exportProjectPackage(
        JSON.stringify(manifest),
        [{ srcPath: mediaPath, packagePath: packageMediaPath }],
        packagePath
      )
      const imported = await window.henjiNative.projectPackage.importProjectPackage(packagePath)
      const importedManifest = JSON.parse(imported.manifestJson)
      const importedMediaPath = imported.pathMap[packageMediaPath]
      const importedMetadata = importedMediaPath
        ? await window.henjiNative.image.readPanoramaImageMetadata(importedMediaPath)
        : null
      return {
        resultKind: importedManifest.nodes?.[0]?.data?.resultKind,
        importedMediaPath,
        metadataStatus: importedMetadata?.status,
      }
    }, { targetDir: downloadDir, mediaPath: downloadedPath })
    if (packageRoundTrip.resultKind !== 'panorama'
      || !packageRoundTrip.importedMediaPath
      || packageRoundTrip.metadataStatus !== 'valid') {
      throw new Error(`全景项目包导出导入往返失败：${JSON.stringify(packageRoundTrip)}`)
    }

    await page.waitForTimeout(900)
    await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
    await settlePage(page, 600)
    const persisted = await page.evaluate(async (payload) => {
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json, edges_json, history_json FROM storyboard_projects WHERE id = ? LIMIT 1',
        [payload.projectId]
      )
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
      const edges = JSON.parse(rows[0]?.edges_json ?? '[]')
      const history = JSON.parse(rows[0]?.history_json ?? '{}')
      const primary = nodes.find((node) => node.id === '__ui_panorama_result')
      const secondary = nodes.find((node) => node.id === '__ui_panorama_result_secondary')
      const snapshot = nodes.find((node) => node.id === payload.snapshotNodeId)
      const snapshotSourceRef = snapshot?.data?.imageUrl
      const snapshotSourceIndex = typeof snapshotSourceRef === 'string' && snapshotSourceRef.startsWith('__img_ref__:')
        ? Number.parseInt(snapshotSourceRef.slice('__img_ref__:'.length), 10)
        : null
      const snapshotSource = Number.isInteger(snapshotSourceIndex)
        ? history.imagePool?.[snapshotSourceIndex]
        : snapshotSourceRef
      return {
        hasGeneratedNode: nodes.some((node) => node.id === payload.generatedNodeId && node.type === 'panoramaGenNode'),
        primaryType: primary?.type,
        secondaryType: secondary?.type,
        resultKind: primary?.data?.resultKind,
        viewMode: primary?.data?.viewMode,
        viewportAspectRatio: primary?.data?.viewportAspectRatio,
        cameraView: primary?.data?.cameraView,
        snapshotType: snapshot?.type,
        snapshotResultKind: snapshot?.data?.resultKind,
        snapshotAspectRatio: snapshot?.data?.aspectRatio,
        snapshotSource,
        hasSnapshotEdge: edges.some((edge) => (
          edge.source === '__ui_panorama_result' && edge.target === payload.snapshotNodeId
        )),
        edgeCount: edges.length,
      }
    }, { generatedNodeId, projectId, snapshotNodeId })
    if (!persisted.hasGeneratedNode
      || persisted.primaryType !== 'panoramaViewerNode'
      || persisted.secondaryType !== 'panoramaViewerNode'
      || persisted.resultKind !== 'panorama'
      || persisted.viewMode !== 'sphere'
      || persisted.viewportAspectRatio !== '4:3'
      || !(persisted.cameraView?.yaw > 0)
      || !(persisted.cameraView?.pitch > 0)
      || persisted.snapshotType !== 'exportImageNode'
      || persisted.snapshotResultKind !== 'image'
      || persisted.snapshotAspectRatio !== '4:3'
      || !persisted.snapshotSource
      || !persisted.hasSnapshotEdge
      || persisted.edgeCount < 2) {
      throw new Error(`全景项目保存语义或连线丢失：${JSON.stringify(persisted)}`)
    }
    const snapshotInfo = await page.evaluate(
      async (source) => await window.henjiNative.image.readImageInfo(source),
      persisted.snapshotSource
    )
    if (snapshotInfo.width !== 960 || snapshotInfo.height !== 720) {
      throw new Error(`4:3 全景视角截图尺寸错误：${snapshotInfo.width}×${snapshotInfo.height}`)
    }

    await page.locator(`[data-project-id="${projectId}"]:visible`).click()
    const reopenedResult = page.locator('.react-flow__node[data-id="__ui_panorama_result"]')
    await reopenedResult.waitFor({ state: 'visible', timeout: 12000 })
    await page.locator(`.react-flow__node[data-id="${generatedNodeId}"]`).waitFor({ state: 'visible', timeout: 12000 })
    const reopenedInlineViewer = reopenedResult.locator('[data-panorama-viewer-node-id="__ui_panorama_result"]')
    if (await reopenedInlineViewer.getAttribute('data-panorama-viewport-ratio') !== '4:3') {
      throw new Error('重开后全景视口比例未恢复')
    }
    const reopenedSurface = reopenedInlineViewer.locator('[data-panorama-inline-surface]')
    await reopenedSurface.hover()
    await reopenedSurface.locator('[data-panorama-surface="sphere"] canvas')
      .waitFor({ state: 'visible', timeout: 12000 })
    await reopenedSurface.dblclick({ position: { x: 80, y: 80 } })
    await viewer.waitFor({ state: 'visible', timeout: 12000 })
    await viewer.locator('[data-panorama-surface="sphere"] canvas').waitFor({ state: 'visible', timeout: 12000 })
    await page.evaluate(async (targetDir) => {
      localStorage.removeItem('enable_quick_download')
      localStorage.removeItem('quick_download_path')
      await window.henjiNative.fs.remove(targetDir, { recursive: true })
    }, downloadDir)
    await settlePage(page, 900)
  }

  async function setupCanvasMidjourneyNode(page, openSettings) {
    await setupCanvas(page)
    if (await page.locator('.react-flow').count()) {
      await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
      await settlePage(page)
    }
    const fixtureCard = page.locator(`[data-project-id="${canvasFixtureProjectId}"]:visible`)
    const projectCard = await fixtureCard.count() ? fixtureCard : page.locator('[data-project-id]:visible').first()
    await projectCard.waitFor({ state: 'visible', timeout: 12000 })
    const projectId = await projectCard.getAttribute('data-project-id')
    if (!projectId) throw new Error('Midjourney 视觉场景找不到专用画布工程')
    const nodeData = {
      id: '__ui_midjourney_node', type: 'imageNode', position: { x: 300, y: 120 },
      width: 360, height: 560, measured: { width: 360, height: 560 }, style: { width: 360, height: 560 },
      data: {
        displayName: 'Midjourney', prompt: 'cinematic portrait', modelId: 'apimart-midjourney',
        params: {}, mediaInputs: {}, imageUrl: null, previewImageUrl: null, aspectRatio: '1:1',
        isGenerating: false, generationStartedAt: null,
      },
    }
    await page.evaluate(async (payload) => {
      await window.henjiNative.db.execute(
        'UPDATE storyboard_projects SET node_count = ?, nodes_json = ?, edges_json = ?, viewport_json = ? WHERE id = ?',
        [1, JSON.stringify([payload.node]), '[]', JSON.stringify({ x: 180, y: 90, zoom: 0.9 }), payload.projectId]
      )
    }, { projectId, node: nodeData })
    await projectCard.click()
    const viewport = page.locator('[data-application-observation-region="canvas.viewport_observer"]:visible')
    await viewport.waitFor({ state: 'visible', timeout: 12000 })
    const node = page.locator('.react-flow__node:has([data-generation-node-model-id="apimart-midjourney"])').last()
    await node.waitFor({ state: 'visible', timeout: 12000 })

    await node.click()
    await settlePage(page, 500)
    if (openSettings) {
      const group = node.locator('[data-param-group-id="midjourney-settings"]')
      await group.locator('[data-panel-trigger-button]').click()
      const panel = page.locator('[data-panel-scroll-region]:visible').last()
      await panel.waitFor({ state: 'visible', timeout: 8000 })
      await panel.getByText(/^(参考控制|References)$/i).waitFor({ state: 'visible', timeout: 8000 })
      await settlePage(page)
    }
  }

  async function setupCanvasGptMaskEditor(page) {
    await setupCanvas(page)
    if (await page.locator('.react-flow').count()) {
      await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
      await settlePage(page)
    }
    const fixtureCard = page.locator(`[data-project-id="${canvasFixtureProjectId}"]:visible`)
    const projectCard = await fixtureCard.count() ? fixtureCard : page.locator('[data-project-id]:visible').first()
    await projectCard.waitFor({ state: 'visible', timeout: 12000 })
    const projectId = await projectCard.getAttribute('data-project-id')
    if (!projectId) throw new Error('GPT Image 2 遮罩场景找不到专用画布工程')
    const maskSource = `data:image/svg+xml,${encodeURIComponent([
      '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">',
      '<rect width="512" height="512" fill="midnightblue"/>',
      '<circle cx="256" cy="256" r="150" fill="cornflowerblue"/>',
      '<text x="256" y="278" text-anchor="middle" fill="white" font-family="sans-serif" font-size="54">MASK</text>',
      '</svg>',
    ].join(''))}`
    const nodeData = {
      id: '__ui_gpt_mask_node', type: 'imageNode', position: { x: 300, y: 100 },
      width: 380, height: 620, measured: { width: 380, height: 620 }, style: { width: 380, height: 620 },
      data: {
        displayName: 'GPT Image 2', prompt: 'replace the painted area', modelId: 'apimart-gpt-image-2',
        params: { apimartGptImage2Version: 'official' }, mediaInputs: { image: [maskSource] },
        imageUrl: null, previewImageUrl: null, aspectRatio: '1:1', isGenerating: false, generationStartedAt: null,
      },
    }
    await page.evaluate(async (payload) => {
      await window.henjiNative.db.execute(
        'UPDATE storyboard_projects SET node_count = ?, nodes_json = ?, edges_json = ?, viewport_json = ? WHERE id = ?',
        [1, JSON.stringify([payload.node]), '[]', JSON.stringify({ x: 180, y: 80, zoom: 0.9 }), payload.projectId]
      )
    }, { projectId, node: nodeData })
    await projectCard.click()
    const node = page.locator('.react-flow__node:has([data-generation-node-model-id="apimart-gpt-image-2"])').last()
    await node.waitFor({ state: 'visible', timeout: 12000 })
    await node.click()
    await node.getByRole('button', { name: /^(绘制|Draw)$/i }).click()
    await page.getByRole('dialog', { name: /绘制局部重绘遮罩|Draw Inpainting Mask/i }).waitFor({ state: 'visible', timeout: 12000 })
    await settlePage(page, 700)
  }

  async function setupCanvasAssetGroup(page, expanded) {
    await setupCanvas(page)
    if (await page.locator('.react-flow').count()) {
      await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
      await settlePage(page)
    }
    const fixtureCard = page.locator(`[data-project-id="${canvasFixtureProjectId}"]:visible`)
    const projectCard = await fixtureCard.count() ? fixtureCard : page.locator('[data-project-id]:visible').first()
    await projectCard.waitFor({ state: 'visible', timeout: 12000 })
    const projectId = await projectCard.getAttribute('data-project-id')
    if (!projectId) throw new Error('素材组视觉场景找不到临时画布工程')
    const preview = (first, second, label) => `data:image/svg+xml,${encodeURIComponent([
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220" viewBox="0 0 320 220">',
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${first}"/><stop offset="1" stop-color="${second}"/></linearGradient></defs>`,
      '<rect width="320" height="220" fill="url(#g)"/>',
      `<text x="24" y="190" fill="white" font-family="sans-serif" font-size="32" font-weight="700">${label}</text>`,
      '</svg>',
    ].join(''))}`
    const previews = {
      front: preview('midnightblue', 'cornflowerblue', 'FRONT'),
      outfit: preview('darkslateblue', 'mediumorchid', 'OUTFIT'),
      motion: preview('darkgreen', 'mediumseagreen', 'MOTION'),
      detail: preview('darkgoldenrod', 'coral', 'DETAIL'),
    }
    const nodes = [
      {
        id: '__asset_group', type: 'assetGroupNode', position: { x: 180, y: 220 },
        width: 340, height: 220, measured: { width: 340, height: 220 }, style: { width: 340, height: 220 },
        data: {
          displayName: '角色设定',
          memberOrder: ['__asset_image_1', '__asset_image_2', '__asset_video', '__asset_audio', '__asset_image_3'],
          coverMemberId: '__asset_video',
          bindings: [{
            id: '__asset_binding', targetNodeId: '__asset_target',
            targetPortByKind: { image: 'param:__image' }, excludedMemberIds: [],
          }],
        },
      },
      {
        id: '__asset_image_1', type: 'uploadNode', parentId: '__asset_group', hidden: true,
        position: { x: 0, y: 0 }, width: 240, height: 180, style: { width: 240, height: 180 },
        data: { displayName: '角色正面', imageUrl: previews.front, previewImageUrl: previews.front, aspectRatio: '4:3' },
      },
      {
        id: '__asset_image_2', type: 'uploadNode', parentId: '__asset_group', hidden: true,
        position: { x: 270, y: 40 }, width: 240, height: 180, style: { width: 240, height: 180 },
        data: { displayName: '角色服装', imageUrl: previews.outfit, previewImageUrl: previews.outfit, aspectRatio: '4:3' },
      },
      {
        id: '__asset_video', type: 'videoUploadNode', parentId: '__asset_group', hidden: true,
        position: { x: 540, y: 80 }, width: 240, height: 180, style: { width: 240, height: 180 },
        data: {
          displayName: '角色动作', videoUrl: 'data:video/mp4;base64,',
          previewImageUrl: previews.motion, aspectRatio: '16:9', durationSec: 4,
        },
      },
      {
        id: '__asset_audio', type: 'audioUploadNode', parentId: '__asset_group', hidden: true,
        position: { x: 700, y: 100 }, width: 240, height: 150, style: { width: 240, height: 150 },
        data: {
          displayName: '角色旁白', audioUrl: 'data:audio/wav;base64,', durationSec: 6,
        },
      },
      {
        id: '__asset_image_3', type: 'exportImageNode', parentId: '__asset_group', hidden: true,
        position: { x: 970, y: 120 }, width: 240, height: 180, style: { width: 240, height: 180 },
        data: { displayName: '角色细节', imageUrl: previews.detail, previewImageUrl: previews.detail, aspectRatio: '4:3' },
      },
      {
        id: '__asset_target', type: 'imageNode', position: { x: 720, y: 170 }, width: 360, height: 520,
        style: { width: 360, height: 520 },
        data: {
          displayName: '参考生成', prompt: '保持角色一致性', modelId: 'kie-nano-banana-2',
          params: {}, mediaInputs: {}, imageUrl: null, previewImageUrl: null, aspectRatio: '1:1',
          isGenerating: false, generationStartedAt: null,
        },
      },
    ]
    await page.evaluate(async (payload) => {
      await window.henjiNative.db.execute(
        'UPDATE storyboard_projects SET node_count = ?, nodes_json = ?, edges_json = ?, viewport_json = ? WHERE id = ?',
        [payload.nodes.length, JSON.stringify(payload.nodes), '[]', JSON.stringify({ x: 120, y: 80, zoom: 0.85 }), payload.projectId]
      )
    }, { projectId, nodes })
    await projectCard.click()
    const group = page.locator('.react-flow__node[data-id="__asset_group"]')
    await group.waitFor({ state: 'visible', timeout: 12000 })
    await settlePage(page, 700)
    if (expanded) {
      await group.getByRole('button', { name: /管理素材组|Manage asset group/i }).click()
      await page.getByRole('region', { name: /素材组管理|Asset group manager/i })
        .waitFor({ state: 'visible', timeout: 8000 })
      await settlePage(page, 700)
    }
  }

  async function setupCanvasBatchConnection(page) {
    await setupCanvas(page)
    if (await page.locator('.react-flow').count()) {
      await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
      await settlePage(page)
    }
    const fixtureCard = page.locator(`[data-project-id="${canvasFixtureProjectId}"]:visible`)
    const projectCard = await fixtureCard.count() ? fixtureCard : page.locator('[data-project-id]:visible').first()
    await projectCard.waitFor({ state: 'visible', timeout: 12000 })
    const projectId = await projectCard.getAttribute('data-project-id')
    if (!projectId) throw new Error('批量连接场景找不到临时画布工程')
    const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
    const nodes = [
      {
        id: '__batch_image_1', type: 'uploadNode', position: { x: 120, y: 140 },
        width: 240, height: 180, style: { width: 240, height: 180 },
        data: { displayName: '角色正面', imageUrl: pixel, previewImageUrl: pixel, aspectRatio: '4:3' },
      },
      {
        id: '__batch_image_2', type: 'uploadNode', position: { x: 120, y: 390 },
        width: 240, height: 180, style: { width: 240, height: 180 },
        data: { displayName: '角色侧面', imageUrl: pixel, previewImageUrl: pixel, aspectRatio: '4:3' },
      },
      {
        id: '__batch_target', type: 'imageNode', position: { x: 690, y: 210 }, width: 360, height: 520,
        style: { width: 360, height: 520 },
        data: {
          displayName: '批量参考生成', prompt: '保持角色一致性', modelId: 'kie-nano-banana-2',
          params: {}, mediaInputs: {}, imageUrl: null, previewImageUrl: null, aspectRatio: '1:1',
          isGenerating: false, generationStartedAt: null,
        },
      },
    ]
    await page.evaluate(async (payload) => {
      await window.henjiNative.db.execute(
        'UPDATE storyboard_projects SET node_count = ?, nodes_json = ?, edges_json = ?, viewport_json = ? WHERE id = ?',
        [payload.nodes.length, JSON.stringify(payload.nodes), '[]', JSON.stringify({ x: 140, y: 70, zoom: 0.82 }), payload.projectId]
      )
    }, { projectId, nodes })
    await projectCard.click()
    const first = page.locator('.react-flow__node[data-id="__batch_image_1"]')
    const second = page.locator('.react-flow__node[data-id="__batch_image_2"]')
    const target = page.locator('.react-flow__node[data-id="__batch_target"]')
    await first.waitFor({ state: 'visible', timeout: 12000 })
    await first.click({ position: { x: 120, y: 90 } })
    await second.click({ position: { x: 120, y: 90 }, modifiers: ['Meta'] })
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node.selected').length === 2, undefined, { timeout: 8000 })
    const connector = page.getByRole('button', { name: /批量连接|Batch connect/i }).last()
    await connector.waitFor({ state: 'visible', timeout: 8000 })
    const connectorBox = await connector.boundingBox()
    const targetBox = await target.boundingBox()
    if (!connectorBox || !targetBox) throw new Error('批量连接场景无法定位连接点或目标节点')
    await page.mouse.move(connectorBox.x + connectorBox.width / 2, connectorBox.y + connectorBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(targetBox.x + targetBox.width * 0.72, targetBox.y + targetBox.height * 0.24, { steps: 12 })
    await page.mouse.up()
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__edge').length >= 2, undefined, { timeout: 8000 })
    await settlePage(page, 700)
  }

  async function setupCanvasAssetGroupRemoveConfirmation(page) {
    await setupCanvasAssetGroup(page, true)
    await page.getByRole('button', { name: /移出素材组|Remove from asset group/i }).first().click()
    await page.getByRole('dialog', { name: /移出素材|Remove media/i })
      .waitFor({ state: 'visible', timeout: 8000 })
    await settlePage(page)
  }

  /**
   * 拖放建节点必须自动连上，且长提示词只在节点内换行、不把节点撑宽。
   *
   * 全程走应用正式路径：自己新建工程、用真实图片文件走正式上传链路、用真实拖拽
   * 手势连线。不再直接 UPDATE storyboard_projects——那既会覆盖已有工程，塞进去的
   * 占位像素也不能代表用户真实画布。
   */
  async function setupCanvasQuickConnectPrompt(page) {
    await setupCanvas(page)
    if (await page.locator('.react-flow').count()) {
      await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
      await settlePage(page)
    }
    await clickNamedButton(page, /^(新建项目|New Project)$/i)
    const createDialog = page.locator('[data-dialog="true"]:visible').last()
    await createDialog.waitFor({ state: 'visible', timeout: 8000 })
    await createDialog.locator('input').first().fill('回归-拖放连接与提示词换行')
    const confirmButton = createDialog.getByRole('button', { name: /确定|确认|Confirm|OK/i }).last()
    if (!await confirmButton.count()) {
      const dump = await createDialog.evaluate((element) => Array.from(
        element.querySelectorAll('button')
      ).map((button) => button.textContent?.trim()).join(' | '))
      throw new Error(`新建项目对话框没有可识别的确认按钮，实际按钮：${dump}`)
    }
    await confirmButton.click()
    const viewport = page.locator('[data-application-observation-region="canvas.viewport_observer"]:visible')
    await viewport.waitFor({ state: 'visible', timeout: 12000 })
    await settlePage(page, 700)

    const box = await viewport.boundingBox()
    if (!box) throw new Error('拖放连接场景没有可交互的画布视口')
    await viewport.click({ button: 'right', position: { x: 220, y: 300 } })
    const addMenu = page.getByRole('menu', { name: /^(添加节点|Add Node)$/i })
    await addMenu.waitFor({ state: 'visible', timeout: 8000 })
    await addMenu.getByRole('menuitem', { name: /^(上传|Upload)$/i }).click()

    const source = page.locator('.react-flow__node:has(input[type="file"])').last()
    await source.waitFor({ state: 'visible', timeout: 8000 })
    await source.locator('input[type="file"]').setInputFiles(REFERENCE_FIXTURE_IMAGE)
    await source.locator('img').first().waitFor({ state: 'visible', timeout: 12000 })
    await settlePage(page, 700)

    const handle = source.locator('.react-flow__handle.source').first()
    const handleBox = await handle.boundingBox()
    if (!handleBox) throw new Error('拖放连接场景无法定位输出端口')
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBox.x + 430, handleBox.y + 40, { steps: 16 })
    await page.mouse.up()

    const quickMenu = page.getByRole('menu', { name: /^(添加节点|Add Node)$/i })
    await quickMenu.waitFor({ state: 'visible', timeout: 8000 })
    await quickMenu.getByRole('menuitem', { name: /^(视频生成|Video Generation)$/i }).click()
    // 拖放建节点必须自动连上；连线数为 0 说明快捷连接又被静默丢弃了
    await page.waitForFunction(
      () => document.querySelectorAll('.react-flow__edge').length >= 1,
      undefined,
      { timeout: 8000 }
    )
    await settlePage(page, 500)

    const generated = page.locator('.react-flow__node:has([data-generation-node-id])').last()
    await generated.waitFor({ state: 'visible', timeout: 8000 })
    const widthBefore = (await generated.boundingBox())?.width ?? 0
    await generated.getByRole('textbox').first().click()
    await settlePage(page, 400)
    await page.keyboard.type('这是一段刻意写得很长的提示词，用来验证提示词在节点内自动换行而不是把节点撑宽，'
      + '包含足够多的字符以超过节点默认宽度好几倍，这样才能真正暴露宽度回归问题。')
    await settlePage(page, 600)
    const widthAfter = (await generated.boundingBox())?.width ?? 0
    if (widthAfter - widthBefore > 1) {
      throw new Error(`长提示词把节点撑宽了：${Math.round(widthBefore)} → ${Math.round(widthAfter)}`)
    }
    const promptLines = await generated.getByRole('textbox').first().evaluate((element) => {
      const style = window.getComputedStyle(element)
      const lineHeight = Number.parseFloat(style.lineHeight) || 24
      return Math.round(element.scrollHeight / lineHeight)
    })
    if (promptLines < 2) throw new Error('长提示词没有换行，仍然渲染成单行')
    await settlePage(page, 400)
  }

  async function setupToolbox(page) {
    await openWorkspace(page, 'toolbox')
    for (const title of ['返回工程列表', '返回工具箱']) {
      const back = page.locator(`[title="${title}"]:visible, [aria-label="${title}"]:visible`).first()
      if (await back.count()) {
        await back.click()
        await settlePage(page)
      }
    }
    await waitForPageHeader(page)
  }

  async function setupCameraStageProjectList(page) {
    await setupToolbox(page)
    await clickNamedButton(page, /^(3D 镜头参考|3D Camera Reference)/i)
    await page.getByRole('button', { name: /^(新建工程|New Project)$/i }).first()
      .waitFor({ state: 'visible', timeout: 12000 })
  }

  async function setupCameraStageStyledEditor(page) {
    await setupCameraStageProjectList(page)
    await page.getByRole('button', { name: /^(新建工程|New Project)$/i }).first().click()
    const dialog = page.getByRole('dialog').last()
    await dialog.waitFor({ state: 'visible', timeout: 8000 })
    const input = dialog.getByRole('textbox')
    await input.fill('真实性巡检-3D镜头')
    await input.press('Enter')
    await page.locator('[title="添加球体"]:visible').waitFor({ state: 'visible', timeout: 12000 })
    await page.locator('[title="添加球体"]:visible').click()
    await page.locator('[title="添加摄像机"]:visible').click()
    const renderStyle = page.getByRole('button', { name: '渲染方式' }).filter({ visible: true }).first()
    await renderStyle.waitFor({ state: 'visible', timeout: 12000 })
    await renderStyle.click()
    await page.getByRole('option', { name: '线稿图', exact: true }).filter({ visible: true }).first().click()
    const cameraPane = page.locator('[data-camera-stage-viewport-id="camera"][data-camera-stage-render-style="lineart"]')
    await cameraPane.waitFor({ state: 'visible', timeout: 12000 })
    await cameraPane.click({ button: 'middle', position: { x: 320, y: 180 } })
    await settlePage(page, 900)
  }

  async function setupAssets(page) {
    await openWorkspace(page, 'assets')
    await page.locator('[data-asset-floating-panel]:visible').waitFor({ state: 'visible', timeout: 8000 })
    await clickNamedButton(page, /^(完整管理|Full manager)$/i)
    await waitForPageHeader(page)
    await settlePage(page, 700)
  }

  async function setupAssistant(page) {
    await setupGeneration(page)
    await page.locator('[title="智能助手"]').first().click({ timeout: 8000 })
    await page.locator('aside[aria-label="智能助手"]:visible').waitFor({ state: 'visible', timeout: 8000 })
    await settlePage(page)
  }

  return Object.freeze([
    { id: 'generation-empty', surface: '生成', name: '生成-空态', setup: setupGeneration },
    {
      id: 'generation-model-panel',
      surface: '生成',
      name: '生成-模型选择面板',
      setup: async (page) => {
        await openGenerationModelPanel(page)
        await settlePage(page)
      },
    },
    {
      id: 'generation-model-midjourney',
      surface: '生成',
      name: '生成-模型合并-Midjourney',
      setup: async (page) => setupGenerationModelSearch(
        page,
        'Midjourney',
        'apimart-midjourney',
        ['apimart-midjourney-edit', 'apimart-midjourney-blend'],
      ),
    },
    {
      id: 'generation-model-gemini-omni',
      surface: '生成',
      name: '生成-模型合并-Gemini Omni',
      setup: async (page) => setupGenerationModelSearch(
        page,
        'Gemini Omni',
        'apimart-gemini-omni-flash',
        ['apimart-gemini-omni-flash-ext'],
      ),
    },
    {
      id: 'generation-model-gpt-image-2',
      surface: '生成',
      name: '生成-模型合并与渠道-GPT Image 2',
      setup: async (page) => {
        const modelButton = await setupGenerationModelSearch(
          page, 'GPT Image 2', 'apimart-gpt-image-2', ['apimart-gpt-image-2-official'],
        )
        await modelButton.click()
        await page.locator('[data-model-selector-panel]:visible').waitFor({ state: 'hidden', timeout: 8000 })
        const channelField = paramFieldFromLabel(page, /^(渠道|Channel)$/i)
        await channelField.locator('[data-dropdown-button]').click()
        await page.getByRole('option', { name: /^(普通|Standard)$/i }).waitFor({ state: 'visible', timeout: 8000 })
        await page.getByRole('option', { name: /^(官方|Official)$/i }).waitFor({ state: 'visible', timeout: 8000 })
        await page.keyboard.press('Escape')
        await settlePage(page)
      },
    },
    {
      id: 'generation-midjourney-settings',
      surface: '生成',
      name: '生成-Midjourney 参数特殊面板',
      setup: async (page) => setupGenerationMidjourneySettings(page, false),
    },
    {
      id: 'generation-midjourney-reference',
      surface: '生成',
      name: '生成-Midjourney 参考图与权重',
      setup: async (page) => setupGenerationMidjourneySettings(page, true),
    },
    {
      id: 'generation-gpt-mask-control',
      surface: '生成',
      name: '生成-GPT Image 2 遮罩说明与绘制入口',
      setup: async (page) => setupGenerationGptMask(page, false),
    },
    {
      id: 'generation-gpt-mask-editor',
      surface: '生成',
      name: '生成-GPT Image 2 遮罩编辑器',
      setup: async (page) => setupGenerationGptMask(page, true),
    },
    {
      id: 'generation-prompt-focus',
      surface: '生成',
      name: '生成-提示词聚焦',
      setup: async (page) => {
        await setupGeneration(page)
        await page.locator('[contenteditable="true"]').first().focus()
        await settlePage(page)
      },
    },
    {
      id: 'generation-optimize-context',
      surface: '生成',
      name: '生成-优化配置右键',
      setup: async (page) => {
        await setupGeneration(page)
        await page.locator('[title*="右键管理配置"]').click({ button: 'right' })
        await page.getByText('提示词优化配置', { exact: true }).waitFor({ state: 'visible' })
        await settlePage(page)
      },
    },
    { id: 'settings-general', surface: '设置', name: '设置-基础设置', setup: setupSettings },
    {
      id: 'settings-theme',
      surface: '设置',
      name: '设置-主题外观',
      setup: async (page) => {
        await setupSettings(page)
        await clickNamedButton(page, /^(界面|Interface)$/i)
        await clickNamedButton(page, /^主题外观$/)
        await settlePage(page)
      },
    },
    {
      id: 'settings-provider-center',
      surface: '设置',
      name: '设置-供应商与模型',
      setup: async (page) => {
        await setupSettings(page)
        await clickNamedButton(page, /^(模型|Models)$/i)
        await clickNamedButton(page, /^KIE$/)
        await settlePage(page)
      },
    },
    {
      id: 'settings-models-alias',
      surface: '设置',
      name: '设置-模型别名',
      setup: async (page) => {
        await setupSettings(page)
        await clickNamedButton(page, /^(模型|Models)$/i)
        await clickNamedButton(page, /^(别名|Aliases)$/i)
        await settlePage(page)
      },
    },
    {
      id: 'settings-assistant-models',
      surface: '设置',
      name: '设置-助手模型',
      setup: async (page) => {
        await setupSettings(page)
        await clickNamedButton(page, /^(模型|Models)$/i)
        await clickNamedButton(page, /^(助手模型|Assistant Models)$/i)
        await settlePage(page, 700)
      },
    },
    {
      id: 'settings-provider-manager',
      surface: '设置',
      name: '设置-添加供应商',
      setup: async (page) => {
        await setupSettings(page)
        await clickNamedButton(page, /^(模型|Models)$/i)
        await clickNamedButton(page, /^(添加供应商|Add provider)$/i)
        const dialog = page.getByRole('dialog', { name: /添加大语言模型供应商|Add LLM Provider/i })
        await dialog.waitFor({ state: 'visible' })
        await clickNamedButton(dialog, /^(接入方式|Connection type)$/i)
        await page.getByRole('option', { name: /^(火山引擎（豆包）|Volcengine.*)$/i }).click()
        await settlePage(page, 700)
      },
    },
    {
      id: 'settings-agent-skills',
      surface: '设置',
      name: '设置-助手技能',
      setup: async (page) => {
        await setupSettings(page)
        await clickNamedButton(page, /^(助手|Assistant)$/i)
        await clickNamedButton(page, /^(助手技能|Assistant Skills)$/i)
        await settlePage(page, 700)
      },
    },
    {
      id: 'settings-interface-layout',
      surface: '设置',
      name: '设置-界面布局',
      setup: async (page) => {
        await setupSettings(page)
        await clickNamedButton(page, /^(界面|Interface)$/i)
        await clickNamedButton(page, /^(布局行为|Layout Behavior)$/i)
        await settlePage(page)
      },
    },
    { id: 'canvas-projects', surface: '画布', name: '画布-项目列表', setup: setupCanvas },
    {
      id: 'canvas-image-capability-toolbar',
      surface: '画布',
      writesUserData: true,
      name: '画布-图片能力工具条信息架构',
      setup: setupCanvasImageCapabilityToolbar,
    },
    {
      id: 'canvas-panorama-toolbar',
      surface: '画布',
      writesUserData: true,
      name: '画布-720°全景工具条与相邻节点',
      setup: setupCanvasPanoramaToolbar,
    },
    {
      id: 'canvas-panorama-viewer',
      surface: '画布',
      writesUserData: true,
      name: '画布-全景查看节点与沉浸式查看器',
      setup: setupCanvasPanoramaViewer,
    },
    {
      id: 'canvas-relight-editor',
      surface: '画布',
      writesUserData: true,
      name: '画布-图片打光节点与可视化编辑器',
      setup: setupCanvasRelightEditor,
    },
    {
      id: 'canvas-multi-angle-editor',
      surface: '画布',
      writesUserData: true,
      name: '画布-多角度节点与相机编辑器',
      setup: setupCanvasMultiAngleEditor,
    },
    {
      id: 'canvas-upscale-node',
      surface: '画布',
      writesUserData: true,
      name: '画布-高清放大节点与保存重开',
      setup: setupCanvasUpscaleNode,
    },
    {
      id: 'canvas-portrait-texture-node',
      surface: '画布',
      writesUserData: true,
      name: '画布-人像质感节点与保存重开',
      setup: setupCanvasPortraitTextureNode,
    },
    {
      id: 'canvas-element-edit-node',
      surface: '画布',
      writesUserData: true,
      name: '画布-元素编辑节点与唯一蒙版编辑器',
      setup: setupCanvasElementEditNode,
    },
    {
      id: 'canvas-layer-stack',
      surface: '画布',
      writesUserData: true,
      name: '画布-图层结果节点与图层界面',
      setup: setupCanvasLayerStack,
    },
    {
      id: 'canvas-nine-grid',
      surface: '画布',
      writesUserData: true,
      name: '画布-固定九宫格预设与本地宫格切分',
      setup: setupCanvasNineGrid,
    },
    {
      id: 'canvas-midjourney-node',
      surface: '画布',
      writesUserData: true,
      name: '画布-Midjourney 节点与端口',
      setup: async (page) => setupCanvasMidjourneyNode(page, false),
    },
    {
      id: 'canvas-midjourney-settings',
      surface: '画布',
      writesUserData: true,
      name: '画布-Midjourney 参数特殊面板',
      setup: async (page) => setupCanvasMidjourneyNode(page, true),
    },
    {
      id: 'canvas-gpt-mask-editor',
      surface: '画布',
      writesUserData: true,
      name: '画布-GPT Image 2 遮罩编辑器',
      setup: setupCanvasGptMaskEditor,
    },
    {
      id: 'canvas-asset-group-collapsed',
      surface: '画布',
      writesUserData: true,
      name: '画布-素材组折叠与束线',
      setup: async (page) => setupCanvasAssetGroup(page, false),
    },
    {
      id: 'canvas-asset-group-expanded',
      surface: '画布',
      writesUserData: true,
      name: '画布-素材组管理工作面',
      setup: async (page) => setupCanvasAssetGroup(page, true),
    },
    {
      id: 'canvas-asset-group-remove-confirmation',
      surface: '画布',
      writesUserData: true,
      name: '画布-素材组移出确认',
      setup: setupCanvasAssetGroupRemoveConfirmation,
    },
    {
      id: 'canvas-batch-connection',
      surface: '画布',
      writesUserData: true,
      name: '画布-框选素材批量拖连',
      setup: setupCanvasBatchConnection,
    },
    {
      id: 'canvas-quick-connect-prompt',
      surface: '画布',
      name: '画布-拖放建节点与提示词换行',
      writesUserData: true,
      setup: setupCanvasQuickConnectPrompt,
    },
    { id: 'toolbox-home', surface: '工具箱', name: '工具箱-首页', setup: setupToolbox },
    {
      id: 'toolbox-hover',
      surface: '工具箱',
      name: '工具箱-入口悬浮',
      setup: async (page) => {
        await setupToolbox(page)
        await page.locator('[data-ui-page-header] + div button:visible').first().hover()
        await settlePage(page)
      },
    },
    {
      id: 'toolbox-image-edit',
      surface: '工具箱',
      name: '工具箱-图片编辑空态',
      setup: async (page) => {
        await setupToolbox(page)
        await clickNamedButton(page, /^(图片编辑|Image Edit)/i)
        await page.locator('[data-application-surface-id="tool.image_edit"]:visible').waitFor({ state: 'visible', timeout: 12000 })
        await page.getByRole('button', { name: /^(从文件打开|Open from file)$/i }).waitFor({ state: 'visible', timeout: 12000 })
        await settlePage(page, 700)
      },
    },
    {
      id: 'toolbox-image-edit-vgpu-glow',
      surface: '工具箱',
      name: '工具箱-图片编辑辉光 Pro',
      setup: async (page) => {
        const openGlowEditor = async () => {
          await setupToolbox(page)
          await clickNamedButton(page, /^(图片编辑|Image Edit)/i)
          const surface = page.locator('[data-application-surface-id="tool.image_edit"]:visible')
          await surface.waitFor({ state: 'visible', timeout: 12000 })
          const dropTarget = surface.locator('.border-dashed').first()
          await dropTarget.waitFor({ state: 'visible', timeout: 8000 })
          await dropTarget.evaluate(async (element) => {
            const canvas = document.createElement('canvas')
            canvas.width = 1200
            canvas.height = 760
            const context = canvas.getContext('2d')
            if (!context) throw new Error('辉光夹具画布不可用')
            const background = context.createRadialGradient(600, 360, 40, 600, 360, 760)
            background.addColorStop(0, 'rgb(24, 34, 62)')
            background.addColorStop(1, 'rgb(5, 7, 13)')
            context.fillStyle = background
            context.fillRect(0, 0, canvas.width, canvas.height)
            for (const [x, y, radius, color, width] of [
              [310, 330, 70, 'rgb(57, 216, 255)', 14],
              [610, 235, 54, 'rgb(255, 62, 201)', 11],
              [870, 420, 82, 'rgb(255, 156, 50)', 16],
            ]) {
              context.strokeStyle = color
              context.lineWidth = width
              context.beginPath()
              context.arc(x, y, radius, 0, Math.PI * 2)
              context.stroke()
            }
            context.fillStyle = 'rgb(37, 232, 198)'
            context.beginPath()
            context.arc(145, 590, 58, 0, Math.PI * 2)
            context.fill()
            context.strokeStyle = 'rgb(235, 241, 255)'
            context.lineWidth = 8
            context.beginPath()
            context.moveTo(260, 530)
            context.lineTo(940, 530)
            context.stroke()
            context.fillStyle = 'rgb(220, 233, 255)'
            context.font = '48px sans-serif'
            context.textAlign = 'center'
            context.fillText('VGPU GLOW', 600, 650)
            const blob = await new Promise((resolve, reject) => canvas.toBlob(
              (value) => value ? resolve(value) : reject(new Error('辉光夹具编码失败')),
              'image/png'
            ))
            const transfer = new DataTransfer()
            transfer.items.add(new File([blob], 'vgpu-glow-fixture.png', { type: 'image/png' }))
            element.dispatchEvent(new DragEvent('drop', {
              bubbles: true,
              cancelable: true,
              dataTransfer: transfer,
            }))
          })
          await page.getByRole('button', { name: '辉光 Pro' }).waitFor({ state: 'visible', timeout: 12000 })
          await page.getByRole('button', { name: '辉光 Pro' }).click()
          await page.getByRole('heading', { name: '辉光 Pro' }).waitFor({ state: 'visible', timeout: 8000 })
          await page.getByRole('switch', { name: '启用辉光 Pro' }).click()
          await settlePage(page, 1200)
        }

        // 第一轮主动推进多次 revision，再重新打开编辑器。旧实现的 Worker 记住了全局最大值，
        // 第二轮从 revision 1 起步会被永久判旧；这个场景必须在同一 Electron 进程里复现它。
        await openGlowEditor()
        const intensity = page.getByRole('slider', { name: '发光强度' })
        await intensity.focus()
        for (let index = 0; index < 6; index += 1) await intensity.press('ArrowRight')
        await settlePage(page, 1200)
        await page.getByRole('button', { name: '返回工具箱' }).click()
        await openGlowEditor()
        await page.getByRole('switch', { name: '启用辉光着色' }).click()
        const tint = page.getByLabel('辉光颜色')
        await tint.fill('#ff4bd8')
        await page.getByRole('switch', { name: '启用辉光着色' }).click()
        const radius = page.getByRole('slider', { name: '发光半径' })
        await radius.fill('0.58')
        const chromaticAberration = page.getByRole('slider', { name: '色差' })
        await chromaticAberration.fill('0')
        if (await page.getByText('辉光预览失败').count()) {
          throw new Error('重新打开图片编辑器后，辉光预览仍被旧会话 revision 取消')
        }
        await settlePage(page, 2200)
      },
    },
    {
      id: 'toolbox-camera-stage',
      surface: '工具箱',
      name: '工具箱-3D 镜头工程',
      setup: async (page) => {
        await setupCameraStageProjectList(page)
        await settlePage(page, 700)
      },
    },
    {
      id: 'toolbox-camera-stage-lineart',
      surface: '工具箱',
      name: '工具箱-3D 镜头线稿成像',
      writesUserData: true,
      setup: setupCameraStageStyledEditor,
    },
    { id: 'assets-home', surface: '资产库', name: '资产库-首页', setup: setupAssets },
    {
      id: 'assets-search-focus',
      surface: '资产库',
      name: '资产库-搜索聚焦',
      setup: async (page) => {
        await setupAssets(page)
        await page.locator('input[placeholder*="资产"], input[placeholder*="asset" i]').first().focus()
        await settlePage(page)
      },
    },
    {
      id: 'assets-type-menu',
      surface: '资产库',
      name: '资产库-类型下拉',
      setup: async (page) => {
        await setupAssets(page)
        await clickNamedButton(page, /^(全部类型|All types)$/i)
        await settlePage(page)
      },
    },
    { id: 'assistant-home', surface: '助手', name: '助手-对话空态', setup: setupAssistant },
    {
      id: 'assistant-history',
      surface: '助手',
      name: '助手-运行历史',
      setup: async (page) => {
        await setupAssistant(page)
        await page.locator('[aria-label="对话历史"]').click()
        await settlePage(page)
      },
    },
    {
      id: 'assistant-focus',
      surface: '助手',
      name: '助手-输入聚焦',
      setup: async (page) => {
        await setupAssistant(page)
        await page.locator('[aria-label="向智能助手描述任务"]').focus()
        await settlePage(page)
      },
    },
    {
      id: 'assistant-memory',
      surface: '助手',
      name: '助手-记忆',
      setup: async (page) => {
        await setupAssistant(page)
        await page.locator('[aria-label="助手记忆"]').click()
        await settlePage(page)
      },
    },
  ])
}

module.exports = { createUiInspectionScenes }
