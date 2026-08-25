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
    const settingsLabel = page.locator('label').filter({ hasText: /^(MJ 设置|MJ Settings)$/i }).first()
    await settingsLabel.waitFor({ state: 'visible', timeout: 8000 })
    await settingsLabel.locator('..').locator('[data-panel-trigger-button]').click()
    const panel = page.locator('[data-panel-scroll-region]:visible').last()
    await panel.waitFor({ state: 'visible', timeout: 8000 })
    await panel.getByText(/^(参考控制|References)$/i).waitFor({ state: 'visible', timeout: 8000 })
    if (withCharacterReference) {
      const characterReferenceLabel = panel.locator('label').filter({ hasText: /^(角色参考图|Character Reference)$/i })
      const characterReference = characterReferenceLabel.locator('..')
      await characterReference.locator('input[type="file"]').setInputFiles(REFERENCE_FIXTURE_IMAGE)
      await panel.getByText(/^(角色权重|Character Weight)$/i).waitFor({ state: 'visible', timeout: 8000 })
    }
    await settlePage(page)
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
    const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
    const nodes = [
      {
        id: '__asset_group', type: 'assetGroupNode', position: { x: 180, y: 220 },
        width: 220, height: 144, measured: { width: 220, height: 144 }, style: { width: 220, height: 144 },
        data: {
          displayName: '角色设定', memberOrder: ['__asset_image_1', '__asset_image_2'],
          coverMemberId: '__asset_image_1',
          bindings: [{
            id: '__asset_binding', targetNodeId: '__asset_target',
            targetPortByKind: { image: 'param:__image' }, excludedMemberIds: [],
          }],
        },
      },
      {
        id: '__asset_image_1', type: 'uploadNode', parentId: '__asset_group', hidden: true,
        position: { x: 0, y: 0 }, width: 240, height: 180, style: { width: 240, height: 180 },
        data: { displayName: '角色正面', imageUrl: pixel, previewImageUrl: pixel, aspectRatio: '4:3' },
      },
      {
        id: '__asset_image_2', type: 'uploadNode', parentId: '__asset_group', hidden: true,
        position: { x: 270, y: 40 }, width: 240, height: 180, style: { width: 240, height: 180 },
        data: { displayName: '角色服装', imageUrl: pixel, previewImageUrl: pixel, aspectRatio: '4:3' },
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
      await group.getByRole('button', { name: /展开素材组|Expand asset group/i }).click()
      await page.getByText(/已临时展开|temporarily expanded/i).waitFor({ state: 'visible', timeout: 8000 })
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
        const channelField = page.locator('label').filter({ hasText: /^(渠道|Channel)$/i }).first().locator('..')
        await channelField.getByRole('button', { name: /^(普通|Standard)$/i }).click()
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
      id: 'settings-models',
      surface: '设置',
      name: '设置-模型显示管理',
      setup: async (page) => {
        await setupSettings(page)
        await clickNamedButton(page, /^(模型|Models)$/i)
        await settlePage(page)
      },
    },
    {
      id: 'settings-llm',
      surface: '设置',
      name: '设置-大语言模型',
      setup: async (page) => {
        await setupSettings(page)
        await clickNamedButton(page, /^(密钥|API Keys)$/i)
        await clickNamedButton(page, /^(大语言模型|Language Models)$/i)
        await settlePage(page, 700)
      },
    },
    {
      id: 'settings-agent-skills',
      surface: '设置',
      name: '设置-助手技能',
      setup: async (page) => {
        await setupSettings(page)
        await clickNamedButton(page, /^(密钥|API Keys)$/i)
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
      name: '画布-素材组临时展开',
      setup: async (page) => setupCanvasAssetGroup(page, true),
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
        await page.locator('[data-ui-page-header] + div button').first().hover()
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
