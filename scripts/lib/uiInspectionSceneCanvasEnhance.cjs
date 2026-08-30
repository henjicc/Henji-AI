function attachUiInspectionCanvasEnhance(context) {
  const {
    settlePage,
    clickCanvasCapabilityAction,
    resizeCanvasNodeAndAssertHitBox,
    paramFieldFromLabel,
    seedAndOpenCanvasPanoramaProject,
  } = context

  async function setupCanvasUpscaleNode(page) {
    const { panoramaSource, projectId } = await seedAndOpenCanvasPanoramaProject(page)
    const sourceNode = page.locator('.react-flow__node[data-id="__ui_panorama_source"]')
    await sourceNode.click()
    await page.waitForTimeout(350)
    let upscaleAction = page.getByRole('button', { name: /^(高清(?:放大)?|Upscale)$/i }).filter({ visible: true }).first()
    if (!(await upscaleAction.count())) {
      const moreButton = page.getByRole('button').filter({ hasText: /^(更多|More)$/i }).filter({ visible: true }).first()
      if (!(await moreButton.count())) {
        const labels = await page.getByRole('button').filter({ visible: true }).allTextContents()
        throw new Error(`高清工具入口不可见；当前按钮：${JSON.stringify(labels)}`)
      }
      await moreButton.click()
      upscaleAction = page.getByRole('button', { name: /^(高清(?:放大)?|Upscale)$/i }).filter({ visible: true }).first()
    }
    await upscaleAction.waitFor({ state: 'visible', timeout: 8000 })
    await upscaleAction.click()

    const shell = page.locator('[data-generation-node-id][data-generation-node-model-id="fal-ai-topaz-image-upscale"]')
      .filter({ hasText: /高清放大|Upscale/ }).last()
    await shell.waitFor({ state: 'visible', timeout: 12000 })
    if (await shell.getAttribute('data-generation-node-layout') !== 'workbench') {
      throw new Error('高清放大节点没有采用统一的工作台布局')
    }
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
    await resizeCanvasNodeAndAssertHitBox(page, node, shell, '高清放大节点')

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
        mode: target?.data?.params?.falTopazPrecisionModel,
        manuallyResized: target?.data?.isSizeManuallyAdjusted,
        width: target?.width,
        height: target?.height,
        hasSourceEdge: edges.some((edge) => edge.source === '__ui_panorama_source' && edge.target === targetNodeId),
      }
    }, { targetProjectId: projectId, targetNodeId: nodeId })
    if (persisted.nodeType !== 'upscaleGenNode'
      || persisted.capabilityId !== 'image.upscale'
      || persisted.modelId !== 'fal-ai-topaz-image-upscale'
      || persisted.factor !== 2
      || persisted.mode !== 'High Fidelity V3'
      || persisted.manuallyResized !== true
      || persisted.width <= 640
      || persisted.height <= 300
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
    if (await shell.getAttribute('data-generation-node-layout') !== 'workbench') {
      throw new Error('人像质感节点没有采用统一的工作台布局')
    }
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

  Object.assign(context, {
    setupCanvasUpscaleNode,
    setupCanvasPortraitTextureNode,
  })
}

module.exports = { attachUiInspectionCanvasEnhance }
