const assert = require('node:assert/strict')
const { loadTypeScript } = require('../check-persistence-compat.cjs')
const { seedVideoEditProject, openVideoEditProjectCard } = require('./uiInspectionVideoEditDocuments.cjs')
const { captureRegionPixels } = require('./uiInspectionCompositedMove.cjs')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')

function createVideoEditCaptionTextScene() {
  return { id: 'video-edit-caption-text', surface: '剪辑', name: '剪辑-节目字幕选中与就地编辑', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const unblock = await blockPaidGeneration(app)
      try {
        const { createVideoEditDocument, createVideoEditSequence } = loadTypeScript('src/core/videoEdit/document.ts')
        const { createVideoEditGraphic } = loadTypeScript('src/core/videoEdit/graphics.ts')
        const { makeVideoEditItemClip } = loadTypeScript('src/core/videoEdit/projectItems.ts')
        const { videoEditSubtitleStyleSchema } = loadTypeScript('src/core/videoEdit/subtitleStyle.ts')
        const document = createVideoEditDocument('节目字幕编辑'); document.id = 'ui-u3-caption-text'
        const sequence = createVideoEditSequence(); sequence.id = 'u3-sequence'
        sequence.captions = [{ id: 'u3-caption', start: 0, duration: 240, text: '在画面里，直接修改字幕', translation: 'Edit captions right in the picture', style: videoEditSubtitleStyleSchema.parse({ fontSize: 60 }) }]
        document.sequences.push(sequence)
        document.items.push({ id: 'u3-background', name: '背景', kind: 'graphic', graphic: createVideoEditGraphic('solid', sequence.width, sequence.height) })
        sequence.clips.push(makeVideoEditItemClip(document, 'u3-background', sequence.id, { frame: 0, duration: 240, track: 1 }))
        await page.getByRole('button', { name: '剪辑', exact: true }).first().click()
        const seeded = await seedVideoEditProject(page, document)
        await openVideoEditProjectCard(page, seeded.projectId)
        const source = page.locator('[data-video-edit-caption="u3-caption"][data-caption-field="text"]')
        await source.waitFor({ state: 'visible' })
        await page.waitForFunction(() => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === '0', undefined, { timeout: 60000 })
        await page.evaluate(() => document.fonts.ready)
        await source.click()
        assert.equal(await page.locator('[data-video-edit-caption-range="u3-caption"]').getAttribute('aria-pressed'), 'true')
        await page.locator('[data-video-edit-timed-entry="u3-caption"]').waitFor({ state: 'visible' })
        // Revealing the content dock can resize the WebGPU surface; wait for the resized composition.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        await page.waitForTimeout(1000)
        assert.equal(await source.locator('[data-video-edit-text-selection]').evaluate(element => getComputedStyle(element).outlineStyle), 'solid')
        // Verify actual composed caption pixels, rather than only the submitted-frame marker.
        const bounds = await source.boundingBox()
        let painted = false
        for (let attempt = 0; attempt < 40 && !painted; attempt++) {
          const pixels = await captureRegionPixels(app, page, bounds)
          let glyphPixels = 0
          for (let offset = 0; offset < pixels.data.length; offset += pixels.channels) if (pixels.data[offset] > 200 && pixels.data[offset + 1] > 200 && pixels.data[offset + 2] > 200) glyphPixels++
          painted = glyphPixels > 20
          if (!painted) await page.waitForTimeout(250)
        }
        assert.ok(painted, '节目字幕必须已实际合成可见')
        await capture('selected')
        await source.press('Enter')
        const sourceEditor = page.getByRole('textbox', { name: '就地编辑字幕', exact: true })
        assert.equal(await sourceEditor.textContent(), '在画面里，直接修改字幕')
        await sourceEditor.press('Escape')
        const translation = page.locator('[data-video-edit-caption="u3-caption"][data-caption-field="translation"]')
        await translation.dblclick()
        const editor = page.getByRole('textbox', { name: '就地编辑字幕', exact: true })
        await editor.waitFor({ state: 'visible' })
        assert.equal(await editor.textContent(), 'Edit captions right in the picture')
        assert.ok(await editor.evaluate(element => { const selection = element.ownerDocument.getSelection(); return selection && element.contains(selection.anchorNode) && selection.anchorOffset > 0 && selection.anchorOffset < element.textContent.length }))
        await capture('editing')
        await editor.press('Escape')
      } finally { await unblock() }
    },
  }
}
module.exports = { createVideoEditCaptionTextScene }
