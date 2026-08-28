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
    await page.evaluate(async (payload) => {
      await window.henjiNative.db.execute(
        'UPDATE storyboard_projects SET node_count = ?, nodes_json = ?, edges_json = ?, viewport_json = ?, history_json = ? WHERE id = ?',
        [payload.nodes.length, JSON.stringify(payload.nodes), '[]', JSON.stringify({ x: 100, y: 80, zoom: 0.65 }), JSON.stringify({ past: [], future: [] }), payload.projectId]
      )
    }, { projectId, nodes })
    await projectCard.click()
    await page.locator('.react-flow__node[data-id="__ui_panorama_source"]').waitFor({ state: 'visible', timeout: 12000 })
    return { panoramaSource, projectId }
  }

  async function setupCanvasPanoramaToolbar(page) {
    const fixture = await seedAndOpenCanvasPanoramaProject(page)
    const sourceNode = page.locator('.react-flow__node[data-id="__ui_panorama_source"]')
    await sourceNode.click()
    const panoramaAction = page.getByRole('button', { name: /^720°全景$/i }).filter({ visible: true }).first()
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
    const relightAction = page.getByRole('button', { name: /^(打光|Relight)$/i })
      .filter({ visible: true }).first()
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
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]').map((node) => (
        node.id === '__ui_panorama_result' ? { ...node, hidden: false } : node
      ))
      await window.henjiNative.db.execute(
        'UPDATE storyboard_projects SET nodes_json = ?, viewport_json = ? WHERE id = ?',
        [JSON.stringify(nodes), JSON.stringify({ x: -920, y: -510, zoom: 0.82 }), payload.projectId]
      )
    }, { projectId })
    await page.locator(`[data-project-id="${projectId}"]:visible`).click()
    const resultNode = page.locator('.react-flow__node[data-id="__ui_panorama_result"]')
    await resultNode.waitFor({ state: 'visible', timeout: 12000 })
    await resultNode.getByRole('button', { name: /进入全景预览|Open panorama viewer/i }).click()

    const viewer = page.locator('[data-panorama-viewer="true"]')
    await viewer.waitFor({ state: 'visible', timeout: 12000 })
    const sphere = viewer.locator('[data-panorama-surface="sphere"] canvas')
    await sphere.waitFor({ state: 'visible', timeout: 12000 })
    const box = await sphere.boundingBox()
    if (!box) throw new Error('全景球面画布没有可交互区域')
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.66, box.y + box.height * 0.42, { steps: 8 })
    await page.mouse.up()
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
    const persisted = await page.evaluate(async (payload) => {
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json, edges_json FROM storyboard_projects WHERE id = ? LIMIT 1',
        [payload.projectId]
      )
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
      const edges = JSON.parse(rows[0]?.edges_json ?? '[]')
      return {
        hasGeneratedNode: nodes.some((node) => node.id === payload.generatedNodeId && node.type === 'panoramaGenNode'),
        resultKind: nodes.find((node) => node.id === '__ui_panorama_result')?.data?.resultKind,
        edgeCount: edges.length,
      }
    }, { generatedNodeId, projectId })
    if (!persisted.hasGeneratedNode || persisted.resultKind !== 'panorama' || persisted.edgeCount < 1) {
      throw new Error(`全景项目保存语义或连线丢失：${JSON.stringify(persisted)}`)
    }

    await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
    await settlePage(page, 600)
    await page.locator(`[data-project-id="${projectId}"]:visible`).click()
    const reopenedResult = page.locator('.react-flow__node[data-id="__ui_panorama_result"]')
    await reopenedResult.waitFor({ state: 'visible', timeout: 12000 })
    await page.locator(`.react-flow__node[data-id="${generatedNodeId}"]`).waitFor({ state: 'visible', timeout: 12000 })
    await reopenedResult.getByRole('button', { name: /进入全景预览|Open panorama viewer/i }).click()
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
      name: '画布-720°全景沉浸式查看器',
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
      id: 'canvas-upscale-node',
      surface: '画布',
      writesUserData: true,
      name: '画布-高清放大节点与保存重开',
      setup: setupCanvasUpscaleNode,
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
