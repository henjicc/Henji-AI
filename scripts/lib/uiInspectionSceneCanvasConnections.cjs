function attachUiInspectionCanvasConnections(context) {
  const {
    settlePage,
    canvasFixtureProjectId,
    REFERENCE_FIXTURE_IMAGE,
    clickNamedButton,
    setupCanvas,
    setupCanvasAssetGroup,
  } = context

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

  Object.assign(context, {
    setupCanvasBatchConnection,
    setupCanvasAssetGroupRemoveConfirmation,
    setupCanvasQuickConnectPrompt,
  })
}

module.exports = { attachUiInspectionCanvasConnections }
