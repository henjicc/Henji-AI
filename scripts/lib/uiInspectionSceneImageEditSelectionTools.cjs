/* eslint-disable @typescript-eslint/no-var-requires -- 正式 Electron 场景复用 CommonJS 巡检工厂。 */
const assert = require('node:assert/strict')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')

function createImageEditSelectionToolsScene(context) {
  return {
    id: 'image-edit-selection-tools', surface: '图片编辑', name: '专业选区-魔棒、色彩范围、焦点、修改与确认取消', writesUserData: true,
    launchArgs: ['--dev-surface=tool.image_edit', '--dev-media=tests/fixtures/image-inpainting/face-scratch-source.png'],
    setup: async (page, app, { capture }) => {
      const restore = await blockPaidGeneration(app)
      try {
        const host = page.locator('[data-image-editor-v3]:visible').last()
        await host.waitFor({ timeout: 30000 })
        const shoot = async name => { await context.settlePage(page, 600); await capture(name) }
        const choose = async name => {
          await host.locator('[data-tool-id^="select-"]').click()
          await page.getByRole('menuitem', { name, exact: true }).click()
        }
        const settings = () => page.locator('[data-selection-advanced-settings]:visible')
        const open = async modify => { await host.getByRole('button', { name: modify ? '修改选区' : '选区设置', exact: true }).click(); await settings().waitFor() }
        const preview = async name => {
          await settings().getByRole('button', { name: '预览', exact: true }).click()
          await settings().getByRole('button', { name: '应用选区', exact: true }).waitFor()
          await page.waitForFunction(() => {
            const panel = document.querySelector('[data-selection-advanced-settings]')
            return panel && [...panel.querySelectorAll('button')].some(button => button.textContent === '应用选区' && !button.disabled)
          }, null, { timeout: 180000 })
          await page.waitForFunction(() => {
            const canvas = document.querySelector('[data-independent-selection]')
            if (!canvas?.width || !canvas?.height) return false
            const values = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
            return values.some((value, index) => index % 4 === 3 && value > 0)
          }, null, { timeout: 10000 })
          await shoot(name)
        }
        await choose('魔棒')
        const area = host.locator('[data-tool-overlay-slot="selection"] svg')
        await area.click({ position: { x: (await area.boundingBox()).width * .45, y: (await area.boundingBox()).height * .4 } })
        await open(false); await preview('wand-preview')
        await settings().getByRole('button', { name: '取消', exact: true }).click()
        assert.equal(await settings().getByRole('button', { name: '应用选区', exact: true }).isDisabled(), true)
        await shoot('wand-cancelled')
        await preview('wand-confirmable')
        await settings().getByRole('button', { name: '应用选区', exact: true }).click()
        await page.keyboard.press('Escape'); await shoot('wand-applied')
        await choose('色彩范围')
        const box = await area.boundingBox(); assert.ok(box)
        await area.click({ position: { x: box.width * .45, y: box.height * .4 } })
        await area.click({ position: { x: box.width * .65, y: box.height * .6 } })
        await open(false); await preview('color-range-preview')
        await settings().getByRole('button', { name: '应用选区', exact: true }).click()
        await page.keyboard.press('Escape'); await shoot('color-range-applied')
        await choose('焦点区域'); await open(false); await preview('focus-preview')
        await settings().getByRole('button', { name: '应用选区', exact: true }).click()
        await page.keyboard.press('Escape'); await shoot('focus-applied')
        await host.locator('[data-dock-tab="channels"] > span').first().click()
        await host.getByRole('button', { name: '保存选区为通道', exact: true }).click()
        await host.getByRole('textbox', { name: '通道名称', exact: true }).fill('焦点软覆盖')
        await host.getByRole('textbox', { name: '通道名称', exact: true }).press('Enter')
        await host.getByRole('button', { name: '载入通道选区', exact: true }).click()
        await shoot('focus-channel-saved-loaded')
        await choose('矩形选择')
        const bounds = await area.boundingBox()
        await page.mouse.move(bounds.x + bounds.width * .3, bounds.y + bounds.height * .25); await page.mouse.down()
        await page.mouse.move(bounds.x + bounds.width * .7, bounds.y + bounds.height * .7, { steps: 6 }); await page.mouse.up()
        await open(true)
        for (const [mode, suffix] of [['扩展', 'expand'], ['收缩', 'contract'], ['平滑', 'smooth'], ['羽化', 'feather'], ['边界', 'border']]) {
          await settings().getByRole('button', { name: /^修改方式/ }).click()
          await page.getByRole('option', { name: mode, exact: true }).click()
          await preview(`modify-${suffix}`)
          await settings().getByRole('button', { name: '取消', exact: true }).click()
        }
        await page.keyboard.press('Escape'); await shoot('selection-options-restored')
      } finally { await restore() }
    },
  }
}
module.exports = { createImageEditSelectionToolsScene }
