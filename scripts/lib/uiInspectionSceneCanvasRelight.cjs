const { writeFile } = require('node:fs/promises')
const { captureInspectionPage } = require('./uiInspectionCapture.cjs')
const { verifyRelightRim } = require('./uiInspectionRelightRim.cjs')
const { prepareRelightPortrait, verifyRelightSpatial } = require('./uiInspectionRelightSpatial.cjs')
const { assertStableWorkbenchSelection } = require('./uiInspectionWorkbenchSelection.cjs')
const { readRelightLayout, switchRelightMode, verifyRelightResizeModes, ensureWorkbenchInViewport, assertWorkbenchHeaderAlignment } = require('./uiInspectionRelightLayout.cjs')

function attachUiInspectionCanvasRelight(context) {
  const {
    settlePage,
    clickCanvasCapabilityAction,
    resizeCanvasNodeAndAssertHitBox,
    seedAndOpenCanvasPanoramaProject,
  } = context

  async function assertWorkbenchImageInput(shell) {
    const geometry = await shell.evaluate((element) => {
      const inputs = element.querySelectorAll('.react-flow__handle[data-handleid="param:__image"]')
      const nodeBox = element.getBoundingClientRect()
      const inputBox = inputs[0]?.getBoundingClientRect()
      return {
        count: inputs.length,
        left: nodeBox.left,
        inputX: inputBox ? inputBox.left + inputBox.width / 2 : null,
        opacity: inputs[0] ? Number(getComputedStyle(inputs[0]).opacity) : 0,
      }
    })
    if (geometry.count !== 1 || geometry.inputX === null || Math.abs(geometry.inputX - geometry.left) > 2 || geometry.opacity === 0) {
      throw new Error(`工作台已连接图片端口必须唯一、可见并位于节点最左侧：${JSON.stringify(geometry)}`)
    }
  }

  async function verifyWorkbenchSelection(page, shell, sourceNode, editor, electronApp, name, restoreSelection = true) {
    await ensureWorkbenchInViewport(page, shell)
    await assertWorkbenchHeaderAlignment(shell)
    await assertWorkbenchImageInput(shell)
    await assertStableWorkbenchSelection(page, shell, sourceNode, editor, electronApp, name, restoreSelection)
    await assertWorkbenchImageInput(shell)
  }

  async function setupCanvasRelightEditor(page, electronApp) {
    const { projectId } = await seedAndOpenCanvasPanoramaProject(page)
    await prepareRelightPortrait(page, projectId)
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
    const defaultLayout = await editor.evaluate((element) => {
      const inspector = element.querySelector('[data-relight-inspector]')
      const stage = element.querySelector('[data-relight-direction-control]')?.getBoundingClientRect()
      return { overflow: inspector.scrollHeight - inspector.clientHeight,
        stage: stage && { width: stage.width, height: stage.height },
        images: element.querySelectorAll('img').length }
    })
    if (defaultLayout.overflow > 1 || defaultLayout.images !== 1
      || !defaultLayout.stage || defaultLayout.stage.width < 140
      || Math.abs(defaultLayout.stage.width - defaultLayout.stage.height) > 1) {
      throw new Error(`打光默认布局裁切或重复显示原图：${JSON.stringify(defaultLayout)}`)
    }
    await writeFile('.ui-tour/canvas-relight-default.png', await captureInspectionPage(electronApp, page))
    await switchRelightMode(page, relightNodeId, '智能打光')
    const smartOverflow = await editor.locator('[data-relight-inspector]').evaluate((element) => element.scrollHeight - element.clientHeight)
    if (smartOverflow > 1) throw new Error(`智能打光默认尺寸未完整显示参数：${smartOverflow}`)
    await page.waitForTimeout(250) // 等按钮选中态颜色过渡结束再截图。
    await writeFile('.ui-tour/canvas-relight-smart-default.png', await captureInspectionPage(electronApp, page))
    await switchRelightMode(page, relightNodeId, '手动打光')
    await editor.getByRole('slider', { name: '色调', exact: true }).focus()
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowRight')
    await editor.getByRole('switch', { name: '轮廓光', exact: true }).click()
    await editor.getByPlaceholder('例如：保留商品标签清晰可读').fill('保留商品标签清晰可读')
    const beforeResize = await readRelightLayout(page, relightNodeId)
    await resizeCanvasNodeAndAssertHitBox(page, relightNode, relightShell, '图片打光节点')
    const afterResize = await readRelightLayout(page, relightNodeId)
    if (afterResize.fieldHeight < beforeResize.fieldHeight + 8) throw new Error('手动打光输入框没有随节点增高')
    await verifyRelightResizeModes(page, relightNodeId, resizeCanvasNodeAndAssertHitBox, electronApp)
    await verifyWorkbenchSelection(page, relightShell, sourceNode, editor, electronApp, 'relight')
    await editor.getByText('主光方向', { exact: true })
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
    if (await editor.getByRole('group', { name: '主光方向预设' }).count()) throw new Error('仍存在已移除的方位按钮')
    await verifyLightingSliders(page, editor, electronApp)
    await verifyRelightRim(page, editor, electronApp)
    const savedSpatial = await verifyRelightSpatial(page, editor, electronApp)
    await editor.getByRole('button', { name: /智能打光/ }).click()
    await editor.getByRole('button', { name: '氛围预设', exact: true }).click()
    await page.getByRole('option', { name: '霓虹氛围', exact: true }).click()
    await editor.getByPlaceholder('例如：在保留背景布局的前提下增强商品高光')
      .fill('保留主体与文字，只调整光照氛围')
    const smartRelightShell = page.locator(`[data-relight-node-id="${relightNodeId}"][data-relight-mode="smart"]`)
    await smartRelightShell.waitFor({ state: 'visible', timeout: 8000 })
    await sourceNode.click()
    await page.mouse.move(20, 100)
    await assertWorkbenchImageInput(smartRelightShell)
    if (await editor.locator('[data-relight-direction-control], img').evaluateAll((elements) =>
      elements.some((element) => element.hasAttribute('data-relight-direction-control') || element.offsetWidth > 96 || element.offsetHeight > 96))) {
      throw new Error('智能打光不应保留手动灯位或重复源图大图')
    }


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
        manual: node?.data?.relightSettings?.manual,
        preset: node?.data?.relightSettings?.smart?.preset,
        templateVersion: node?.data?.promptTemplateVersion,
        referenceCount: node?.data?.relightSettings?.smart?.lightingReferenceImages?.length,
        manuallyResized: node?.data?.isSizeManuallyAdjusted,
        width: node?.width,
        height: node?.height,
        modeSizes: node?.data?.relightModeSizes,
        hasSourceEdge: edges.some((edge) => edge.source === '__ui_panorama_source' && edge.target === targetNodeId),
      }
    }, { targetProjectId: projectId, targetNodeId: relightNodeId })
    if (persisted.nodeType !== 'relightGenNode'
      || persisted.lightingMode !== 'smart'
      || persisted.preset !== 'neon'
      || persisted.manual?.colorPreset !== 'warm'
      || persisted.manual?.brightness !== 2
      || persisted.manual?.rimDirection !== 'top-left'
      || persisted.manual?.extraPrompt !== '保留商品标签清晰可读'
      || persisted.templateVersion !== 'relight-smart-gpt-image-2-v1'
      || persisted.referenceCount !== 0
      || persisted.manuallyResized !== true
      || persisted.width <= 360
      || persisted.modeSizes?.manual?.width <= 720
      || persisted.height <= 420
      || !persisted.hasSourceEdge) {
      throw new Error(`图片打光保存语义或连线丢失：${JSON.stringify(persisted)}`)
    }

    // 模拟旧版本保存的自动尺寸，确认新默认大小不会被旧测量盒裁切。
    await page.evaluate(async ({ projectId, nodeId }) => {
      const rows = await window.henjiNative.db.select('SELECT nodes_json FROM storyboard_projects WHERE id = ?', [projectId])
      const nodes = JSON.parse(rows[0].nodes_json)
      const node = nodes.find((item) => item.id === nodeId)
      node.data.isSizeManuallyAdjusted = false
      node.width = 680
      node.height = 360
      node.style = { ...node.style, width: 680, height: 360 }
      await window.henjiNative.db.execute('UPDATE storyboard_projects SET nodes_json = ? WHERE id = ?', [JSON.stringify(nodes), projectId])
    }, { projectId, nodeId: relightNodeId })
    await page.locator(`[data-project-id="${projectId}"]:visible`).click()
    const reopened = page.locator(`[data-relight-node-id="${relightNodeId}"][data-relight-mode="smart"]`)
    await reopened.waitFor({ state: 'visible', timeout: 12000 })
    await reopened.click()
    const reopenedEditor = page.locator(`[data-relight-node-id="${relightNodeId}"] [data-relight-workbench="true"]`)
    await reopenedEditor.waitFor({ state: 'visible', timeout: 12000 })
    await reopenedEditor.getByText('氛围预设').waitFor({ state: 'visible', timeout: 8000 })
    await reopenedEditor.getByRole('button', { name: /手动打光/ }).click()
    await reopenedEditor.locator('[data-relight-direction-control="true"][data-relight-direction="right"]')
      .waitFor({ state: 'visible', timeout: 8000 })
    if (await reopenedEditor.getByRole('slider', { name: '轮廓光方向' }).getAttribute('aria-valuetext') !== '左上') {
      throw new Error('轮廓光灯位重开后没有恢复')
    }
    if (await reopenedEditor.getByRole('slider', { name: '主光方向' }).getAttribute('data-light-z') !== savedSpatial.mainZ
      || await reopenedEditor.getByRole('slider', { name: '轮廓光方向' }).getAttribute('data-light-z') !== savedSpatial.rimZ) {
      throw new Error('重开后丢失三维灯位')
    }
    const reopenedGeometry = await page.locator(`[data-relight-node-id="${relightNodeId}"]`).evaluate((element) => {
      const root = element.getBoundingClientRect()
      const wrapper = element.closest('.react-flow__node').getBoundingClientRect()
      return { root: { width: root.width, height: root.height }, wrapper: { width: wrapper.width, height: wrapper.height } }
    })
    if (Math.abs(reopenedGeometry.root.width - reopenedGeometry.wrapper.width) > 1
      || Math.abs(reopenedGeometry.root.height - reopenedGeometry.wrapper.height) > 1) {
      throw new Error(`旧尺寸仍裁切新的打光工作台：${JSON.stringify(reopenedGeometry)}`)
    }
    await reopenedEditor.getByRole('button', { name: '正面', exact: true }).click()
    await reopenedEditor.getByRole('button', { name: '透视', exact: true }).click()
    await verifyWorkbenchSelection(page, page.locator(`[data-relight-node-id="${relightNodeId}"]`), sourceNode, reopenedEditor, electronApp, 'relight-reopened', false)
    await settlePage(page, 900)
  }

  async function setupCanvasMultiAngleEditor(page, electronApp) {
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
    const verifyInspectorLayout = async () => {
      if (await editor.getByText('源图', { exact: true }).count()) throw new Error('已连接图片时仍重复显示源图行')
      const layout = await editor.evaluate(element => {
        const panel = element.lastElementChild
        const titles = [...element.querySelectorAll('[data-multi-angle-profile-options] button > span > span:first-child')]
        return {
          inspectorWidth: panel.getBoundingClientRect().width / element.getBoundingClientRect().width,
          titlesFit: titles.length === 3 && titles.every(title => {
            const button = title.closest('button').getBoundingClientRect()
            const text = title.getBoundingClientRect()
            return text.left >= button.left && text.right <= button.right
              && title.getClientRects().length === 1
          }),
        }
      })
      if (layout.inspectorWidth < 0.39 || layout.inspectorWidth > 0.53 || !layout.titlesFit) throw new Error(`多角度参数区比例或标题布局异常：${JSON.stringify(layout)}`)
    }
    await verifyInspectorLayout()
    const multiAngleNode = shell.locator('xpath=ancestor::*[contains(@class,"react-flow__node")][1]')
    await resizeCanvasNodeAndAssertHitBox(page, multiAngleNode, shell, '多角度节点')
    await verifyInspectorLayout()
    await verifyWorkbenchSelection(page, shell, sourceNode, editor, electronApp, 'multi-angle-initial')
    await editor.locator('[data-multi-angle-image-block="true"]').waitFor({ state: 'visible', timeout: 12000 })
    if (await editor.locator('canvas').count() !== 0) throw new Error('多角度轨道不应为闲置节点分配 Canvas / GPU 上下文')
    if (await editor.getByText(/不代表真实焦距/).count()) throw new Error('图片工作面仍显示旧轨道说明')
    if (await editor.locator('[data-multi-angle-image-block] circle, [data-multi-angle-image-block] text, [data-multi-angle-image-block] path').count()) throw new Error('图片工作面仍有轨道或标记')
    if (await editor.locator('[data-block-face]').count() !== 6) throw new Error('图片块缺少三维侧面')
    await editor.locator('[data-block-texture="left"]').waitFor({ state: 'attached', timeout: 8000 })
    if (await editor.locator('[data-block-texture]').count() !== 5) throw new Error('图片块缺少边缘延伸贴图')
    const edgeTextures = await editor.locator('[data-block-texture]').evaluateAll(elements => elements.map(element => element.getAttribute('href')))
    if (edgeTextures.some(url => !url?.startsWith('data:image/png;'))) throw new Error('图片块边缘没有预先烘焙')
    if (await editor.locator('textarea, [contenteditable="true"]').count()) throw new Error('角度编辑器不应显示提示词')

    const cameraControl = editor.locator('[data-multi-angle-camera-control="true"]')
    const cameraBounds = await cameraControl.boundingBox()
    if (!cameraBounds) throw new Error('多角度可视化镜头控制区域不可见')
    const initialYaw = Number(await cameraControl.getAttribute('data-multi-angle-yaw'))
    await page.mouse.move(cameraBounds.x + cameraBounds.width / 2, cameraBounds.y + cameraBounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(cameraBounds.x + cameraBounds.width * 0.4, cameraBounds.y + cameraBounds.height * 0.6, { steps: 8 })
    await page.mouse.up()
    const draggedCamera = await cameraControl.evaluate((element) => ({
      yaw: Number(element.getAttribute('data-multi-angle-yaw')),
      vertical: Number(element.getAttribute('data-multi-angle-vertical')),
    }))
    if (!(draggedCamera.yaw < initialYaw) || !(draggedCamera.vertical > 0)) {
      throw new Error(`多角度镜头拖拽未同步模型控制量：${JSON.stringify(draggedCamera)}`)
    }
    const rotatedTextures = await editor.locator('[data-block-texture]').evaluateAll(elements => elements.map(element => element.getAttribute('href')).sort())
    if (JSON.stringify(rotatedTextures) !== JSON.stringify([...edgeTextures].sort())) throw new Error('旋转时边缘贴图发生重复生成')

    await writeFile('.ui-tour/canvas-multi-angle-image-block.png', await captureInspectionPage(electronApp, page))
    await editor.getByRole('button', { name: /完整方位/ }).click()
    const slots = editor.locator('[data-multi-angle-output-slots] button')
    const directions = editor.locator('[data-multi-angle-direction-options]')
    await directions.getByRole('button', { name: '左侧面', exact: true }).click()
    if (await slots.count() !== 1 || !(await slots.first().textContent()).includes('左侧面')) throw new Error('设置方位意外新增输出')
    await editor.getByRole('button', { name: '添加视图', exact: true }).click()
    if (await slots.count() !== 2 || await slots.nth(1).getAttribute('aria-pressed') !== 'true') throw new Error('新增视图未自动选中')
    await editor.locator('[data-multi-angle-direction="three_quarter_right"]').click()
    if (!(await slots.nth(0).textContent()).includes('左侧面') || !(await slots.nth(1).textContent()).includes('右三分之四')) throw new Error('导航点没有仅修改当前输出')
    await page.mouse.move(20, 120)
    await page.waitForTimeout(250)
    if ((await editor.locator('[data-multi-angle-navigator]').textContent()).trim()) throw new Error('三维方位点不应显示常驻文字')
    await writeFile('.ui-tour/canvas-multi-angle-direction-navigator.png', await captureInspectionPage(electronApp, page))
    const navigationTargets = await editor.locator('[data-multi-angle-direction]:visible').evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect()
      const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      return { direction: element.getAttribute('data-multi-angle-direction'), hit: element === target || element.contains(target), target: target?.outerHTML.slice(0, 250), visibility: getComputedStyle(element).visibility, box: box.toJSON(), parent: element.parentElement.getBoundingClientRect().toJSON() }
    }))
    if (navigationTargets.length < 3 || navigationTargets.some(item => !item.hit)) throw new Error(`可见方位点存在无法命中：${JSON.stringify(navigationTargets)}`)
    const pointSurfaces = await editor.locator('[data-multi-angle-direction]:visible').evaluateAll(elements => elements.map(element => {
      const style = getComputedStyle(element)
      return { background: style.backgroundColor, border: style.borderTopWidth }
    }))
    if (pointSurfaces.some(style => style.background !== 'rgba(0, 0, 0, 0)' || style.border !== '0px')) throw new Error('方位点仍有圆形按钮底或边框')
    await editor.getByRole('button', { name: '移除当前视图', exact: true }).click()
    await directions.getByRole('button', { name: '正面', exact: true }).click()
    for (const preset of ['back', 'top_down']) {
      const stage = await cameraControl.boundingBox()
      const block = editor.locator('[data-multi-angle-image-block]')
      const frontMarker = editor.locator('[data-multi-angle-direction="front"]').locator('..')
      const originalMarkerX = Number(await frontMarker.getAttribute('x'))
      const start = { x: stage.x + stage.width * 0.25, y: stage.y + stage.height * 0.25 }
      await page.mouse.move(start.x, start.y)
      await page.mouse.down()
      await page.mouse.move(start.x + (preset === 'back' ? stage.width * 0.49 : 0), start.y + (preset === 'top_down' ? stage.height * 0.49 : 0), { steps: 12 })
      const value = Number(await block.getAttribute(preset === 'back' ? 'data-block-azimuth' : 'data-block-elevation'))
      if (Math.abs(value - (preset === 'back' ? -176.4 : 88.2)) > 0.1) throw new Error('图片块拖动时提前吸附或角度不跟手')
      if (preset === 'back' && Math.abs(Number(await frontMarker.getAttribute('x')) - originalMarkerX) < 0.1) throw new Error('方位点没有随图片块旋转')
      await writeFile(`.ui-tour/canvas-multi-angle-rotate-${preset}.png`, await captureInspectionPage(electronApp, page))
      await page.mouse.up()
      const snapped = Number(await block.getAttribute(preset === 'back' ? 'data-block-azimuth' : 'data-block-elevation'))
      if (snapped !== (preset === 'back' ? 180 : 90)) throw new Error('图片块松手未匹配正确视角')
      if (preset === 'back' && await frontMarker.getAttribute('visibility') !== 'hidden') throw new Error('背面视角没有遮挡正面方位点')
      if (await editor.locator(`[data-block-face="${preset === 'back' ? 'back' : 'top'}"][visibility="visible"]`).count() !== 1) throw new Error('图片块可见面与视角不一致')
    }
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
      || persisted.viewCount !== 1
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
    await reopenedEditor.locator('[data-multi-angle-direction-options]').getByRole('button', { name: /^顶视$/ }).waitFor({ state: 'visible', timeout: 8000 })
    await reopenedEditor.getByRole('button', { name: /连续控制/ }).click()
    const reopenedCameraControl = reopenedEditor.locator('[data-multi-angle-camera-control="true"][data-multi-angle-profile="continuous"]')
    await reopenedCameraControl.waitFor({ state: 'visible', timeout: 8000 })
    const reopenedBounds = await reopenedCameraControl.boundingBox()
    if (!reopenedBounds) throw new Error('重新打开后多角度镜头控制区域不可见')
    await page.mouse.move(reopenedBounds.x + reopenedBounds.width / 2, reopenedBounds.y + reopenedBounds.height / 2)
    await page.mouse.down()
    await page.mouse.move(reopenedBounds.x + reopenedBounds.width / 2 + 72, reopenedBounds.y + reopenedBounds.height / 2 - 48, { steps: 8 })
    await page.mouse.up()
    await verifyWorkbenchSelection(page, page.locator(`[data-multi-angle-node-id="${nodeId}"]`), sourceNode, reopenedEditor, electronApp, 'multi-angle', false)
    await settlePage(page, 900)
  }

  Object.assign(context, {
    setupCanvasRelightEditor,
    setupCanvasMultiAngleEditor,
  })
}

async function verifyLightingSliders(page, editor, electronApp) {
  const brightness = editor.getByRole('slider', { name: '亮度', exact: true })
  const color = editor.getByRole('slider', { name: '色调', exact: true })
  const stage = editor.locator('[data-relight-direction-control]')
  await brightness.focus()
  await page.keyboard.press('Home')
  if (await stage.getAttribute('data-relight-brightness') !== '-2') throw new Error('亮度键盘操作未更新光束')
  await writeFile('.ui-tour/canvas-relight-dim-warm.png', await captureInspectionPage(electronApp, page))
  const before = await editor.boundingBox()
  const track = await brightness.boundingBox()
  if (!track || !before) throw new Error('打光滑条没有可操作尺寸')
  await page.mouse.move(track.x + 14, track.y + track.height / 2)
  await page.mouse.down()
  await page.mouse.move(track.x + track.width - 14, track.y + track.height / 2, { steps: 12 })
  if (await stage.getAttribute('data-relight-brightness') !== '2') throw new Error('拖动亮度时没有实时预览')
  await page.mouse.up()
  const after = await editor.boundingBox()
  if (!after || Math.abs(after.x - before.x) > 1 || Math.abs(after.y - before.y) > 1) throw new Error('操作滑条误拖动了节点')
  await color.focus()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  if (await stage.getAttribute('data-relight-color') !== 'cool') throw new Error('色调档位未更新光束')
  const capture = await captureInspectionPage(electronApp, page)
  const sharp = require('sharp')
  const metadata = await sharp(capture).metadata()
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  // Chromium 不公开原生 range 伪元素的 computedStyle，用最终截图证明轨道确实有颜色过渡。
  for (const [name, slider] of [['亮度', brightness], ['色调', color]]) {
    const box = await slider.boundingBox()
    const sample = async (fraction) => {
      const pixels = await sharp(capture).extract({
        left: Math.round((box.x + box.width * fraction) * metadata.width / viewport.width),
        top: Math.round((box.y + box.height / 2) * metadata.height / viewport.height),
        width: 2, height: 2,
      }).toBuffer()
      const stats = await sharp(pixels).stats()
      return stats.channels.slice(0, 3).map((channel) => channel.mean)
    }
    const left = await sample(0.1)
    const right = await sample(0.8)
    if (Math.hypot(...left.map((channel, index) => channel - right[index])) < 60) {
      throw new Error(`${name}滑条未显示足够可辨的渐变：${JSON.stringify({ left, right })}`)
    }
  }
  await writeFile('.ui-tour/canvas-relight-bright-cool.png', capture)
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
}

module.exports = { attachUiInspectionCanvasRelight }
