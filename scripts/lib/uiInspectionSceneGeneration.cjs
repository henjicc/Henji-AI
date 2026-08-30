function attachUiInspectionGeneration(context) {
  const {
    settlePage,
    REFERENCE_FIXTURE_IMAGE,
    paramFieldFromLabel,
    openWorkspace,
    waitForPageHeader,
  } = context

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

  Object.assign(context, {
    setupGeneration,
    openGenerationModelPanel,
    selectGenerationModel,
    setupGenerationModelSearch,
    setupGenerationMidjourneySettings,
    setupGenerationGptMask,
  })
}

module.exports = { attachUiInspectionGeneration }
