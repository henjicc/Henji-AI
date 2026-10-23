const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { execFileSync } = require('node:child_process')
const { fixture } = require('./uiInspectionSceneVideoEditMotionDraft.cjs')
const { seedVideoEditProject } = require('./uiInspectionVideoEditDocuments.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')
const { ffmpegPath, ffprobePath } = require('./mediaBinaries.cjs')

function createRecordingDirectorScene() {
  return { id: 'recording-director', name: '导演录制及改文字稿补录-模拟TTS成片导出撤销', surface: '屏幕录制', writesUserData: true,
    launchArgs: ['--autoplay-policy=no-user-gesture-required'],
    setup: async (page, app, { capture }) => {
      const root = path.resolve('.tmp/ui-inspection/recording-director'); fs.mkdirSync(root, { recursive: true })
      const evidence = { tts: 'Offline sine-wave mock; no provider submission', capture: 'Real isolated application window', paidGenerationBlocked: true }
      const store = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const unblock = await blockPaidGeneration(app)
      let client
      try {
        const texts = ['先打开设置，查看当前主题。', '选择纸白主题，查看界面变化。', '选择纸白主题，检查文字、背景和按钮的对比度，再继续完成演示。']
        const paths = {}
        for (const [i, text] of texts.entries()) {
          const file = path.join(root, `mock-tts-${i}.wav`)
          execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${330 + i * 110}:sample_rate=48000:duration=${i === 2 ? 9 : 2}`, '-af', 'afade=t=in:d=0.03,afade=t=out:st=' + (i === 2 ? 8.97 : 1.97) + ':d=0.03', file], { windowsHide: true })
          paths[text] = file
        }
        await page.waitForFunction(() => Boolean(window.__recordingDirectorTour))
        await page.evaluate(paths => window.__recordingDirectorTour.install(paths), paths)
        const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
        const port = probe.address().port; await new Promise(resolve => probe.close(resolve))
        await page.evaluate(port => window.henjiNative.mcp.configure({ enabled: false, port }), port)
        client = await connectMcpClient((await authorizeMcpConnection(page, { name: '导演录制免费验收', allowWrites: true, allowDestructive: true, allowPaid: true })).config)
        const read = (ref, propertyIds = []) => callTool(client, 'read_application_entity', { ref, propertyIds })
        const invoke = async (name, input, observations = []) => {
          const output = await callTool(client, name, operationEnvelope(observations, input))
          assert.equal(output.executionState, 'completed', JSON.stringify(output)); return output.result.data
        }
        const readDocument = id => page.evaluate(id => window.henjiNative.documents.readDocument({ id }), id)
        const settingsRef = { kind: 'settings.registry', id: 'singleton' }
        const beforeSettings = await read(settingsRef, ['interface.theme_preset'])
        const originalPreset = (beforeSettings.data?.properties ?? beforeSettings.properties)?.['interface.theme_preset']
        assert.equal(typeof originalPreset, 'string', JSON.stringify(beforeSettings))
        const planned = await invoke('plan_screen_recording_director', { goal: '打开设置并切换主题，生成操作教程', voice: await page.evaluate(() => window.__recordingDirectorTour.voice()), steps: texts.slice(0, 2).map((narration, index) => ({ title: index ? '切换主题' : '打开设置', narration, picture: index ? '纸白主题的设置界面' : '石墨主题的设置界面', operations: [{ target: settingsRef, properties: { 'interface.theme_preset': index ? 'paper' : 'graphite' } }], settleMs: 700 })) })
        const planRef = planned.resultRef
        await invoke('open_document', { documentId: planRef.id })
        await page.getByText('AI 导演', { exact: true }).waitFor({ timeout: 15000 })
        await page.screenshot({ path: path.join(root, 'plan.png') }); await capture('recording-director-plan')
        const plan = await readDocument(planRef.id)
        plan.content.understanding.director.confirmed = true
        const understandingRef = { kind: 'screen_recording.understanding', id: planRef.id }
        await invoke('change_application_entities', { summary: '确认已审阅导演脚本', changes: [{ kind: 'set_properties', entityType: understandingRef.kind, target: understandingRef, properties: { 'screen_recording.understanding.result': plan.content.understanding } }] }, [await read(understandingRef)])
        const target = fixture(paths[texts[0]]); target.id = 'tour-director-movie'; target.name = '导演录制成片'; target.media = []; target.items = []; target.sequences = []
        const seeded = await seedVideoEditProject(page, target), documentRef = { kind: 'video_edit.document', id: seeded.documentId }
        const directed = await invoke('start_screen_recording_director', { sessionRef: planRef, documentRef })
        assert.equal(directed.verified, true)
        const recorded = await readDocument(directed.sessionRef.id), before = await readDocument(documentRef.id)
        evidence.directed = directed; evidence.recording = recorded; evidence.before = before; store()
        assert.equal(recorded.content.understanding.transcript.length, 2)
        assert.equal(recorded.content.media.filter(v => v.kind === 'microphone').length, 2)
        const afterSettings = await read(settingsRef, ['interface.theme_preset'])
        assert.equal((afterSettings.data?.properties ?? afterSettings.properties)?.['interface.theme_preset'], originalPreset)
        evidence.settingsRestored = true
        const sequenceId = directed.sequenceRefs[0].id.split(':')[1], sequence = before.content.sequences.find(v => v.id === sequenceId)
        const voices = sequence.clips.filter(v => v.kind === 'audio' && v.text)
        assert.equal(voices.length, 2); assert.equal(sequence.captions.length, 2)
        await invoke('open_document', { documentId: documentRef.id })
        await invoke('focus_application_entity', { ref: directed.sequenceRefs[0] })
        const seek = async frame => {
          const property = 'video_edit.document.program_playback'
          await invoke('change_application_entities', { summary: '查看导演成片', changes: [{ kind: 'set_properties', entityType: documentRef.kind, target: documentRef, properties: { [property]: { frame, playing: false, playbackDirection: 1 } } }] }, [await read(documentRef, [property])])
          await page.waitForFunction(frame => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === String(frame), frame, { timeout: 30000 })
        }
        await seek(voices[1].start + 50)
        await page.screenshot({ path: path.join(root, 'movie.png') }); await capture('recording-director-movie')
        const clipRef = { kind: 'video_edit.clip', id: `${documentRef.id}:${voices[1].id}` }
        const redubbed = await invoke('redub_screen_recording_sentence', { sessionRef: directed.sessionRef, clipRef, text: texts[2], rerecord: false })
        assert.equal(redubbed.verified, true); assert.equal(redubbed.undoSteps, 1)
        const after = await readDocument(documentRef.id), changedSequence = after.content.sequences.find(v => v.id === sequenceId)
        const voice = changedSequence.clips.find(v => v.id === voices[1].id), sequenceFps = changedSequence.frameRate.numerator / changedSequence.frameRate.denominator
        assert.equal(voice.text, texts[2]); assert.equal(voice.duration, 9 * sequenceFps)
        assert.deepEqual(changedSequence.clips.find(v => v.id === voices[0].id), voices[0])
        assert(changedSequence.clips.some(v => v.kind === 'image' && v.name === '旁白停留画面'))
        assert(changedSequence.captions.some(v => v.clipId === voice.id && v.text === texts[2] && v.duration === 9 * sequenceFps))
        assert.equal((await page.evaluate(() => window.__recordingDirectorTour.calls)).length, 3)
        await seek(voice.start + 7 * sequenceFps)
        await page.screenshot({ path: path.join(root, 'redub.png') }); await capture('recording-director-redub')
        const exported = await invoke('export_video_edit', { documentRef, settings: { format: 'mp4', width: 1280, height: 720, fps: 30, videoBitrateMbps: 6, audioBitrateKbps: 192, fit: 'fit', loudness: null, captionMode: 'burn', addToLibrary: false } }, [await read(documentRef)])
        const taskId = exported.queue[0].id, deadline = Date.now() + 360000
        let status
        do { status = await callTool(client, 'query_video_edit_export', { documentRef, taskId, detail: 'full' }); if (['completed', 'failed', 'cancelled'].includes(status.data.queue[0]?.state)) break; await page.waitForTimeout(500) } while (Date.now() < deadline)
        const job = status.data.queue[0]; assert.equal(job.state, 'completed', JSON.stringify(status))
        const output = job.outputPath ?? job.path ?? status.data.task?.outputPath
        assert(output && fs.existsSync(output)); fs.copyFileSync(output, path.join(root, 'redub.mp4'))
        evidence.probe = JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output], { windowsHide: true }).toString())
        assert(evidence.probe.streams.some(v => v.codec_type === 'audio')); assert(evidence.probe.streams.some(v => v.codec_type === 'video'))
        const duration = Math.max(...changedSequence.clips.map(v => v.start + v.duration)) / sequenceFps
        assert(Math.abs(Number(evidence.probe.format.duration) - duration) < .15)
        execFileSync(ffmpegPath, ['-v', 'error', '-y', '-ss', String((voice.start + 7 * sequenceFps) / sequenceFps), '-i', output, '-frames:v', '1', path.join(root, 'export-hold.png')], { windowsHide: true })
        await invoke('undo_video_edit', { documentRef }, [await read(documentRef)])
        const undone = await readDocument(documentRef.id)
        assert.deepEqual(undone.content.sequences, before.content.sequences); assert.deepEqual(undone.content.media, before.content.media)
        evidence.after = after; evidence.redubbed = redubbed; evidence.undoRestored = true; evidence.completed = true
        assert(!(await page.evaluate(() => window.henjiNative.documents.listProjects())).some(v => v.name.startsWith('重放临时-')))
        // 9f7b554df 移除补录面板；上方保留正式补录、导出与一步撤销的全部断言。
        evidence.flow = { basis: '9f7b554df', removed: '补录面板终态截图', changed: '按实际序列帧率核对九秒补录及七秒停留画面', assertions: '保留九秒时长、字幕、音画导出与完整撤销'  }
        await page.screenshot({ path: path.join(root, 'redub-undone.png') })
        await capture('recording-director-undone')
      } catch (error) { evidence.failure = String(error); await page.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {}); throw error }
      finally { store(); await client?.close(); await disableMcp(page).catch(() => {}); await unblock() }
    },
  }
}
module.exports = { createRecordingDirectorScene }
