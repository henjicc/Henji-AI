const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')
const { loadTypeScript } = require('../check-persistence-compat.cjs')
const { assignIsolatedMcpPort, authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { seedVideoEditProject, openVideoEditProjectCard, leaveVideoEditProject, readVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')

const button = (page, name) => page.getByRole('button', { name, exact: true })
const quantile = (values, q) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * q)] ?? null
function fixture(source = path.resolve('node_modules/.cache/video-edit-motion-draft/source.png')) {
  const { createVideoEditDocument, createVideoEditSequence, videoEditDocumentSchema } = loadTypeScript('src/core/videoEdit/document.ts')
  const { makeVideoEditItemClip } = loadTypeScript('src/core/videoEdit/projectItems.ts')
  const document = createVideoEditDocument('超级关键帧剪辑验收'); document.id = 'reality-video-motion'
  const sequence = createVideoEditSequence(); sequence.id = 'motion-sequence'; sequence.width = 1280; sequence.height = 720
  document.sequences.push(sequence)
  document.media.push({ id: 'motion-source', name: '示范画面', kind: 'image', path: source, width: 1280, height: 720, durationSeconds: 0 })
  document.items.push({ id: 'motion-item', name: '示范画面', kind: 'image', mediaId: 'motion-source' })
  sequence.clips.push({ ...makeVideoEditItemClip(document, 'motion-item', sequence.id, { frame: 0, duration: 300, track: 1 }), id: 'motion-clip', scale: .35 })
  return videoEditDocumentSchema.parse(document)
}
function createVideoEditMotionDraftScene() {
  return { id: 'video-edit-motion-draft', surface: '剪辑', name: '剪辑-超级关键帧采集候选应用与重开', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/video-edit-motion-draft'); fs.mkdirSync(root, { recursive: true })
      const evidence = { frames: [], candidateMs: [], latencyMs: [], abMs: [], fidelityMs: [], visualReview: '待代理逐张目视检查' }
      const store = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      let client; let seeded
      const controls = page.locator('[data-creative-intent-controls]')
      const trigger = () => page.getByRole('button', { name: /^(超级关键帧|正在示范)$/ })
      const panel = async () => { if (!await controls.isVisible()) await trigger().click(); await controls.waitFor({ state: 'visible' }) }
      const closePanel = async () => { if (await controls.isVisible()) { await trigger().click(); await controls.waitFor({ state: 'hidden' }) } }
      const shot = async name => {
        const suffix = `step-${String(evidence.frames.length + 1).padStart(3, '0')}`
        await capture(suffix)
        const native = await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => ({ pixels: canvas.toDataURL('image/png').split(',')[1], data: { ...canvas.dataset } }))
        const file = path.join(root, name + '.png'); fs.writeFileSync(file, Buffer.from(native.pixels, 'base64')); evidence.frames.push({ name, suffix, file, ...native.data }); store()
      }
      const presented = async frame => page.waitForFunction(frame => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === String(frame), frame, { timeout: 90000 })
      const saved = async predicate => { for (let i = 0; i < 160; i++) { const doc = readVideoEditFile(seeded.file); if (predicate(doc)) return doc; await page.waitForTimeout(50) } assert.fail('超级关键帧文档未保存到预期状态') }
      try {
        const source = path.join(root, 'source.png')
        await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="white"/><circle cx="640" cy="360" r="230" fill="black"/><path d="M360 360h560M640 100v520" stroke="white" stroke-width="20"/></svg>')).png().toFile(source)
        await button(page, '剪辑').first().click(); seeded = await seedVideoEditProject(page, fixture(source))
        await page.evaluate(async ({ source, projectId, id }) => {
          const documents = window.henjiNative.documents
          const resource = await documents.importFile({ sourcePath: source, container: { kind: 'project', projectId }, folder: 'materials' })
          const read = await documents.readDocument({ id })
          read.content.media[0].path = resource.path
          await documents.saveDocument({ target: { id }, expectedRevision: read.meta.revision, content: read.content })
        }, { source, projectId: seeded.projectId, id: seeded.documentId })
        await openVideoEditProjectCard(page, seeded.projectId); await presented(0)
        await assignIsolatedMcpPort(page)
        const identity = await authorizeMcpConnection(page, { name: '超级关键帧验收', allowWrites: true, allowDestructive: true })
        client = await connectMcpClient(identity.config, 'Henji motion Reality')
        const projectRef = { kind: 'video_edit.document', id: seeded.documentId }
        const clipRef = { kind: 'video_edit.clip', id: seeded.documentId + ':motion-clip' }
        const read = async properties => callTool(client, 'read_application_entity', { ref: projectRef, propertyIds: properties })
        const playback = async (frame, playing = false) => {
          await closePanel()
          const property = 'video_edit.document.program_playback'; const baseline = await read([property])
          const result = await callTool(client, 'change_application_entities', operationEnvelope([baseline], { summary: '定位与手动播放', changes: [{ kind: 'set_properties', entityType: projectRef.kind, target: projectRef, properties: { [property]: { frame, playing, playbackDirection: 1 } } }] }))
          assert.equal(result.executionState, 'completed', JSON.stringify(result)); if (!playing) await presented(frame)
        }
        const focus = await callTool(client, 'focus_application_entity', operationEnvelope([], { ref: clipRef })); assert.equal(focus.executionState, 'completed', JSON.stringify(focus))
        await page.evaluate(() => {
          window.__motionMeasures = []; window.__motionFrames = []; window.__motionUiInputs = []
          new PerformanceObserver(list => { for (const m of list.getEntries()) if (m.name.startsWith('video-motion-')) window.__motionMeasures.push({ name: m.name, duration: m.duration, end: m.startTime + m.duration }) }).observe({ entryTypes: ['measure'] })
          const canvas = document.querySelector('canvas[aria-label="剪辑画面"]'); let revision = canvas.dataset.presentedRevision
          new MutationObserver(() => { if (canvas.dataset.presentedRevision !== revision) { revision = canvas.dataset.presentedRevision; window.__motionFrames.push({ at: performance.now(), revision, frame: Number(canvas.dataset.presentedFrame) }) } }).observe(canvas, { attributes: true, attributeFilter: ['data-presented-revision'] })
          document.addEventListener('click', event => { const target = event.target.closest?.('[data-creative-intent-controls] button'); if (target && /(?:原稿 A| B)$/.test(target.textContent.trim())) window.__motionUiInputs.push({ kind: 'ab', at: event.timeStamp }) })
          document.addEventListener('keyup', event => { if (event.target.getAttribute?.('aria-label') === '保真度' && event.key.startsWith('Arrow')) window.__motionUiInputs.push({ kind: 'fidelity', at: event.timeStamp }) })
        })
        const scrub = async frame => {
          await closePanel()
          const view = (await read(['video_edit.document.timeline_view'])).data.properties['video_edit.document.timeline_view']
          const ruler = await page.getByRole('slider', { name: '剪辑时间定位', exact: true }).boundingBox(); assert(ruler)
          const x = ruler.x + frame * 60 * view.zoom / 30 + .1
          assert(Number.isFinite(x), '时间标尺坐标必须来自正式时间线缩放')
          await page.mouse.move(x, ruler.y + 12); await page.mouse.down(); await page.mouse.up(); await presented(frame)
        }
        const drag = async (name, dx, dy = 0) => {
          await closePanel()
          const box = await page.locator('[data-video-edit-program-display]').boundingBox(); assert(box)
          const x = box.x + box.width * .5; const y = box.y + box.height * .5
          await page.mouse.move(x, y); await page.mouse.down()
          for (let i = 1; i <= 6; i++) { await page.mouse.move(x + box.width * dx * i / 6, y + box.height * dy * i / 6); await page.waitForTimeout(40); if (i % 2 === 0) await shot(name + '-' + i) }
          await page.mouse.up(); await page.waitForTimeout(80)
        }
        await panel(); await button(page, '开始示范').click()
        await scrub(20); await shot('01-不播放找位置')
        await saved(doc => doc.creativeIntents?.drafts.length === 1)
        assert.equal(readVideoEditFile(seeded.file).creativeIntents.drafts[0].takes.length, 0, '找位置不能创建示范')
        await drag('02-拖元素示范', -.12, -.05); await scrub(90); await drag('03-分时终点', .12, .03)
        await panel(); await button(page, '结束示范').click(); await button(page, '开始示范').waitFor({ state: 'visible' }); await shot('04-原稿封存')
        await page.getByLabel('整理动作', { exact: true }).click(); await page.getByRole('option', { name: '轻回弹', exact: true }).click()
        await button(page, '整理').click(); await button(page, '应用').waitFor({ state: 'visible', timeout: 90000 }); await shot('05-候选B')
        const normalPreview = async () => {
          await button(page, '正常速预览').click(); await closePanel()
          await page.waitForFunction(() => { const frame = Number(document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame); return frame >= 20 && frame < 36 }, null, { timeout: 20000 })
          await page.waitForFunction(() => Number(document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame) >= 36, null, { timeout: 20000 })
          await playback(55)
        }
        await button(page, '原稿 A').click(); await normalPreview(); await shot('06-原稿A正常速')
        await panel(); await controls.getByRole('button').filter({ hasText: / B$/ }).last().click(); await normalPreview(); await shot('07-候选B正常速对照')
        await panel()
        const switchSample = async original => {
          const before = await page.getByLabel('剪辑画面', { exact: true }).getAttribute('data-presented-revision')
          const count = await page.evaluate(() => window.__motionUiInputs.length)
          await (original ? button(page, '原稿 A') : controls.getByRole('button').filter({ hasText: / B$/ }).last()).click()
          await page.waitForFunction(before => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedRevision !== before, before)
          return page.evaluate(({ count, before }) => { const input = window.__motionUiInputs[count]; const frame = window.__motionFrames.find(frame => frame.at >= input.at && frame.revision !== before); return frame.at - input.at }, { count, before })
        }
        for (let index = 0; index < 5; index++) { await switchSample(true); await switchSample(false) }
        for (let index = 0; index < 30; index++) evidence.abMs.push(await switchSample(index % 2 === 0))
        const sliderSample = async () => {
          const baseline = await page.evaluate(() => ({ inputs: window.__motionUiInputs.length, generations: window.__motionMeasures.filter(measure => measure.name === 'video-motion-candidate-generation').length }))
          await page.getByRole('slider', { name: '保真度' }).press('ArrowRight')
          await page.waitForFunction(baseline => { const generation = window.__motionMeasures.filter(measure => measure.name === 'video-motion-candidate-generation')[baseline.generations]; return generation && window.__motionFrames.some(frame => frame.at >= generation.end) }, baseline, { timeout: 20000 })
          await button(page, '应用').waitFor({ state: 'visible' })
          return page.evaluate(baseline => { const input = window.__motionUiInputs[baseline.inputs]; const generation = window.__motionMeasures.filter(measure => measure.name === 'video-motion-candidate-generation')[baseline.generations]; return window.__motionFrames.find(frame => frame.at >= generation.end).at - input.at }, baseline)
        }
        for (let index = 0; index < 5; index++) await sliderSample()
        for (let index = 0; index < 30; index++) evidence.fidelityMs.push(await sliderSample())
        evidence.abP95Ms = quantile(evidence.abMs, .95); evidence.fidelityP95Ms = quantile(evidence.fidelityMs, .95); store()
        await button(page, '钉住终点').click(); await button(page, '应用').waitFor({ state: 'visible', timeout: 90000 }); await shot('08-终点钉住')
        await button(page, '应用').click(); await saved(doc => doc.creativeIntents.drafts[0].applications.at(-1)?.saved)
        const applied = JSON.stringify(readVideoEditFile(seeded.file).sequences[0].clips[0].curves); await shot('09-应用普通曲线')
        await button(page, '撤销').click(); await saved(doc => !doc.sequences[0].clips[0].curves?.x); await shot('10-一步撤销')
        await button(page, '重做').click(); await saved(doc => JSON.stringify(doc.sequences[0].clips[0].curves) === applied); await shot('11-一步重做')
        await leaveVideoEditProject(page, '保存'); await openVideoEditProjectCard(page, seeded.projectId); await playback(0)
        await panel(); await button(page, '继续上次原稿').click(); await button(page, '原稿 A').waitFor({ state: 'visible' }); await shot('12-重开原稿与钉住点')
        const restored = readVideoEditFile(seeded.file).creativeIntents; assert(restored.drafts[0].pins.length); assert(restored.motionOptions[0].originalRef)
        await panel(); await button(page, '录制轨迹').click(); await button(page, '开始示范').click()
        await page.getByLabel('录制速度', { exact: true }).click(); await page.getByRole('option', { name: '0.5x 慢录', exact: true }).click()
        await playback(0, true); await drag('13-半速手动播放', .08, -.02)
        const at = Number(await page.getByLabel('剪辑画面', { exact: true }).getAttribute('data-presented-frame')); await playback(at)
        await drag('14-暂停继续操作', .08, .02)
        await page.keyboard.down('Alt'); await panel(); await page.waitForTimeout(200); await shot('14a-修饰键示范模式'); await page.keyboard.up('Alt')
        await panel(); await page.getByLabel('示范属性', { exact: true }).click(); await page.getByRole('option', { name: '旋转', exact: true }).click(); await drag('14b-暂停旋转示范', .04)
        await panel(); await page.getByLabel('示范属性', { exact: true }).click(); await page.getByRole('option', { name: '缩放', exact: true }).click(); await drag('14c-暂停缩放示范', .03)
        await panel(); await button(page, '示范运动').click(); await scrub(at + 20); await shot('15-向前示范'); await scrub(Math.max(0, at - 5)); await shot('16-倒退重访')
        await panel(); await button(page, '结束示范').click(); await button(page, '开始示范').waitFor({ state: 'visible' }); await shot('17-录制重访段封存')
        const last = await saved(doc => doc.creativeIntents.drafts.length === 2 && doc.creativeIntents.drafts[1].takes.length > 1)
        assert(last.creativeIntents.drafts[1].clockSegments.some(c => c.anchors.some(a => a.playbackRate === .5)))
        const measures = await page.evaluate(() => window.__motionMeasures)
        evidence.latencyMs = measures.filter(m => m.name === 'video-motion-input-present').map(m => m.duration)
        evidence.candidateMs = measures.filter(m => m.name === 'video-motion-candidate-generation').map(m => m.duration)
        assert(evidence.latencyMs.length, '缺少真实输入至呈现测量'); assert(evidence.candidateMs.length, '缺少候选生成测量')
        evidence.inputP95Ms = quantile(evidence.latencyMs, .95); evidence.generationP95Ms = quantile(evidence.candidateMs, .95)
        store(); await leaveVideoEditProject(page, '保存')
        assert(evidence.inputP95Ms <= 50, `输入呈现 P95 ${evidence.inputP95Ms}ms 超过 50ms`)
        assert(evidence.generationP95Ms <= 900, `候选生成 P95 ${evidence.generationP95Ms}ms 超过 900ms`)
        assert(evidence.abP95Ms <= 100, `A/B P95 ${evidence.abP95Ms}ms 超过 100ms`)
        assert(evidence.fidelityP95Ms <= 300, `保真度 P95 ${evidence.fidelityP95Ms}ms 超过 300ms`)
      } catch (error) {
        evidence.failure = error.message
        const measures = await page.evaluate(() => window.__motionMeasures ?? []).catch(() => [])
        evidence.latencyMs = measures.filter(m => m.name === 'video-motion-input-present').map(m => m.duration)
        evidence.candidateMs = measures.filter(m => m.name === 'video-motion-candidate-generation').map(m => m.duration)
        evidence.inputP95Ms = quantile(evidence.latencyMs, .95); evidence.generationP95Ms = quantile(evidence.candidateMs, .95)
        evidence.failureState = await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => ({ ...canvas.dataset })).catch(() => null)
        await capture('failure').catch(() => {})
        throw error
      } finally { store(); await client?.close(); await disableMcp(page).catch(() => {}) }
    } }
}
module.exports = { createVideoEditMotionDraftScene, fixture }
