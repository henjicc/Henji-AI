function attachUiInspectionCommon(context) {
  const {
    settlePage,
    TAB_NAMES,
  } = context

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

  async function resizeCanvasNodeAndAssertHitBox(page, node, visibleRoot, label) {
    await node.click({ position: { x: 24, y: 24 } })
    const resizeHandle = node.locator('.react-flow__resize-control.bottom.right').last()
    await resizeHandle.waitFor({ state: 'attached', timeout: 8000 })
    const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
    let handleBox = await resizeHandle.boundingBox()
    for (let attempt = 0; handleBox && attempt < 2; attempt += 1) {
      const centerX = handleBox.x + handleBox.width / 2
      const centerY = handleBox.y + handleBox.height / 2
      if (centerX > 8 && centerY > 8 && centerX < viewport.width - 8 && centerY < viewport.height - 8) break
      const deltaX = centerX >= viewport.width - 8
        ? Math.max(-viewport.width + 240, viewport.width - 96 - centerX)
        : centerX <= 8 ? Math.min(viewport.width - 240, 96 - centerX) : 0
      const deltaY = centerY >= viewport.height - 8
        ? Math.max(-viewport.height + 200, viewport.height - 96 - centerY)
        : centerY <= 8 ? Math.min(viewport.height - 200, 96 - centerY) : 0
      const panStart = await page.evaluate(({ width, height, deltaX, deltaY }) => {
        for (let y = 96; y < height - 96; y += 40) {
          for (let x = 96; x < width - 96; x += 40) {
            const endX = x + deltaX
            const endY = y + deltaY
            if (endX < 24 || endX > width - 24 || endY < 60 || endY > height - 24) continue
            if (document.elementFromPoint(x, y)?.classList.contains('react-flow__pane')) return { x, y }
          }
        }
        return null
      }, { ...viewport, deltaX, deltaY })
      if (!panStart) break
      await page.mouse.move(panStart.x, panStart.y)
      await page.mouse.down()
      await page.mouse.move(panStart.x + deltaX, panStart.y + deltaY, { steps: 8 })
      await page.mouse.up()
      await page.waitForTimeout(180)
      handleBox = await resizeHandle.boundingBox()
    }
    const beforeNode = await node.boundingBox()
    const beforeRoot = await visibleRoot.boundingBox()
    if (!beforeNode || !beforeRoot || !handleBox) throw new Error(`${label} 缺少可缩放几何`)
    const handleCenterX = handleBox.x + handleBox.width / 2
    const handleCenterY = handleBox.y + handleBox.height / 2
    if (handleCenterX <= 8 || handleCenterY <= 8
      || handleCenterX >= viewport.width - 8 || handleCenterY >= viewport.height - 8) {
      throw new Error(`${label} 缩放手柄无法进入当前视口`)
    }

    await page.mouse.move(handleCenterX, handleCenterY)
    await page.mouse.down()
    await page.mouse.move(handleCenterX + 56, handleCenterY + 40, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(260)

    const afterNode = await node.boundingBox()
    const afterRoot = await visibleRoot.boundingBox()
    if (!afterNode || !afterRoot) throw new Error(`${label} 缩放后几何丢失`)
    if (afterNode.width <= beforeNode.width + 8 || afterNode.height <= beforeNode.height + 8) {
      const sizeState = await visibleRoot.evaluate((element) => ({
        rootStyle: element.getAttribute('style'),
        wrapperStyle: element.closest('.react-flow__node')?.getAttribute('style'),
      }))
      throw new Error(`${label} 拖动缩放手柄后尺寸没有变化：${JSON.stringify({ beforeNode, afterNode, sizeState })}`)
    }
    if (Math.abs(afterNode.width - afterRoot.width) > 2 || Math.abs(afterNode.height - afterRoot.height) > 2) {
      throw new Error(`${label} ReactFlow 外壳与可见节点尺寸不同步：${JSON.stringify({ afterNode, afterRoot })}`)
    }

    const transparentPaddingHit = await page.evaluate(({ x, y, nodeId }) => {
      const hit = document.elementFromPoint(x, y)
      return hit?.closest?.('.react-flow__node[data-id]')?.getAttribute('data-id') === nodeId
    }, {
      x: Math.max(1, afterRoot.x - 8),
      y: Math.max(1, afterRoot.y + afterRoot.height * 0.5),
      nodeId: await node.getAttribute('data-id'),
    })
    if (transparentPaddingHit) throw new Error(`${label} 的透明绘制扩展区仍会挡住后方节点`)
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

  Object.assign(context, {
    closeTransientUi,
    clickNamedButton,
    firstLocatorInViewport,
    clickCanvasCapabilityAction,
    resizeCanvasNodeAndAssertHitBox,
    paramFieldFromLabel,
    openWorkspace,
    waitForPageHeader,
  })
}

module.exports = { attachUiInspectionCommon }
