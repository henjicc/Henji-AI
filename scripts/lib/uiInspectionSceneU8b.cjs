/* eslint-disable @typescript-eslint/no-var-requires -- 正式 ui:tour 场景工厂。 */
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { loadTypeScript } = require('../check-persistence-compat.cjs')
const { fixture } = require('./uiInspectionSceneVideoEditMotionDraft.cjs')
const { seedVideoEditProject, openVideoEditProjectCard } = require('./uiInspectionVideoEditDocuments.cjs')
const { disableMcp } = require('./uiInspectionMcpClient.cjs')
const { stubIpc, restoreIpcStubs } = require('./uiReviewIpcStub.cjs')

const button = (page, name) => page.getByRole('button', { name, exact: true })
async function panel(page, id, title) {
  const origin = await page.locator('.dockview-host').boundingBox()
  const tab = page.locator(`.dv-tabs-container [data-dock-tab="${id}"]`)
  if (!await tab.count()) {
    await button(page, '面板').click(); await button(page, title).click()
  } else if (await tab.isVisible()) await tab.click()
  else {
    await page.locator('.dv-groupview').filter({ has: tab }).locator('.dv-tabs-overflow-dropdown-root').click()
    await page.locator(`.dv-tabs-overflow-container [data-dock-tab="${id}"]`).click()
  }
  await page.locator(`.dv-tabs-container .dv-active-tab [data-dock-tab="${id}"]`).waitFor()
  try { await page.waitForFunction(y => Math.abs(document.querySelector('.dockview-host').getBoundingClientRect().y - y) <= 1, origin.y, { timeout: 2000 }) }
  catch (error) {
    const offsets = await page.evaluate(() => {
      const result = []
      for (let element = document.querySelector('.dockview-host'); element; element = element.parentElement) result.push({ tag: element.tagName, className: element.className, top: element.scrollTop, left: element.scrollLeft })
      return result
    })
    fs.writeFileSync(path.resolve('.tmp/u8b-scroll-failure.json'), JSON.stringify({ id, origin, current: await page.locator('.dockview-host').boundingBox(), offsets }, null, 2))
    throw error
  }
  const current = await page.locator('.dockview-host').boundingBox()
  assert(Math.abs(current.y - origin.y) <= 1, '切换隐藏标签不能把外层工作区滚走')
}
async function formColumns(host) {
  const issues = await host.evaluate(root => {
    const rows = [...root.querySelectorAll('[data-ui-form-row="panel"]')].filter(row => row.getBoundingClientRect().width)
    const first = rows[0]?.querySelector('[data-ui-form-control]').getBoundingClientRect()
    return rows.flatMap(row => {
      const control = row.querySelector('[data-ui-form-control]')
      const rect = control.getBoundingClientRect()
      const issues = Math.abs(rect.left - first.left) > 1 || Math.abs(rect.right - first.right) > 1 ? [row.textContent] : []
      const number = control.querySelector('[data-param-control="number"] [data-ui-field-control]')
      if (number) {
        const numeric = number.parentElement.parentElement
        const bounds = numeric.getBoundingClientRect()
        const unit = numeric.children[1]
        const gap = unit ? parseFloat(getComputedStyle(numeric).columnGap) * bounds.width / numeric.offsetWidth : 0
        if (number.getBoundingClientRect().width < bounds.width - (unit?.getBoundingClientRect().width ?? 0) - gap - 2) issues.push(`数值未填满：${row.textContent}`)
      }
      return issues
    })
  })
  assert.deepEqual(issues, [], '本面板的控件列左右缘必须一致')
}

/** 本批界面证据：使用本地图片与文字夹具，不跑性能、导出、付费生成或原生故障矩阵。 */
function createU8bUiScenes(context) {
  return [{ id: 'u8b-video-ui', surface: '剪辑', name: '剪辑-停靠标签表单字幕与风格样张', writesUserData: true,
    setup: async (page, app, { capture }) => {
      await disableMcp(page)
      const source = path.resolve('tests/fixtures/image-inpainting/face-scratch-source.png')
      const document = fixture(source); document.id = 'u8b-video-ui'; document.name = '剪辑界面巡检'
      const sequence = document.sequences[0]
      const { makeVideoEditItemClip } = loadTypeScript('src/core/videoEdit/projectItems.ts')
      sequence.tracks.push({ ...sequence.tracks.find(track => track.kind === 'video'), id: 'u8b-video-track', index: 2, name: '视频 2' })
      document.items.push({ id: 'u8b-text', name: '巡检文字', kind: 'text' })
      sequence.clips.push({ ...makeVideoEditItemClip(document, 'u8b-text', sequence.id, { frame: 0, duration: 300, track: 2 }), id: 'u8b-text-clip', text: '文字样式与参数列' })
      sequence.captions = [{ id: 'u8b-caption-one', start: 0, duration: 60, text: '让每一句字幕，拥有自己的位置。' }, { id: 'u8b-caption-two', start: 75, duration: 75, text: '拖动调整时间，沿两端修剪。' }, { id: 'u8b-caption-three', start: 165, duration: 75, text: '画面、声音与字幕在同一条时间线上。' }]
      await context.closeTransientUi(page); await button(page, '剪辑').first().click()
      const seeded = await seedVideoEditProject(page, document)
      await page.evaluate(async ({ source, projectId, id }) => {
        const documents = window.henjiNative.documents
        const resource = await documents.importFile({ sourcePath: source, container: { kind: 'project', projectId }, folder: 'materials' })
        const read = await documents.readDocument({ id }); read.content.media[0].path = resource.path
        await documents.saveDocument({ target: { id }, expectedRevision: read.meta.revision, content: read.content })
      }, { source, projectId: seeded.projectId, id: seeded.documentId })
      await openVideoEditProjectCard(page, seeded.projectId)
      const shot = async suffix => { await context.settlePage(page, 500); await capture(suffix) }
      await page.locator('[data-video-edit-clip="motion-clip"] [aria-label^="选择片段"]').click()
      await button(page, '批注').click(); await page.getByLabel('筛选批注', { exact: true }).waitFor(); await shot('annotation-tabs')
      const truncated = await page.locator('.dv-tabs-container .dv-active-tab').evaluateAll(tabs => tabs.filter(tab => tab.hasAttribute('data-dock-tab-clipped')).map(tab => tab.textContent))
      assert.deepEqual(truncated, [], '当前标签必须完整可见')
      await page.locator('.dv-groupview').filter({ has: page.locator('[data-dock-tab="annotations"]') }).locator('.dv-tabs-overflow-dropdown-root').click()
      await shot('overflow-menu'); await page.keyboard.press('Escape')
      await panel(page, 'color_grade', '全能调色'); await page.getByLabel('输入 LUT', { exact: true }).waitFor()
      await formColumns(page.locator('[data-video-edit-panel="color_grade"]')); await shot('color-rows')
      await page.locator('[data-video-edit-clip="u8b-text-clip"] [aria-label^="选择片段"]').click()
      await panel(page, 'effects', '效果控件'); await page.locator('[data-video-edit-panel="effects"] [data-typography]:visible').first().waitFor()
      await formColumns(page.locator('[data-video-edit-panel="effects"] [data-typography]:visible').first()); await shot('typography-rows')
      await panel(page, 'content', '字幕与标记'); await page.locator('[data-video-edit-timed-entry="u8b-caption-one"]').waitFor(); await shot('caption-records')
      await panel(page, 'style_kits', '风格')
      await page.getByLabel('风格预览', { exact: true }).locator('img').first().waitFor({ timeout: 30000 })
      await page.getByLabel('风格预览', { exact: true }).locator('img').nth(1).waitFor({ timeout: 30000 })
      const styleGroup = page.locator('.dv-groupview').filter({ has: page.locator('[data-dock-tab="style_kits"]') })
      await styleGroup.locator('[data-video-edit-dock-actions] button').click()
      await shot('wide-style-preview')
      const heights = await page.getByLabel('风格预览', { exact: true }).locator('img').evaluateAll(images => images.map(image => image.getBoundingClientRect().height))
      assert(heights.every(height => height <= 112.5), '宽面板样张图片保持 h-28 的高度预算')
      await styleGroup.locator('[data-video-edit-dock-actions] button').click()
      await page.locator('[data-video-edit-panel="project"] [aria-label="新建素材项"]').click()
      await button(page, '新建序列').click(); await page.getByRole('dialog', { name: '新建序列' }).waitFor()
      await formColumns(page.getByRole('dialog', { name: '新建序列' })); await shot('sequence-dialog')
      await button(page, '取消').click()
    } },
    { id: 'u8b-waveform-retry', surface: '剪辑', name: '剪辑-波形失败点击恢复', writesUserData: true, expectedLogEvents: ['audio.waveform.pyramid.failed'],
      setup: async (page, app, { capture }) => {
        await disableMcp(page)
        const source = path.resolve('tests/fixtures/image-inpainting/face-scratch-source.png')
        const document = fixture(source); document.id = 'u8b-waveform-retry'
        const sequence = document.sequences[0]
        const wav = path.resolve('.tmp/u8b-waveform.wav')
        fs.mkdirSync(path.dirname(wav), { recursive: true })
        const bytes = Buffer.alloc(44 + 48000 * 2)
        bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(48000, 24); bytes.writeUInt32LE(96000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40)
        for (let i = 0; i < 48000; i++) bytes.writeInt16LE(Math.round(Math.sin(i * 440 * Math.PI * 2 / 48000) * 8000), 44 + i * 2)
        fs.writeFileSync(wav, bytes)
        const original = path.resolve('node_modules/.cache/video-edit-play-start/1080p60-gop240-aac.mp4')
        document.media[0] = { id: 'motion-source', name: '波形重试声音', kind: 'audio', path: wav, width: 0, height: 0, durationSeconds: 1 }
        document.items[0].kind = 'audio'
        const { makeVideoEditItemClip } = loadTypeScript('src/core/videoEdit/projectItems.ts')
        sequence.clips = [{ ...makeVideoEditItemClip(document, 'motion-item', sequence.id, { frame: 0, duration: 30, track: sequence.tracks.find(track => track.kind === 'audio').index }), id: 'motion-clip' }]
        await context.closeTransientUi(page); await button(page, '剪辑').first().click()
        const seeded = await seedVideoEditProject(page, document)
        const probe = await page.evaluate(async ({ source, projectId, id }) => {
          const readWave = async input => {
            try { const data = await window.henjiNative.audio.extractWaveformPyramid({ source: input, channels: 2, requestId: crypto.randomUUID() }); return { status: 'ready', channels: data.channelCount } }
            catch (error) { return { status: 'error', error: String(error?.message ?? error) } }
          }
          const unauthorized = await readWave(source)
          const documents = window.henjiNative.documents
          const resource = await documents.importFile({ sourcePath: source, container: { kind: 'project', projectId }, folder: 'materials' })
          const read = await documents.readDocument({ id }); read.content.media[0].path = resource.path
          await documents.saveDocument({ target: { id }, expectedRevision: read.meta.revision, content: read.content })
          const authorized = await readWave(resource.path)
          return { source, unauthorized, authorized }
        }, { source: fs.existsSync(original) ? original : wav, projectId: seeded.projectId, id: seeded.documentId })
        fs.writeFileSync(path.resolve('.tmp/u8b-native-waveform.json'), JSON.stringify(probe, null, 2))
        assert.equal(probe.authorized.status, 'ready', JSON.stringify(probe))
        await stubIpc(app, { channel: 'audio:extractSamples', mode: 'reject', message: '巡检夹具：波形解码暂不可用' })
        try {
          try { await openVideoEditProjectCard(page, seeded.projectId) } catch (error) { await capture('waveform-open-failed'); throw error }
          const retry = button(page, '波形未能读取 · 重试')
          await retry.first().waitFor(); await context.settlePage(page, 300); await capture('waveform-failed')
          await restoreIpcStubs(app)
          await retry.first().click(); await page.locator('[data-video-edit-waveform]').first().waitFor()
          assert.equal(await retry.count(), 0, '恢复后移除失败动作'); await context.settlePage(page, 300); await capture('waveform-recovered')
        } finally { await restoreIpcStubs(app) }
      } },
  ]
}
module.exports = { createU8bUiScenes }
