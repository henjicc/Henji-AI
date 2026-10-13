const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { videoEditFixtureProject } = require('./uiInspectionSceneVideoEditProbe.cjs')
const { seedVideoEditProject, openVideoEditProjectCard, readVideoEditFile, leaveVideoEditProject } = require('./uiInspectionVideoEditDocuments.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { observeWorkers, waitReleased } = require('./uiInspectionSceneVideoEditLayout.cjs')
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
function summarize(runs) {
  return Object.fromEntries(['open', 'switch'].map(reason => {
    const samples = runs.filter(run => run.reason === reason)
    const warm = reason === 'open' ? samples.slice(1) : samples
    return [reason, { cold: reason === 'open' ? samples[0] : undefined, medianMs: median(warm.map(run => run.first.elapsedMs)), longTaskMaxMs: Math.max(...warm.map(run => run.window.longTaskMaxMs)), samples: warm.length }]
  }))
}
function createVideoEditFirstFrameScene() {
  return { id: 'video-edit-first-frame', surface: '剪辑', name: '剪辑-打开与新序列首帧分段计时', writesUserData: true,
    setup: async (page, app) => {
      const root = path.resolve('node_modules/.cache/video-edit-first-frame'); fs.mkdirSync(root, { recursive: true })
      const source = path.join(root, '1080p60.mp4')
      if (!fs.existsSync(source)) execFileSync(require('./mediaBinaries.cjs').ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=60', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '8', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-g', '240', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source], { windowsHide: true })
      const clip = { id: 'v', mediaId: 'source', name: '画面', kind: 'video', track: 1, start: 0, duration: 480, sourceInUs: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' }
      const fixture = videoEditFixtureProject({ id: 'first-frame', name: '首帧计时', revision: 0, width: 1920, height: 1080, fps: 60, media: [{ id: 'source', name: '1080p60', path: source, kind: 'video', durationSeconds: 8, width: 1920, height: 1080, hasAudio: true }], clips: [clip, { ...clip, id: 'a', name: '声音', kind: 'audio', sourceComponent: 'audio', track: 0 }], annotations: [] })
      const seeded = await seedVideoEditProject(page, fixture)
      await observeWorkers(page)
      const evidence = { mode: process.env.HENJI_BUNDLE_MODE || 'development', runs: [] }
      const save = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const collect = async (after, reason) => {
        let events
        for (let i = 0; i < 160; i++) {
          events = await page.evaluate(async after => (await window.henjiNative.logging.queryLogEvents({ date: after.slice(0, 10), afterTimestamp: after, keyword: 'video_edit', limit: 2000 })).events, after)
          if (events.some(entry => entry.event === 'video_edit.program.window.completed' && entry.context?.reason === 'presented')) break
          await page.waitForTimeout(100)
        }
        const first = events.find(entry => entry.event === 'video_edit.program.first_frame')?.context
        const window = events.find(entry => entry.event === 'video_edit.program.window.completed' && entry.context?.reason === 'presented')?.context
        assert.ok(first && window, `缺少首帧及长任务回执：${JSON.stringify(events)}`)
        const run = { reason, first, window, prewarm: events.filter(entry => entry.event === 'video_edit.decode.prewarm.completed').map(entry => entry.context), stages: events.filter(entry => entry.context?.startedAt === first.startedAt).map(entry => ({ event: entry.event, ...entry.context })) }
        evidence.runs.push(run); save(); console.log('[first-frame]', JSON.stringify(run))
      }
      // 首次原生子进程冷启动单列；随后三次打开同一已存项目。
      for (let i = 0; i < 4; i++) {
        const after = new Date().toISOString(); await openVideoEditProjectCard(page, seeded.projectId); await collect(after, 'open')
        if (i < 3) { await leaveVideoEditProject(page); await waitReleased(page) }
      }
      let client
      try {
        const auth = await authorizeMcpConnection(page, { name: '首帧巡检', allowWrites: true })
        client = await connectMcpClient(auth.config)
        const projectRef = { kind: 'video_edit.document', id: seeded.documentId }
        const read = ref => callTool(client, 'read_application_entity', { ref })
        for (let i = 0; i < 3; i++) {
          const name = `首帧序列 ${i + 1}`
          await callTool(client, 'change_application_entities', operationEnvelope([await read(projectRef)], { summary: '创建未打开序列', changes: [{ kind: 'create_items', entityType: 'video_edit.sequence', parent: projectRef, items: [{ properties: { 'video_edit.sequence.name': name, 'video_edit.sequence.frame_rate': { numerator: 60, denominator: 1 } } }] }] }))
          const sequence = readVideoEditFile(seeded.file).sequences.find(value => value.name === name)
          assert.ok(sequence)
          const sequenceRef = { kind: 'video_edit.sequence', id: `${seeded.documentId}:${sequence.id}` }
          await callTool(client, 'change_application_entities', operationEnvelope([await read(sequenceRef)], { summary: '加入首帧画面', changes: [{ kind: 'create_items', entityType: 'video_edit.clip', parent: sequenceRef, items: ['video'].map(kind => ({ properties: { 'video_edit.clip.item_id': 'item-source', 'video_edit.clip.name': kind, 'video_edit.clip.kind': kind, 'video_edit.clip.track': sequence.tracks.find(track => track.kind === kind).index, 'video_edit.clip.start': 0, 'video_edit.clip.duration': 480 } })) }] }))
          await page.waitForTimeout(1500)
          const after = new Date().toISOString()
          await page.locator(`[data-video-edit-project-entry="${sequence.id}"]`).dblclick()
          await collect(after, 'switch')
        }
      } finally { await client?.close(); await disableMcp(page) }
      evidence.summary = summarize(evidence.runs); save(); console.log('[first-frame-summary]', JSON.stringify(evidence.summary))
      await leaveVideoEditProject(page); await waitReleased(page)
    } }
}
module.exports = { createVideoEditFirstFrameScene, summarize }
