function attachUiInspectionCanvasMedia(context) {
  const {
    settlePage,
    canvasFixtureProjectId,
    setupCanvas,
  } = context

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

  Object.assign(context, {
    setupCanvasMidjourneyNode,
    setupCanvasGptMaskEditor,
    setupCanvasAssetGroup,
  })
}

module.exports = { attachUiInspectionCanvasMedia }
