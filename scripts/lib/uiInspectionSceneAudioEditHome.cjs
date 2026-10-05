const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function createAudioEditHomeScene({ setupToolbox, clickNamedButton }) {
  return {
    id: 'toolbox-audio-edit-home', surface: '工具箱', name: '口播剪辑-项目页', writesUserData: true,
    setup: async (page) => {
      await setupToolbox(page)
      await clickNamedButton(page, /^(口播剪辑)/)
      await page.getByText('从一段口播开始', { exact: true }).waitFor()
      assert.equal(await page.getByRole('textbox', { name: '搜索项目' }).count(), 0)
      const assertImportLayout = async () => {
        const button = page.getByRole('button', { name: '导入音频或视频', exact: true })
        const bounds = await button.boundingBox()
        const textBounds = await button.evaluate((element) => {
          const range = document.createRange()
          range.selectNodeContents(element)
          const rect = range.getBoundingClientRect()
          return { x: rect.x, right: rect.right, height: rect.height, viewport: document.documentElement.clientWidth }
        })
        assert.ok(bounds && bounds.height < 50, '导入按钮应完整显示为单行')
        assert.ok(textBounds.height < 30 && textBounds.x >= bounds.x - 0.5 && textBounds.right <= bounds.x + bounds.width + 0.5 && textBounds.right <= textBounds.viewport, '图标和文字不能被挤压或溢出')
      }
      await assertImportLayout()
      await page.screenshot({ path: path.resolve('.ui-tour', 'audio-edit-home-empty.png') })

      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-audio-home-'))
      const sourcePath = path.join(directory, '口播示例.wav')
      const wav = Buffer.alloc(44 + 16000)
      wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
      wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
      wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
      wav.write('data', 36); wav.writeUInt32LE(16000, 40)
      fs.writeFileSync(sourcePath, wav)
      const ids = []
      try {
        for (const name of ['产品介绍 · 第一版', '周末随想', '这是一段名称比较长的口播项目，用来检查项目标题是否会挤压其他内容']) {
          ids.push(await page.evaluate(async ({ sourcePath, name }) => (await window.henjiNative.audio.createEditProject({ sourcePath, name })).id, { sourcePath, name }))
        }
        await page.getByRole('button', { name: '返回工具', exact: true }).click()
        await clickNamedButton(page, /^(口播剪辑)/)
        await page.locator('[data-project-library-state="items"]').waitFor()
        await page.getByText('产品介绍 · 第一版', { exact: true }).waitFor()
        await assertImportLayout()
        const search = page.getByRole('textbox', { name: '搜索项目' })
        assert.ok((await search.boundingBox()).width <= 300, '搜索框应保持合理宽度')
        await page.screenshot({ path: path.resolve('.ui-tour', 'audio-edit-home-projects.png') })
        await search.fill('没有这个项目')
        await page.getByText('没有符合条件的项目', { exact: true }).waitFor()
        await page.screenshot({ path: path.resolve('.ui-tour', 'audio-edit-home-search.png') })
        await search.press('Escape')
        assert.equal(await page.locator('[data-project-id]').count(), 3)
      } finally {
        for (const id of ids) await page.evaluate((id) => window.henjiNative.audio.deleteEditProject(id), id)
        fs.unlinkSync(sourcePath)
        fs.rmdirSync(directory)
      }
      await page.getByRole('button', { name: '返回工具', exact: true }).click()
      await clickNamedButton(page, /^(口播剪辑)/)
      await page.getByText('从一段口播开始', { exact: true }).waitFor()
    },
  }
}

module.exports = { createAudioEditHomeScene }
