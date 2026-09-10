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

  async function seedAndOpenCanvasPanoramaProject(page, toolbarBoundary = false, portrait = false) {
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
    const panoramaSource = await page.evaluate(async (portrait) => {
      const canvas = document.createElement('canvas')
      canvas.width = portrait ? 800 : 1600
      canvas.height = portrait ? 1200 : 800
      const context = canvas.getContext('2d')
      if (!context) throw new Error('全景场景无法创建本地 PNG')
      const sky = context.createLinearGradient(0, 0, 0, 800)
      sky.addColorStop(0, 'rgb(24,84,156)')
      sky.addColorStop(1, 'rgb(250,180,100)')
      context.fillStyle = sky
      context.fillRect(0, 0, canvas.width, canvas.height)
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
    }, portrait)
    const nodes = [{
      id: '__ui_panorama_source', type: 'uploadNode', position: { x: 100, y: 80 },
      width: 420, height: 210, measured: { width: 420, height: 210 }, style: { width: 420, height: 210 },
      data: {
        displayName: '本地全景参考图', imageUrl: panoramaSource,
        previewImageUrl: panoramaSource, aspectRatio: '2:1', isGenerating: false,
      },
    }, {
      id: '__ui_panorama_result', type: 'exportImageNode', hidden: !toolbarBoundary, position: toolbarBoundary ? { x: 100, y: 400 } : { x: 1400, y: 900 },
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
        [payload.nodes.length, JSON.stringify(payload.nodes), '[]', JSON.stringify({ x: payload.viewportX, y: 80, zoom: 0.65 }), JSON.stringify({ past: [], future: [], imagePool: [] }), payload.projectId]
      )
    }, { projectId, nodes, viewportX })
    await projectCard.click()
    await page.locator('.react-flow__node[data-id="__ui_panorama_source"]').waitFor({ state: 'visible', timeout: 12000 })
    return { panoramaSource, projectId }
  }

  async function setupCanvasMissingNodes(page) {
    const { projectId } = await seedAndOpenCanvasPanoramaProject(page)
    await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
    await settlePage(page)
    await page.evaluate(async (id) => {
      const record = await window.henjiNative.storyboardProjects.getProjectRecord(id)
      const source = JSON.parse(record.nodesJson)[0]
      const pool = JSON.parse(record.historyJson).imagePool
      for (const key of ['imageUrl', 'previewImageUrl']) {
        if (source.data[key]?.startsWith('__img_ref__:')) source.data[key] = pool[Number(source.data[key].slice(12))]
      }
      source.position = { x: 40, y: 120 }
      source.width = 240; source.height = 120
      source.style = { width: 240, height: 120 }; source.measured = { width: 240, height: 120 }
      const nodes = [source, {
        id: '__missing_model', type: 'imageNode', position: { x: 360, y: 100 }, width: 320, height: 200,
        style: { width: 320, height: 200 }, data: { displayName: '商品摄影', modelId: 'removed-product-model',
          capabilityId: 'image.product-photography', params: { image: '__img_ref__:0', prompt: '保留原参数' } },
      }, {
        id: '__missing_type', type: 'removedExtensionNode', position: { x: 760, y: 100 }, width: 320, height: 200,
        style: { width: 320, height: 200 }, data: { displayName: '缺失的扩展节点', originalSettings: { value: 42 } },
      }]
      const edges = [
        { id: '__missing_input', source: source.id, target: '__missing_model', sourceHandle: 'source', targetHandle: 'param:__image', type: 'disconnectableEdge' },
        { id: '__missing_output', source: '__missing_model', target: '__missing_type', sourceHandle: 'custom', targetHandle: 'custom', type: 'disconnectableEdge' },
      ]
      await window.henjiNative.storyboardProjects.upsertProjectRecord({ ...record, nodeCount: nodes.length,
        nodesJson: JSON.stringify(nodes), edgesJson: JSON.stringify(edges), viewportJson: JSON.stringify({ x: 40, y: 100, zoom: 0.9 }),
        historyJson: JSON.stringify({ past: [{ nodes, edges }], future: [], imagePool: [source.data.imageUrl] }) })
    }, projectId)
    await page.reload()
    await setupCanvas(page)
    const card = page.locator(`[data-project-id="${projectId}"]:visible`)
    await card.waitFor({ state: 'visible', timeout: 15000 })
    await card.click()
    await page.locator('[data-missing-node="true"]').first().waitFor({ state: 'visible', timeout: 15000 })
    await page.locator('[data-missing-node="true"]').first().getByText('节点缺失', { exact: true }).waitFor({ state: 'visible' })
    if (await page.locator('[data-missing-node="true"]').count() !== 2) throw new Error('缺失节点未完整显示')
    if (await page.locator('.react-flow__edge').count() !== 2) throw new Error('缺失节点的原连线丢失')
    await page.locator('.react-flow__node[data-id="__missing_model"]').click()
    if (await page.locator('[data-node-toolbar-panel]').getByRole('button', { name: /^生成$/ }).filter({ visible: true }).count()) throw new Error('缺失节点仍然允许生成')
    await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
    await settlePage(page)
    const preserved = await page.evaluate(async (id) => {
      const record = await window.henjiNative.storyboardProjects.getProjectRecord(id)
      const nodes = JSON.parse(record.nodesJson)
      return nodes.find((node) => node.id === '__missing_type').type === 'removedExtensionNode'
        && nodes.find((node) => node.id === '__missing_model').data.params.image === '__img_ref__:0'
        && JSON.parse(record.historyJson).imagePool.length >= 1
    }, projectId)
    if (!preserved) throw new Error('占位渲染覆盖了原工程数据')
    await page.locator(`[data-project-id="${projectId}"]:visible`).click()
    await page.locator('[data-missing-node="true"]').first().waitFor({ state: 'visible' })
    await settlePage(page)
  }

  async function setupCanvasImageCapabilityToolbar(page) {
    const expectedCapabilityCount = 12
    const expectedFalUtilityIds = [
      'image.preset-relight',
      'image.outpaint',
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
    if (await upscaleShell.getAttribute('data-generation-node-layout') !== 'stacked') {
      throw new Error('工具条功能节点没有采用紧凑参数布局')
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

  async function setupCanvasToolbarBoundary(page) {
    // 仅在隔离场景中设置菜单夹具，不触发下载或付费生成。
    await page.evaluate(() => {
      const settings = JSON.parse(localStorage.getItem('settings-storage') || '{}')
      settings.state = { ...settings.state, downloadPresetPaths: ['/tmp/toolbar-download-fixture'] }
      localStorage.setItem('settings-storage', JSON.stringify(settings))
      localStorage.setItem('enable_quick_download', 'false')
    })
    await page.reload()
    await seedAndOpenCanvasPanoramaProject(page, true)
    const source = page.locator('.react-flow__node[data-id="__ui_panorama_source"]')
    const other = page.locator('.react-flow__node[data-id="__ui_panorama_result"]')
    const assertInside = async (selector) => {
      await page.waitForFunction((selector) => {
        const element = document.querySelector(selector)
        const renderer = document.querySelector('.react-flow__renderer')
        if (!element || !renderer) return false
        const box = element.getBoundingClientRect()
        const area = renderer.getBoundingClientRect()
        return box.width > 0 && box.height > 0 && box.left >= area.left + 11 && box.top >= area.top + 7
          && box.right <= Math.min(area.right, innerWidth) - 7 && box.bottom <= Math.min(area.bottom, innerHeight) - 7
      }, selector, { timeout: 5000 })
    }
    await source.click()
    const renderer = await page.locator('.react-flow__renderer').boundingBox()
    for (const [name, x, y] of [
      ['left', renderer.x + 20, renderer.y + 210],
      ['bottom', renderer.x + renderer.width / 2 - 140, renderer.y + renderer.height - 180],
      ['right', renderer.x + renderer.width - 290, renderer.y + 210],
      ['top', renderer.x + 20, renderer.y + 30],
    ]) {
      const box = await source.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(x + box.width / 2, y + box.height / 2, { steps: 12 })
      await page.mouse.up()
      await settlePage(page, 200)
      await assertInside('[data-node-toolbar-panel]')
      const overflow = await page.locator('[data-node-toolbar-panel]').evaluate((element) => element.scrollWidth > element.clientWidth + 2)
      if (overflow) throw new Error(`${name} 工具栏未充分收纳按钮`)
    }
    if (await page.locator('.react-flow__node-toolbar').getAttribute('data-toolbar-side') !== 'below') {
      throw new Error('顶部工具栏没有避让到图片下方')
    }
    const capacity = await page.evaluate(() => ({
      width: document.querySelector('.react-flow__renderer').clientWidth,
      inline: document.querySelectorAll('[data-image-capability-placement="inline"]').length,
    }))
    if (capacity.width < 950 && capacity.inline >= 4) throw new Error(`窄画布没有收纳图片功能：${JSON.stringify(capacity)}`)
    const samples = await page.evaluate(async () => {
      const samples = []
      for (let i = 0; i < 8; i++) {
        await new Promise(requestAnimationFrame)
        const toolbar = document.querySelector('.react-flow__node-toolbar')
        const box = toolbar.getBoundingClientRect()
        samples.push({ left: box.left, top: box.top, width: box.width, translate: toolbar.style.translate, transform: toolbar.style.transform })
      }
      return samples
    })
    if (samples.some((sample) => Math.abs(sample.left - samples[0].left) > 0 || Math.abs(sample.top - samples[0].top) > 0 || Math.abs(sample.width - samples[0].width) > 0)) {
      throw new Error(`静止工具栏持续抖动：${JSON.stringify(samples)}`)
    }
    const size = await page.evaluate(() => `${innerWidth}x${innerHeight}`)
    await page.screenshot({ path: `.ui-tour/${size}-toolbar-top.png` })
    await page.locator('[data-image-capability-more="true"]').click()
    await assertInside('[data-panel-placement]')
    const capabilities = await page.locator('[data-image-capability-id]').count()
    if (capabilities !== 12) throw new Error(`收纳后功能丢失：${capabilities}`)
    await page.keyboard.press('Escape')
    await settlePage(page, 250)
    await page.locator('[data-node-toolbar-panel]').getByRole('button', { name: /^(下载|Download)$/i }).click()
    await assertInside('[data-node-download-menu]')
    await page.screenshot({ path: `.ui-tour/${size}-toolbar-download.png` })
    await source.click()
    await other.click({ modifiers: ['Meta'] })
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node.selected').length === 2)
    await assertInside('[data-node-toolbar-panel]')
    await page.locator('.react-flow__pane').click({ position: { x: renderer.width - 30, y: renderer.height / 2 } })
    await source.click()
    await page.locator('[data-image-capability-more="true"]').click()
    await assertInside('[data-panel-placement]')
    await page.getByRole('button', { name: '智能助手', exact: true }).click()
    await settlePage(page, 400)
    await page.keyboard.press('Escape')
    await settlePage(page, 250)
    await assertInside('[data-node-toolbar-panel]')
    const compact = await page.locator('[data-node-toolbar-panel]').evaluate((element) => ({
      overflow: element.scrollWidth > element.clientWidth + 2,
      inline: element.querySelectorAll('[data-image-capability-placement="inline"]').length,
      canvasWidth: element.closest('.react-flow__renderer').clientWidth,
    }))
    if (compact.overflow || (compact.canvasWidth < 950 && compact.inline >= 4)) {
      throw new Error(`侧栏挤占空间后没有收纳工具栏：${JSON.stringify(compact)}`)
    }
    await page.locator('[data-image-capability-more="true"]').click()
    await assertInside('[data-panel-placement]')
    await settlePage(page, 250)
    await page.screenshot({ path: `.ui-tour/${size}-toolbar-sidebar.png` })
    await page.getByRole('button', { name: '智能助手', exact: true }).click()
    await settlePage(page, 400)
    await page.keyboard.press('Escape')
    await settlePage(page, 250)
    await page.locator('[data-image-capability-more="true"]').click()
    await settlePage(page, 250)
  }

  async function setupCanvasOutpaint(page) {
    const { projectId } = await seedAndOpenCanvasPanoramaProject(page, false, true)
    await page.locator('.react-flow__node[data-id="__ui_panorama_source"]').click()
    await page.locator('[data-image-capability-more="true"]:visible').click()
    await page.locator('[data-image-capability-id="image.outpaint"]:visible').click()
    const stage = page.locator('[data-outpaint-stage]')
    await stage.waitFor({ state: 'visible', timeout: 12000 })
    await stage.locator('[data-crop-frame]').waitFor({ state: 'visible' })
    const geometry = async () => stage.evaluate(element => {
      const image = element.querySelector('img').getBoundingClientRect()
      const frame = element.querySelector('[data-crop-frame]').getBoundingClientRect()
      return { image: { x: image.x, y: image.y, width: image.width, height: image.height },
        frame: { x: frame.x, y: frame.y, width: frame.width, height: frame.height } }
    })
    const initial = await geometry()
    if (Math.abs(initial.frame.width / initial.image.width - 1.2) > 0.02
      || Math.abs(initial.frame.height / initial.image.height - 1.2) > 0.02) {
      throw new Error(`扩图默认框不是原图的 120%：${JSON.stringify(initial)}`)
    }
    const right = await stage.locator('[data-crop-handle="e"]').boundingBox()
    await page.mouse.move(right.x + right.width / 2, right.y + right.height / 2)
    await page.mouse.down()
    await page.mouse.move(right.x + right.width / 2 + 20, right.y + right.height / 2, { steps: 10 })
    const during = await geometry()
    if (Math.abs(during.frame.width - initial.frame.width - 20) > 2) throw new Error('画布缩放下扩图框未跟随指针')
    await page.mouse.up()
    const left = await stage.locator('[data-crop-handle="w"]').boundingBox()
    await page.mouse.move(left.x + left.width / 2, left.y + left.height / 2)
    await page.mouse.down()
    await page.mouse.move(left.x + left.width / 2 + 100, left.y + left.height / 2, { steps: 10 })
    await page.mouse.up()
    const clamped = await geometry()
    if (Math.abs(clamped.frame.x - clamped.image.x) > 2) throw new Error('扩图向内拖动裁掉了原图')
    const shell = stage.locator('xpath=ancestor::*[@data-generation-node-id]')
    const nodeId = await shell.getAttribute('data-generation-node-id')
    if (await shell.getByText('图片', { exact: true }).count()) throw new Error('已有扩图工作面时仍重复显示图片输入行')
    await page.locator('.react-flow__node[data-id="__ui_panorama_source"]').click()
    if (!await stage.isVisible()) throw new Error('取消选中后扩图工作面丢失')
    await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
    await settlePage(page)
    const params = await page.evaluate(async ({ projectId, nodeId }) => {
      const record = await window.henjiNative.storyboardProjects.getProjectRecord(projectId)
      return JSON.parse(record.nodesJson).find(node => node.id === nodeId).data.params
    }, { projectId, nodeId })
    if (params.expandLeft !== 0 || params.expandRight <= 80 || params.zoomOutPercentage !== 0) {
      throw new Error(`扩图参数保存错误：${JSON.stringify(params)}`)
    }
    await page.locator(`[data-project-id="${projectId}"]:visible`).click()
    await stage.locator('[data-crop-frame]').waitFor({ state: 'visible' })
    const reopened = await geometry()
    if (Math.abs(reopened.frame.width / reopened.image.width - (800 + params.expandRight) / 800) > 0.02) {
      throw new Error('重新打开后扩图框与保存参数不一致')
    }
    const bottom = await stage.locator('[data-crop-handle="s"]').boundingBox()
    await page.mouse.move(bottom.x + bottom.width / 2, bottom.y + bottom.height / 2)
    await page.mouse.down()
    await page.mouse.move(bottom.x + bottom.width / 2, bottom.y + bottom.height / 2 + 300, { steps: 20 })
    const expanded = await geometry()
    if (Math.abs(expanded.image.width - reopened.image.width) > 1) throw new Error('拖动扩图框触发了自动缩放')
    const stageBox = await stage.boundingBox()
    if (expanded.frame.y < stageBox.y || expanded.frame.y + expanded.frame.height > stageBox.y + stageBox.height) {
      throw new Error('拖动期间扩图框超出工作面，未实时适配')
    }
    await page.mouse.up()
    const released = await geometry()
    for (const key of ['x', 'y', 'width', 'height']) {
      if (Math.abs(expanded.frame[key] - released.frame[key]) > 1) throw new Error('扩图松手后位置或缩放跳变')
    }
    await page.mouse.move(released.frame.x + released.frame.width / 2, released.frame.y + released.frame.height / 2)
    await page.mouse.down()
    await page.mouse.move(released.frame.x + released.frame.width / 2 + 100, released.frame.y + released.frame.height / 2, { steps: 20 })
    const moved = await geometry()
    if (Math.abs(moved.image.width - released.image.width) > 1 || Math.abs(moved.frame.width - released.frame.width) > 1) {
      throw new Error('扩图框平移改变了比例或输出尺寸')
    }
    if (Math.abs(moved.frame.x - released.frame.x) > 1 || moved.image.x <= released.image.x + 1) throw new Error('拖动未移动图片或错误移动了框')
    await page.mouse.up()
    const beforeWheel = await geometry()
    const flowTransform = await page.locator('.react-flow__viewport').getAttribute('style')
    await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2)
    await page.mouse.wheel(0, 100)
    await page.waitForTimeout(100)
    const zoomedOut = await geometry()
    if (zoomedOut.image.width >= beforeWheel.image.width - 1) throw new Error('滚轮未缩小扩图工作面')
    for (const key of ['x', 'y', 'width', 'height']) {
      if (Math.abs(zoomedOut.frame[key] - beforeWheel.frame[key]) > 1) throw new Error('滚轮移动或缩放了输出框')
    }
    if (await page.locator('.react-flow__viewport').getAttribute('style') !== flowTransform) throw new Error('扩图滚轮影响了整个画布')
    await page.mouse.wheel(0, -100)
    await page.waitForTimeout(100)
    if (Math.abs((await geometry()).image.width - beforeWheel.image.width) > 1) throw new Error('滚轮放大未恢复查看倍率')
    if (await stage.getByText(/\d+\s*×\s*\d+/).count()) throw new Error('扩图仍显示多余分辨率文字')
    const current = await geometry()
    const centerX = current.frame.x + current.frame.width / 2
    const centerY = current.frame.y + current.frame.height / 2
    await page.mouse.move(centerX, centerY)
    await page.mouse.down()
    await page.mouse.move(centerX + stageBox.x + stageBox.width / 2 - current.image.x - current.image.width / 2,
      centerY + stageBox.y + stageBox.height / 2 - current.image.y - current.image.height / 2, { steps: 10 })
    await page.mouse.up()
    for (const [handle, x, y] of [['nw', stageBox.x - 100, stageBox.y - 100], ['se', stageBox.x + stageBox.width + 100, stageBox.y + stageBox.height + 100]]) {
      const point = await stage.locator(`[data-crop-handle="${handle}"]`).boundingBox()
      await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2)
      await page.mouse.down()
      await page.mouse.move(x, y, { steps: 10 })
      await page.mouse.up()
    }
    const maximum = await geometry()
    for (const key of ['x', 'y', 'width', 'height']) {
      if (Math.abs(maximum.frame[key] - stageBox[key]) > 2) throw new Error(`最大框仍有工作面空档 ${key}: ${JSON.stringify({ maximum, stageBox })}`)
    }
    await shell.click({ position: { x: 8, y: 8 } })
    await settlePage(page)
  }

  async function setupCanvasParameterTools(page) {
    await seedAndOpenCanvasPanoramaProject(page)
    const source = page.locator('.react-flow__node[data-id="__ui_panorama_source"]')
    const capabilities = [
      'image.panorama', 'image.upscale',
      'image.preset-relight',
      'image.photo-restoration', 'image.background-removal',
      'image.layer-separation',
    ]
    for (const capabilityId of capabilities) {
      await source.click()
      let action = page.locator(`[data-image-capability-id="${capabilityId}"]:visible`)
      if (!(await action.count())) {
        await page.locator('[data-image-capability-more="true"]:visible').click()
        action = page.locator(`[data-image-capability-id="${capabilityId}"]:visible`)
      }
      await action.click()
      const node = page.locator('.react-flow__node.selected').filter({ has: page.locator('[data-generation-node-id]') })
      const shell = node.locator('[data-generation-node-id]')
      await shell.waitFor({ state: 'visible', timeout: 12000 })
      await settlePage(page, 250)
      const layout = await shell.evaluate((element) => ({
        mode: element.getAttribute('data-generation-node-layout'),
        width: element.offsetWidth,
        largeImageCount: Array.from(element.querySelectorAll('img')).filter((img) => img.offsetWidth > 96 || img.offsetHeight > 96).length,
      }))
      if (layout.mode !== 'stacked' || layout.width > 360 || layout.largeImageCount !== 0) {
        throw new Error(`${capabilityId} 应只保留紧凑参数与输入缩略图：${JSON.stringify(layout)}`)
      }
      if (capabilityId !== capabilities.at(-1)) {
        await page.getByRole('button', { name: /^(删除|Delete)$/i }).filter({ visible: true }).click()
        await shell.waitFor({ state: 'detached', timeout: 8000 })
      }
    }
    await settlePage(page, 800)
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
    if (await generatedShell.getAttribute('data-generation-node-layout') !== 'stacked') {
      throw new Error('全景工具节点没有采用紧凑参数布局')
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
    setupCanvasMissingNodes,
    setupCanvasImageCapabilityToolbar,
    setupCanvasPanoramaToolbar,
    setupCanvasParameterTools,
    setupCanvasOutpaint,
    setupCanvasToolbarBoundary,
  })
}

module.exports = { attachUiInspectionCanvasWorkspace }
