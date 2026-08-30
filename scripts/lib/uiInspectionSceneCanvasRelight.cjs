function attachUiInspectionCanvasRelight(context) {
  const {
    settlePage,
    clickCanvasCapabilityAction,
    resizeCanvasNodeAndAssertHitBox,
    seedAndOpenCanvasPanoramaProject,
  } = context

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

    const editor = page.locator(`[data-relight-node-id="${relightNodeId}"] [data-relight-workbench="true"]`)
    await editor.waitFor({ state: 'visible', timeout: 12000 })
    const relightNode = relightShell.locator('xpath=ancestor::*[contains(@class,"react-flow__node")][1]')
    await resizeCanvasNodeAndAssertHitBox(page, relightNode, relightShell, '图片打光节点')
    await editor.getByText('主光方向 · 离散偏好', { exact: true })
      .waitFor({ state: 'visible', timeout: 8000 })
    const directionControl = editor.locator('[data-relight-direction-control="true"]')
    await directionControl.waitFor({ state: 'visible', timeout: 8000 })
    const directionBox = await directionControl.boundingBox()
    if (!directionBox) throw new Error('图片打光可视化方向控件没有可交互尺寸')
    const directionHitTargets = await page.evaluate(({ center, right }) => {
      const describe = ({ x, y }) => {
        const hit = document.elementFromPoint(x, y)
        return {
          tag: hit?.tagName ?? null,
          className: typeof hit?.className === 'string' ? hit.className : null,
          control: Boolean(hit?.closest?.('[data-relight-direction-control="true"]')),
          nodeId: hit?.closest?.('.react-flow__node[data-id]')?.getAttribute('data-id') ?? null,
        }
      }
      return { center: describe(center), right: describe(right) }
    }, {
      center: { x: directionBox.x + directionBox.width / 2, y: directionBox.y + directionBox.height / 2 },
      right: { x: directionBox.x + directionBox.width * 0.84, y: directionBox.y + directionBox.height / 2 },
    })
    await page.mouse.move(directionBox.x + directionBox.width / 2, directionBox.y + directionBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(directionBox.x + directionBox.width * 0.84, directionBox.y + directionBox.height / 2, { steps: 10 })
    await page.mouse.up()
    await page.waitForFunction((nodeId) => (
      document.querySelector(`[data-relight-node-id="${nodeId}"] [data-relight-direction-control="true"]`)
        ?.getAttribute('data-relight-direction') === 'right'
    ), relightNodeId, { timeout: 3000 }).catch(async () => {
      throw new Error(`图片打光拖拽没有映射到右侧模型方向，实际为 ${await directionControl.getAttribute('data-relight-direction')}，命中为 ${JSON.stringify(directionHitTargets)}`)
    })
    await editor.getByText('模型方向 · 右侧', { exact: true }).waitFor({ state: 'visible', timeout: 8000 })
    await editor.getByRole('button', { name: /智能打光/ }).click()
    await editor.getByRole('button', { name: /霓虹氛围/ }).click()
    await editor.getByPlaceholder('例如：在保留背景布局的前提下增强商品高光')
      .fill('保留主体与文字，只调整光照氛围')
    const smartRelightShell = page.locator(`[data-relight-node-id="${relightNodeId}"][data-relight-mode="smart"]`)
    await smartRelightShell.waitFor({ state: 'visible', timeout: 8000 })

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
        manuallyResized: node?.data?.isSizeManuallyAdjusted,
        width: node?.width,
        height: node?.height,
        hasSourceEdge: edges.some((edge) => edge.source === '__ui_panorama_source' && edge.target === targetNodeId),
      }
    }, { targetProjectId: projectId, targetNodeId: relightNodeId })
    if (persisted.nodeType !== 'relightGenNode'
      || persisted.lightingMode !== 'smart'
      || persisted.preset !== 'neon'
      || persisted.templateVersion !== 'relight-smart-gpt-image-2-v1'
      || persisted.referenceCount !== 0
      || persisted.manuallyResized !== true
      || persisted.width <= 680
      || persisted.height <= 360
      || !persisted.hasSourceEdge) {
      throw new Error(`图片打光保存语义或连线丢失：${JSON.stringify(persisted)}`)
    }

    await page.locator(`[data-project-id="${projectId}"]:visible`).click()
    const reopened = page.locator(`[data-relight-node-id="${relightNodeId}"][data-relight-mode="smart"]`)
    await reopened.waitFor({ state: 'visible', timeout: 12000 })
    await reopened.click()
    const reopenedEditor = page.locator(`[data-relight-node-id="${relightNodeId}"] [data-relight-workbench="true"]`)
    await reopenedEditor.waitFor({ state: 'visible', timeout: 12000 })
    await reopenedEditor.getByText('氛围预设 · 模型近似').waitFor({ state: 'visible', timeout: 8000 })
    await reopenedEditor.getByRole('button', { name: /手动打光/ }).click()
    await reopenedEditor.locator('[data-relight-direction-control="true"][data-relight-direction="right"]')
      .waitFor({ state: 'visible', timeout: 8000 })
    await reopenedEditor.getByRole('button', { name: '正面', exact: true }).click()
    await reopenedEditor.getByRole('button', { name: '透视', exact: true }).click()
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
    if (await shell.locator('[contenteditable="true"], textarea').count()) {
      throw new Error('多角度节点不应显示伪提示词编辑器')
    }

    const editor = page.locator(`[data-multi-angle-node-id="${nodeId}"] [data-multi-angle-workbench="true"]`)
    await editor.waitFor({ state: 'visible', timeout: 12000 })
    const multiAngleNode = shell.locator('xpath=ancestor::*[contains(@class,"react-flow__node")][1]')
    await resizeCanvasNodeAndAssertHitBox(page, multiAngleNode, shell, '多角度节点')
    await editor.locator('[data-multi-angle-orbit="demand"] canvas').waitFor({ state: 'visible', timeout: 12000 })
    await editor.getByText(/不代表真实焦距/).waitFor({ state: 'visible', timeout: 8000 })
    if (await editor.locator('textarea, [contenteditable="true"]').count()) throw new Error('角度编辑器不应显示提示词')

    const cameraControl = editor.locator('[data-multi-angle-camera-control="true"]')
    const cameraBounds = await cameraControl.boundingBox()
    if (!cameraBounds) throw new Error('多角度可视化镜头控制区域不可见')
    const initialYaw = Number(await cameraControl.getAttribute('data-multi-angle-yaw'))
    await page.mouse.move(cameraBounds.x + cameraBounds.width / 2, cameraBounds.y + cameraBounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(cameraBounds.x + cameraBounds.width / 2 + 80, cameraBounds.y + cameraBounds.height / 2 - 60, { steps: 8 })
    await page.mouse.up()
    const draggedCamera = await cameraControl.evaluate((element) => ({
      yaw: Number(element.getAttribute('data-multi-angle-yaw')),
      vertical: Number(element.getAttribute('data-multi-angle-vertical')),
    }))
    if (!(draggedCamera.yaw < initialYaw) || !(draggedCamera.vertical < 0)) {
      throw new Error(`多角度镜头拖拽未同步模型控制量：${JSON.stringify(draggedCamera)}`)
    }

    await editor.getByRole('button', { name: /完整方位/ }).click()
    await editor.getByRole('button', { name: /^顶视$/ }).click()
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
        manuallyResized: node?.data?.isSizeManuallyAdjusted,
        width: node?.width,
        height: node?.height,
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
      || persisted.manuallyResized !== true
      || persisted.width <= 720
      || persisted.height <= 400
      || !persisted.hasSourceEdge) {
      throw new Error(`多角度保存语义或连线丢失：${JSON.stringify(persisted)}`)
    }

    await page.locator(`[data-project-id="${projectId}"]:visible`).click()
    const reopened = page.locator(`[data-multi-angle-node-id="${nodeId}"][data-multi-angle-profile="discrete-v1"]`)
    await reopened.waitFor({ state: 'visible', timeout: 12000 })
    await reopened.click()
    const reopenedEditor = page.locator(`[data-multi-angle-node-id="${nodeId}"] [data-multi-angle-workbench="true"]`)
    await reopenedEditor.waitFor({ state: 'visible', timeout: 12000 })
    await reopenedEditor.getByRole('button', { name: /^顶视$/ }).waitFor({ state: 'visible', timeout: 8000 })
    await reopenedEditor.getByRole('button', { name: /连续控制/ }).click()
    const reopenedCameraControl = reopenedEditor.locator('[data-multi-angle-camera-control="true"][data-multi-angle-profile="continuous"]')
    await reopenedCameraControl.waitFor({ state: 'visible', timeout: 8000 })
    const reopenedBounds = await reopenedCameraControl.boundingBox()
    if (!reopenedBounds) throw new Error('重新打开后多角度镜头控制区域不可见')
    await page.mouse.move(reopenedBounds.x + reopenedBounds.width / 2, reopenedBounds.y + reopenedBounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(reopenedBounds.x + reopenedBounds.width / 2 + 72, reopenedBounds.y + reopenedBounds.height / 2 - 48, { steps: 8 })
    await page.mouse.up()
    await settlePage(page, 900)
  }

  Object.assign(context, {
    setupCanvasRelightEditor,
    setupCanvasMultiAngleEditor,
  })
}

module.exports = { attachUiInspectionCanvasRelight }
