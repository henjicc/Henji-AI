function attachUiInspectionCanvasWorkspace(context) {
  const {
    settlePage,
    canvasFixtureProjectId,
    clickNamedButton,
    paramFieldFromLabel,
    openWorkspace,
    waitForPageHeader,
    setupGeneration,
  } = context

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
    const expectedCapabilityCount = 15
    const expectedFalUtilityIds = [
      'image.preset-relight',
      'image.low-light-enhancement',
      'image.outpaint',
      'image.product-photography',
      'image.photo-restoration',
      'image.background-removal',
    ]
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
    if (await menuItems.count() !== expectedCapabilityCount - expectedInlineIds.length) {
      throw new Error('更多菜单未完整承接非直达能力')
    }
    const menuCapabilityIds = await menuItems.evaluateAll((elements) => (
      elements.map((element) => element.getAttribute('data-image-capability-id'))
    ))
    for (const capabilityId of expectedFalUtilityIds) {
      if (!menuCapabilityIds.includes(capabilityId)) {
        throw new Error(`更多菜单缺少 FAL 图片工具：${capabilityId}`)
      }
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
    if (disabledStates.length !== expectedCapabilityCount || disabledStates.some((state) => state !== 'true')) {
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
    if (await upscaleShell.getAttribute('data-generation-node-layout') !== 'workbench') {
      throw new Error('工具条功能节点没有采用统一的工作台布局')
    }
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
    if (await generatedShell.getAttribute('data-generation-node-layout') !== 'workbench') {
      throw new Error('全景工具节点没有采用统一的工作台布局')
    }
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

  Object.assign(context, {
    setupSettings,
    setupCanvas,
    seedAndOpenCanvasPanoramaProject,
    setupCanvasImageCapabilityToolbar,
    setupCanvasPanoramaToolbar,
  })
}

module.exports = { attachUiInspectionCanvasWorkspace }
