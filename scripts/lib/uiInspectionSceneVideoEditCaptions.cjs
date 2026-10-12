const assert = require('node:assert/strict')
const path = require('node:path')
const { loadTypeScript } = require('../check-persistence-compat.cjs')
const { seedVideoEditProject, openVideoEditProjectCard } = require('./uiInspectionVideoEditDocuments.cjs')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')

function createVideoEditCaptionsScene() {
  return { id: 'video-edit-caption-track', surface: '剪辑', name: '剪辑-字幕轨道、选择、锁定与空行', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const release = await blockPaidGeneration(app)
      // DOM/节目帧就绪后，给 Electron 窗口合成保留与巡检公共 settlePage 相同的等待。
      const assertAlignment = async () => {
        const caption = page.locator('[data-video-edit-caption-track]')
        const video = page.locator('[data-track-kind="video"]').first()
        const [captionRect, videoRect, rulerRect] = await Promise.all([caption.boundingBox(), video.boundingBox(), page.locator('[data-video-edit-ruler]').boundingBox()])
        assert.ok(Math.abs(captionRect.y + captionRect.height - videoRect.y) < 1, 'C1 必须紧贴最上视频轨')
        assert.ok(captionRect.y > rulerRect.y + rulerRect.height + 24, '新建视频轨的空白必须在 C1 上方')
        const captionButtons = caption.locator('[data-video-edit-track-header] button')
        const videoButtons = video.locator('[data-video-edit-track-header] button')
        assert.equal(await captionButtons.count(), 2, 'C1 仅显示锁和眼睛')
        for (const [captionIndex, videoIndex] of [[0, 1], [1, 3]]) {
          const [a, b] = await Promise.all([captionButtons.nth(captionIndex).boundingBox(), videoButtons.nth(videoIndex).boundingBox()])
          assert.ok(Math.abs(a.x - b.x) < 1 && Math.abs(a.width - b.width) < 1, 'C1 同名按钮必须与视频轨竖直对齐')
          assert.equal(await captionButtons.nth(captionIndex).getAttribute('class'), await videoButtons.nth(videoIndex).getAttribute('class'), '同状态按钮必须共用外观')
        }
      }
      const captureSettled = async suffix => { await page.waitForTimeout(350); await assertAlignment(); await capture(suffix) }
      try {
        const { createVideoEditDocument, createVideoEditSequence } = loadTypeScript(path.resolve('src/core/videoEdit/document.ts'))
        const { makeVideoEditItemClip } = loadTypeScript(path.resolve('src/core/videoEdit/projectItems.ts'))
        const project = createVideoEditDocument('字幕轨道检查')
        const sequence = createVideoEditSequence('字幕时间线')
        sequence.captions = [
          { id: 'caption-one', start: 0, duration: 60, text: '让每一句字幕，拥有自己的位置。' },
          { id: 'caption-two', start: 75, duration: 75, text: '拖动调整时间，沿两端修剪。' },
          { id: 'caption-three', start: 165, duration: 75, text: '画面、声音与字幕在同一条时间线上。' },
        ]
        project.sequences = [sequence]
        project.items = [{ id: 'caption-background', name: '字幕轨道', kind: 'text' }]
        sequence.clips = [{ ...makeVideoEditItemClip(project, 'caption-background', sequence.id, { frame: 0, duration: 300 }), text: '字幕轨道' }]
        const seeded = await seedVideoEditProject(page, project)
        await openVideoEditProjectCard(page, seeded.projectId)
        const row = page.locator('[data-video-edit-caption-track]')
        await row.waitFor({ state: 'visible' })
        await page.locator('[data-track-kind="video"]').first().waitFor({ state: 'visible' })
        await page.waitForFunction(() => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === '0')
        const ruler = await page.locator('[data-video-edit-ruler]').boundingBox()
        const rect = await row.boundingBox()
        assert.ok(rect.y >= ruler.y + ruler.height, '字幕轨必须在标尺下方')
        // 应用 zoom 会同时量化 DOMRect 与 computedStyle；检查声明及舍入到整 CSS 像素的实测值。
        assert.equal(await row.evaluate(node => node.style.height), '24px')
        assert.equal(Math.round(rect.height), 24)
        assert.equal(await page.locator('[data-video-edit-ruler] [data-video-edit-caption-range]').count(), 0)
        await captureSettled('captions-populated')
        const second = row.locator('[data-video-edit-caption-range="caption-two"]')
        await second.click()
        assert.equal(await second.getAttribute('aria-pressed'), 'true')
        await page.locator('[data-video-edit-timed-entry="caption-two"]').waitFor({ state: 'visible' })
        await page.waitForFunction(() => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === '75')
        await captureSettled('captions-selected')
        await row.getByRole('button', { name: '锁定字幕轨道', exact: true }).click()
        const videoHeader = page.locator('[data-track-kind="video"] [data-video-edit-track-header]').first()
        await videoHeader.getByRole('button', { name: /锁定$/, exact: false }).first().click()
        assert.equal(await second.getAttribute('aria-disabled'), 'true')
        assert.equal(await row.locator('[data-caption-trim]').count(), 0)
        await captureSettled('captions-locked')
        await videoHeader.getByRole('button', { name: /锁定$/, exact: false }).first().click()
        await row.getByRole('button', { name: '解锁字幕轨道', exact: true }).click()
        await row.getByRole('button', { name: '隐藏字幕轨道', exact: true }).click()
        await videoHeader.getByRole('button', { name: /输出$/, exact: false }).click()
        await assertAlignment()
        await row.getByRole('button', { name: '显示字幕轨道', exact: true }).click()
        await videoHeader.getByRole('button', { name: /输出$/, exact: false }).click()
        for (const id of ['caption-one', 'caption-two', 'caption-three']) {
          const block = row.locator(`[data-video-edit-caption-range="${id}"]`)
          await block.click(); await block.press('Delete')
          await block.waitFor({ state: 'detached' })
        }
        assert.equal(await row.locator('[data-video-edit-caption-range]').count(), 0)
        assert.equal(await row.isVisible(), true)
        await captureSettled('captions-empty')
      } finally { await release() }
    },
  }
}
module.exports = { createVideoEditCaptionsScene }
