/* eslint-disable @typescript-eslint/no-var-requires */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')
const { fixture } = require('./uiInspectionSceneVideoEditMotionDraft.cjs')
const { seedVideoEditProject, openVideoEditProjectCard, readVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')
const { captureInspectionPage } = require('./uiInspectionCapture.cjs')

const button = (page, name) => page.getByRole('button', { name, exact: true })
function createVideoEditExplanationScene() {
  return { id: 'video-edit-explanation', surface: '剪辑', name: '剪辑-录制讲解与指代审阅', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/t150-explanation'); fs.mkdirSync(root, { recursive: true })
      const evidence = { frames: [], audio: '本地合成流经正式AudioWorklet', transcription: '受控毫秒DTO，非真实ASR', visualReview: '待逐张目视', paidCalls: 0 }
      const store = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const unblock = await blockPaidGeneration(app)
      let client; let seeded
      // Only replace the paid ASR boundary. PCM I/O, capture, clocks and document pages stay real.
      await app.evaluate(({ ipcMain }) => {
        const handlers = ipcMain._invokeHandlers
        const original = handlers.get('audioEdit:explanation'); assertOriginal(original)
        globalThis.__t150AudioOriginal = original
        globalThis.__t150AsrCalls = 0
        ipcMain.removeHandler('audioEdit:explanation')
        ipcMain.handle('audioEdit:explanation', async (event, input) => {
          if (input.action !== 'transcribe') return original(event, input)
          globalThis.__t150AsrCalls++
          const supplied = globalThis.__t150TranscriptByChunk?.[input.chunkId]
          if (supplied) return { ok: true, data: { modelId: input.modelId, providerId: 'bailian', requestId: input.requestId, transcript: supplied } }
          return { ok: true, data: { modelId: input.modelId, providerId: 'bailian', requestId: input.requestId,
            transcript: { text: '本地测试音流', unit: 'ms', granularity: 'segment', words: [],
              segments: [{ text: '本地测试音流', startMs: 0, endMs: 50, granularity: 'segment', timing: 'coarse', confidence: .99 }] } } }
        })
        // No credential is written; settings only receives fixture availability in this isolated process.
        const key = handlers.get('ai:getProviderApiKey'); globalThis.__t150KeyOriginal = key
        ipcMain.removeHandler('ai:getProviderApiKey')
        ipcMain.handle('ai:getProviderApiKey', async (event, input) => input.providerId === 'bailian' ? { ok: true, data: 'local-reality-fixture' } : key(event, input))
        const status = handlers.get('ai:getRuntimeProviderKeyStatus'); globalThis.__t150StatusOriginal = status
        ipcMain.removeHandler('ai:getRuntimeProviderKeyStatus')
        ipcMain.handle('ai:getRuntimeProviderKeyStatus', async event => {
          const result = await status(event)
          return { ...result, data: [...result.data.filter(value => value.providerId !== 'bailian'), { providerId: 'bailian', configured: true }] }
        })
        function assertOriginal(value) { if (!value) throw new Error('正式录音IPC未登记') }
      })
      await page.reload(); await page.waitForLoadState('domcontentloaded')
      await page.evaluate(() => {
        window.__t150Streams = []
        navigator.mediaDevices.getUserMedia = async constraints => {
          if (constraints.video || !constraints.audio) throw new Error('仅允许合成单声道音频')
          const context = new AudioContext(); const oscillator = context.createOscillator(); const gain = context.createGain()
          gain.gain.value = .03; oscillator.frequency.value = 220
          const output = context.createMediaStreamDestination(); oscillator.connect(gain).connect(output); oscillator.start()
          const track = output.stream.getAudioTracks()[0]; const stop = track.stop.bind(track); let stopped = false
          track.stop = () => { if (stopped) return; stopped = true; stop(); oscillator.stop(); if (context.state !== 'closed') void context.close() }
          window.__t150Streams.push(output.stream)
          return output.stream
        }
      })
      const trigger = () => page.getByRole('button', { name: /^(录制讲解|正在录制|录制已暂停)$/ })
      const panel = async () => { if (!await button(page, '开始录制讲解').isVisible() && !await button(page, '继续录制').isVisible() && !await button(page, '结束录制').isVisible()) await trigger().click() }
      const close = async () => { if (await button(page, '开始录制讲解').isVisible() || await button(page, '继续录制').isVisible() || await button(page, '结束录制').isVisible()) { await trigger().click(); await page.waitForTimeout(180) } }
      const shot = async name => {
        const suffix = `step-${String(evidence.frames.length + 1).padStart(3, '0')}`
        // Wait for the compositor after the renderer receipt / popover animation.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        await page.waitForTimeout(180)
        await capture(suffix)
        const data = await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => ({ ...canvas.dataset }))
        let whitePixelRatio
        if (!/^01-|^12-/.test(name)) {
          const clip = await page.getByLabel('剪辑画面', { exact: true }).boundingBox()
          assert.ok(clip, '节目画面必须可见')
          const bytes = await captureInspectionPage(app, page, { clip })
          const image = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
          let white = 0
          for (let offset = 0; offset < image.data.length; offset += image.info.channels) if (image.data[offset] > 220 && image.data[offset + 1] > 220 && image.data[offset + 2] > 220) white++
          whitePixelRatio = white / (image.info.width * image.info.height)
        }
        evidence.frames.push({ name, suffix, ...data, whitePixelRatio }); store()
        if (whitePixelRatio !== undefined) assert.ok(whitePixelRatio > .01, `${name}：正式 Electron 节目截图丢失预置画面，不能只按呈现回执通过`)
      }
      const saved = async test => { for (let i = 0; i < 200; i++) { const doc = readVideoEditFile(seeded.file); if (test(doc)) return doc; await page.waitForTimeout(50) } assert.fail('讲解未保存到预期状态') }
      try {
        const source = path.join(root, 'source.png')
        await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="white"/><circle cx="640" cy="360" r="230" fill="black"/></svg>')).png().toFile(source)
        const project = fixture(source)
        project.sequences[0].clips.push({ ...project.sequences[0].clips[0], id: 'overlap-clip', scale: .3 })
        await button(page, '剪辑').first().click(); seeded = await seedVideoEditProject(page, project)
        await page.evaluate(async ({ source, projectId, id }) => {
          const api = window.henjiNative.documents; const resource = await api.importFile({ sourcePath: source, container: { kind: 'project', projectId }, folder: 'materials' })
          const read = await api.readDocument({ id }); read.content.media[0].path = resource.path
          await api.saveDocument({ target: { id }, expectedRevision: read.meta.revision, content: read.content })
        }, { source, projectId: seeded.projectId, id: seeded.documentId })
        await openVideoEditProjectCard(page, seeded.projectId)
        await page.waitForFunction(() => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === '0')
        const identity = await authorizeMcpConnection(page, { name: '讲解受控验收', allowWrites: true, allowDestructive: true })
        client = await connectMcpClient(identity.config, 'Henji explanation Reality')
        const ref = { kind: 'video_edit.document', id: seeded.documentId }
        const playback = async (frame, playing = false) => {
          await close(); const property = 'video_edit.document.program_playback'
          const baseline = await callTool(client, 'read_application_entity', { ref, propertyIds: [property] })
          const result = await callTool(client, 'change_application_entities', operationEnvelope([baseline], { summary: '手动时间控制', changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties: { [property]: { frame, playing, playbackDirection: 1 } } }] }))
          assert.equal(result.executionState, 'completed', JSON.stringify(result))
          if (!playing) await page.waitForFunction(frame => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === String(frame), frame)
        }
        await callTool(client, 'focus_application_entity', operationEnvelope([], { ref: { kind: 'video_edit.clip', id: seeded.documentId + ':motion-clip' } }))
        await panel(); await button(page, '开始录制讲解').click(); await button(page, '同意并开始录制').waitFor(); await page.waitForTimeout(180); await shot('01-知情提示')
        await button(page, '同意并开始录制').click(); await page.getByLabel('暂停录制讲解', { exact: true }).waitFor(); await close(); await shot('02-开始不播放')
        const view = await callTool(client, 'read_application_entity', { ref, propertyIds: ['video_edit.document.timeline_view'] })
        const ruler = await page.getByRole('slider', { name: '剪辑时间定位', exact: true }).boundingBox(); assert(ruler)
        await page.mouse.move(ruler.x + 20 * 60 * view.data.properties['video_edit.document.timeline_view'].zoom / 30 + .1, ruler.y + 12)
        await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(300); await shot('03-不播放拖时间指针')
        await playback(20, true)
        for (let i = 0; i < 3; i++) { await page.waitForTimeout(200); await shot('04-播放-' + i) }
        await playback(80)
        await button(page, '选择').last().click(); await button(page, '移动画面').click()
        const box = await page.locator('[data-video-edit-program-display]').boundingBox(); assert(box)
        await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5); await page.mouse.down()
        for (let i = 1; i <= 3; i++) { await page.mouse.move(box.x + box.width * (.5 + i * .02), box.y + box.height * .5); await page.waitForTimeout(100); await shot('05-暂停讲话操作-' + i) }
        await page.mouse.up()
        await page.waitForTimeout(350)
        await page.mouse.click(box.x + box.width * .82, box.y + box.height * .5); await page.waitForTimeout(350)
        await playback(40); await shot('06-倒退')
        await playback(40, true); await page.waitForTimeout(250); await shot('07-继续播放'); await playback(70)
        // Device loss is injected as the MediaStream track ended event, handled by the production capture service.
        await page.evaluate(() => window.__t150Streams.at(-1).getAudioTracks()[0].dispatchEvent(new Event('ended')))
        await trigger().filter({ hasText: '录制已暂停' }).waitFor(); await panel(); await shot('08-麦克风断开')
        await button(page, '继续录制').click(); await page.getByLabel('暂停录制讲解', { exact: true }).waitFor(); await close(); await shot('09-恢复麦克风')
        await page.waitForTimeout(1700); await page.getByLabel('结束录制讲解', { exact: true }).click()
        await page.getByLabel('讲解词稿审阅', { exact: true }).waitFor(); await shot('10-结束')
        const sessionDoc = await saved(doc => doc.creativeIntents?.sessions[0]?.state === 'reviewing')
        assert(sessionDoc.creativeIntents.sessions[0].clockSegments.some(c => c.mode === 'gap'))
        const session = sessionDoc.creativeIntents.sessions[0]
        const events = session.pages.flatMap(ref => { const resource = sessionDoc.creativeIntents.resources.find(value => value.resourceId === ref.resourceId); return JSON.parse(fs.readFileSync(resource.path, 'utf8')).entries })
        const points = events.filter(event => event.kind === 'pointer' && event.phase === 'down' && event.compositionPoint && event.timeline?.frame === 80)
        const first = points.find(point => point.hoverRefs.length > 1); const last = points.find(point => point.compositionPoint[0] > .75); assert(first && last, '需实际重叠指向与终点证据')
        const audio = events.find(event => event.kind === 'audio' && event.monoSpanUs[0] <= first.monoUs && event.monoSpanUs[1] >= last.monoUs); assert(audio, '词时段必须来自真实音频块')
        const startMs = Math.max(0, (first.monoUs - audio.monoSpanUs[0]) / 1000); const endMs = (last.monoUs - audio.monoSpanUs[0]) / 1000
        const words = [{ text: '从', startMs: Math.max(0, startMs - 60), endMs: startMs, granularity: 'word', timing: 'precise', confidence: .99 }, { text: '这里', startMs, endMs: startMs + 100, granularity: 'word', timing: 'precise', confidence: .99 }, { text: '到', startMs: endMs - 60, endMs, granularity: 'word', timing: 'precise', confidence: .99 }, { text: '那边', startMs: endMs, endMs: endMs + 100, granularity: 'word', timing: 'precise', confidence: .99 }]
        const fixtureTranscript = { text: '从这里到那边。别动它。', unit: 'ms', granularity: 'mixed', words, segments: [{ text: '从这里到那边', startMs: words[0].startMs, endMs: endMs + 100, granularity: 'segment', timing: 'coarse', words }, { text: '别动它', startMs: Math.min(endMs + 120, (audio.monoSpanUs[1] - audio.monoSpanUs[0]) / 1000 - 110), endMs: Math.min(endMs + 220, (audio.monoSpanUs[1] - audio.monoSpanUs[0]) / 1000 - 10), granularity: 'segment', timing: 'coarse', confidence: .99 }] }
        await app.evaluate((_electron, { chunk, transcript }) => { globalThis.__t150TranscriptByChunk = { [chunk]: transcript } }, { chunk: audio.audioSegmentRef, transcript: fixtureTranscript })
        await button(page, '转写并审阅').click(); await button(page, '同意上传并转写').click()
        await page.getByLabel('校正讲解文字', { exact: true }).first().waitFor(); await shot('11-真实词句粒度审阅')
        await saved(doc => doc.creativeIntents?.sessions[0]?.pages.some(p => p.kind === 'transcript'))
        await page.getByRole('button', { name: '查看词「这里」的录制证据', exact: true }).first().click()
        await page.getByText('指向重叠对象，需确认其中一个', { exact: false }).first().waitFor(); await page.getByAltText('指向时保存的作品画面').first().waitFor(); await shot('11a-点词历史画面与重叠确认')
        await page.getByRole('button', { name: /^确认起点「这里」/ }).first().click(); await page.getByRole('button', { name: /^确认终点「那边」/ }).first().click()
        const proposal = page.getByText('候选更新：1 处位置差异待审阅。', { exact: false }).first()
        await proposal.waitFor(); await proposal.scrollIntoViewIfNeeded(); await shot('11b-绑定后当前差异候选')
        const beforeBinding = readVideoEditFile(seeded.file).creativeIntents.sessions[0].bindings
        await page.getByRole('button', { name: /^确认起点「这里」/ }).nth(1).click(); await page.waitForTimeout(200)
        await saved(doc => JSON.stringify(doc.creativeIntents.sessions[0].bindings) !== JSON.stringify(beforeBinding)); await proposal.scrollIntoViewIfNeeded(); await shot('11c-改绑定更新候选')
        evidence.bindingsBefore = beforeBinding; evidence.bindingsAfter = readVideoEditFile(seeded.file).creativeIntents.sessions[0].bindings
        await button(page, '返回讲解词稿').click()
        const coarse = page.getByText(/句级时间，请确认对应画面/).first()
        const pageCount = readVideoEditFile(seeded.file).creativeIntents.sessions[0].pages.filter(ref => ref.kind === 'transcript').length
        for (let index = 0; index < pageCount; index++) {
          await page.getByLabel('校正讲解文字', { exact: true }).first().waitFor(); await page.waitForTimeout(200)
          await page.locator('[aria-label="讲解词稿审阅"] [data-virtuoso-scroller]').evaluate(element => { element.scrollTop = element.scrollHeight }); await page.waitForTimeout(200)
          if (await coarse.isVisible()) break
          const next = button(page, '下一页词稿'); if (!await next.isEnabled()) break; await next.click()
        }
        await coarse.waitFor(); await coarse.scrollIntoViewIfNeeded(); await shot('11d-句级粗时间明确呈现')
        evidence.session = readVideoEditFile(seeded.file).creativeIntents.sessions[0]
        evidence.asrFixtureCalls = await app.evaluate(() => globalThis.__t150AsrCalls)
        await panel(); await button(page, '彻底删除本次讲解').click(); await shot('12-删除确认')
        await button(page, '彻底删除').click(); await saved(doc => doc.creativeIntents?.sessions.length === 0); await close(); await shot('13-删除完成')
        assert.equal(await page.evaluate(() => window.__t150Streams.every(s => s.getTracks().every(t => t.readyState === 'ended'))), true)
      } catch (error) { evidence.failure = error.message; if (seeded) { evidence.session = readVideoEditFile(seeded.file).creativeIntents?.sessions[0]; evidence.documentFile = seeded.file } await panel().catch(() => {}); evidence.failurePanel = await page.getByRole('alert').allTextContents().catch(() => []); await capture('failure').catch(() => {}); throw error }
      finally {
        store(); await client?.close(); await disableMcp(page).catch(() => {})
        await app.evaluate(({ ipcMain }) => {
          for (const [channel, original] of [['audioEdit:explanation', globalThis.__t150AudioOriginal], ['ai:getProviderApiKey', globalThis.__t150KeyOriginal], ['ai:getRuntimeProviderKeyStatus', globalThis.__t150StatusOriginal]]) { ipcMain.removeHandler(channel); if (original) ipcMain.handle(channel, original) }
          delete globalThis.__t150AudioOriginal; delete globalThis.__t150KeyOriginal
          delete globalThis.__t150StatusOriginal
          delete globalThis.__t150TranscriptByChunk
        }).catch(() => {})
        await unblock()
      }
    } }
}
module.exports = { createVideoEditExplanationScene }
