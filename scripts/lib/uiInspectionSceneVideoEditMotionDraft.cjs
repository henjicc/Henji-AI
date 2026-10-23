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
    launchArgs: ['--autoplay-policy=no-user-gesture-required'],
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/video-edit-motion-draft'); fs.mkdirSync(root, { recursive: true })
      const evidence = { frames: [], candidateMs: [], latencyMs: [],  visualReview: '待代理逐张目视检查' }
      const store = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      let client; let seeded
      const controls = page.getByRole('switch', { name: '麦克风', exact: true })
      const trigger = () => page.getByRole('button', { name: /^(超级关键帧|正在示范)$/ })
      const panel = async () => { if (!await controls.isVisible()) await trigger().click(); await controls.waitFor({ state: 'visible' }) }
      const closePanel = async () => { if (await controls.isVisible()) { await page.keyboard.press('Escape'); await controls.waitFor({ state: 'hidden' }) } }
      const shot = async name => {
        await page.waitForTimeout(250) // 等待面板过渡结束，再保留目视证据。
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
        // f09b6bf3b 将旧编辑面板改为录制/交接；算法与应用仍由正式能力提供。
        evidence.flow = { basis: 'c1c81a550 / f09b6bf3b / creativeIntentFields.ts / creativeIntentCapabilities.ts',
          removed: ['原稿 A 按钮与 A/B 点击耗时', '保真度滑块点击耗时', '半速、属性与模式选择器'],
          retained: ['原生拖动采集', '候选生成与播放', '保真度与钉点', '应用、撤销、重做、重开', '输入 P95 50ms、生成 P95 900ms'] }
        const readEntity = ref => callTool(client, 'read_application_entity', { ref })
        const change = async (ref, properties) => {
          const result = await callTool(client, 'change_application_entities', operationEnvelope([await readEntity(ref)], { summary: '验收超级关键帧', changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties }] }))
          assert.equal(result.executionState, 'completed', JSON.stringify(result)); return result
        }
        await panel()
        if (await controls.getAttribute('aria-checked') === 'true') await controls.click()
        await button(page, '开始录制').click(); await button(page, '暂停').waitFor()
        await scrub(20); await shot('01-不播放找位置')
        await saved(doc => doc.creativeIntents?.drafts.length === 1)
        // c1c81a550 开始时先建空段；纯定位不得生成动作采样。
        assert.equal(readVideoEditFile(seeded.file).creativeIntents.drafts[0].takes.flatMap(take => take.samplePages).length, 0, '找位置不能创建动作采样')
        await drag('02-拖元素示范', -.12, -.05); await scrub(90); await drag('03-分时终点', .12, .03)
        await panel(); await button(page, '暂停').click(); await button(page, '继续录制').waitFor()
        await button(page, '继续录制').click(); await button(page, '暂停').waitFor()
        await scrub(120); await drag('04-继续录制', -.03, .02); await scrub(55)
        await panel(); await button(page, '完成').click(); await button(page, '交给 AI').waitFor({ timeout: 30000 })
        await closePanel(); await page.keyboard.press('Escape')
        // 交接只写助手草稿，不发送；关闭助手以恢复原节目画幅。
        const assistantClose = page.getByRole('button', { name: '收起智能助手', exact: true })
        if (await assistantClose.isVisible()) await assistantClose.click()
        const sealed = await saved(doc => doc.creativeIntents?.drafts[0]?.takes.length >= 2)
        const draft = sealed.creativeIntents.drafts[0], draftRef = { kind: 'video_edit.intent_draft', id: `${seeded.documentId}:${encodeURIComponent(draft.id)}` }
        assert(draft.clockSegments.length > 1, '暂停与重访时钟必须保留')
        await shot('05-原稿封存')
        const organize = async () => {
          const result = await callTool(client, 'organize_video_edit_intent', operationEnvelope([await readEntity(draftRef)], { draftRef, motionIntent: { kind: 'follow_path', preserveJitter: false } }))
          assert.equal(result.executionState, 'completed', JSON.stringify(result)); assert(result.result.data.candidateRefs.length)
          return result.result.data.candidateRefs[0]
        }
        let candidate = await organize(); await shot('06-候选')
        await playback(20, true)
        await page.waitForFunction(() => Number(document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame) >= 36, null, { timeout: 20000 })
        await playback(55); await shot('07-候选正常速播放')
        await change(draftRef, { 'video_edit.intent_draft.fidelity': .7 }); candidate = await organize()
        const head = readVideoEditFile(seeded.file).creativeIntents
        const samples = head.drafts[0].takes.flatMap(take => take.samplePages.flatMap(ref => JSON.parse(fs.readFileSync(head.resources.find(r => r.resourceId === ref.resourceId).path, 'utf8')).entries))
        const lastSample = samples.at(-1); assert(lastSample?.sampleId)
        const pinned = await callTool(client, 'change_application_entities', operationEnvelope([await readEntity(draftRef)], { summary: '钉住最后姿态', changes: [{ kind: 'create_items', entityType: 'video_edit.intent_pin', parent: draftRef, items: [{ properties: { 'video_edit.intent_pin.sample_id': lastSample.sampleId } }] }] }))
        assert.equal(pinned.executionState, 'completed', JSON.stringify(pinned)); candidate = await organize()
        await change(candidate, { 'video_edit.intent_candidate.selected': true }); await shot('08-终点钉住')
        await change(candidate, { 'video_edit.intent_candidate.applied': true })
        await saved(doc => doc.creativeIntents.drafts[0].applications.at(-1)?.saved)
        const applied = JSON.stringify(readVideoEditFile(seeded.file).sequences[0].clips[0].curves); assert(applied)
        await shot('09-应用普通曲线')
        await button(page, '撤销').click(); await saved(doc => !doc.sequences[0].clips[0].curves?.x); await shot('10-一步撤销')
        await button(page, '重做').click(); await saved(doc => JSON.stringify(doc.sequences[0].clips[0].curves) === applied); await shot('11-一步重做')
        await leaveVideoEditProject(page, '保存'); await openVideoEditProjectCard(page, seeded.projectId); await playback(0)
        await callTool(client, 'focus_application_entity', operationEnvelope([], { ref: clipRef }))
        await panel(); await button(page, '交给 AI').waitFor(); await shot('12-重开原稿与钉住点')
        const restored = readVideoEditFile(seeded.file).creativeIntents
        assert(restored.drafts[0].pins.length); assert(restored.motionOptions[0].originalRef)
        assert.equal(restored.drafts[0].fidelity, .7); assert.equal(JSON.stringify(readVideoEditFile(seeded.file).sequences[0].clips[0].curves), applied)
        const measures = await page.evaluate(() => window.__motionMeasures)
        evidence.latencyMs = measures.filter(m => m.name === 'video-motion-input-present').map(m => m.duration)
        evidence.candidateMs = measures.filter(m => m.name === 'video-motion-candidate-generation').map(m => m.duration)
        assert(evidence.latencyMs.length, '缺少真实输入至呈现测量'); assert(evidence.candidateMs.length, '缺少候选生成测量')
        evidence.inputP95Ms = quantile(evidence.latencyMs, .95); evidence.generationP95Ms = quantile(evidence.candidateMs, .95)
        store(); await leaveVideoEditProject(page, '保存')
        assert(evidence.inputP95Ms <= 50, `输入呈现 P95 ${evidence.inputP95Ms}ms 超过 50ms`)
        assert(evidence.generationP95Ms <= 900, `候选生成 P95 ${evidence.generationP95Ms}ms 超过 900ms`)
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
