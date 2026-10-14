const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { videoEditFixtureProject } = require('./uiInspectionSceneVideoEditProbe.cjs')
const { seedVideoEditProject, openVideoEditProjectCard, readVideoEditFile, leaveVideoEditProject } = require('./uiInspectionVideoEditDocuments.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')

function createScreenAttentionScene() {
  return { id: 'screen-attention', surface: '剪辑', name: '录屏注意力-正式生成与推近平移回全景', writesUserData: true,
    setup: async page => {
      const root = path.resolve('node_modules/.cache/screen-attention'); fs.mkdirSync(root, { recursive: true })
      const source = path.join(root, 'screen.mp4')
      execFileSync(require('./mediaBinaries.cjs').ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:size=1920x1080:rate=60', '-vf', 'drawbox=x=200:y=300:w=400:h=200:color=red:t=fill,drawbox=x=1320:y=580:w=400:h=200:color=blue:t=fill', '-t', '10', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', source], { windowsHide: true })
      const log = await require('../check-persistence-compat.cjs').loadTypeScript('src/tests/screenAttentionFixture.ts').screenAttentionFixture()
      log.source.pages = log.source.pages.map((ref, index) => {
        const file = path.join(root, `page-${index}.capture.json`); fs.writeFileSync(file, log.bytes.get(ref.path)); return { ...ref, path: file }
      })
      const clip = { id: 'screen-clip', mediaId: 'screen', name: '屏幕原片', kind: 'video', track: 1, start: 0, duration: 600, sourceInUs: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '', effects: [{ id: 'cursor-effect', name: '录制光标', enabled: true, amount: 1, builtin: { id: 'recording_cursor', params: { click_style: 'highlight' } } }] }
      const fixture = videoEditFixtureProject({ id: 'screen-attention', name: '注意力推近验收', revision: 0, width: 1920, height: 1080, fps: 60,
        media: [{ id: 'screen', name: '屏幕原片', path: source, kind: 'video', durationSeconds: 10, width: 1920, height: 1080, hasAudio: false, recordingCursor: log.source }], clips: [clip], annotations: [] })
      const seeded = await seedVideoEditProject(page, fixture); await openVideoEditProjectCard(page, seeded.projectId)
      let client; const evidence = {}
      try {
        client = await connectMcpClient((await authorizeMcpConnection(page, { name: '注意力推近免费验收', allowWrites: true, allowDestructive: true })).config)
        const documentRef = { kind: 'video_edit.document', id: seeded.documentId }
        const clipRef = { kind: 'video_edit.clip', id: `${seeded.documentId}:screen-clip` }
        const read = (ref, propertyIds) => callTool(client, 'read_application_entity', { ref, propertyIds })
        const set = async (ref, properties) => {
          const response = await callTool(client, 'change_application_entities', operationEnvelope([await read(ref, Object.keys(properties))], { summary: '注意力推近验证', changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties }] }))
          assert.equal(response.executionState, 'completed', JSON.stringify(response))
        }
        const generated = await callTool(client, 'generate_video_edit_screen_attention', operationEnvelope([await read(clipRef, ['video_edit.clip.scale.keyframes'])], { documentRef, clipRef, settings: { strength: 'strong' } }))
        assert.equal(generated.executionState, 'completed', JSON.stringify(generated)); assert.equal(generated.verificationState, 'verified'); assert.equal(generated.result.data.verified, true)
        const curves = readVideoEditFile(seeded.file).sequences[0].clips[0].curves
        assert.ok(curves.scale.every(value => value.source === 'screen_attention'))
        evidence.keyframes = Object.fromEntries(Object.entries(curves).map(([key, values]) => [key, values.length]))
        const canvas = page.locator('canvas[aria-label="剪辑画面"]')
        const center = async frame => {
          await set(documentRef, { 'video_edit.document.program_playback': { frame, playing: false, playbackDirection: 1 } })
          await page.waitForFunction(frame => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === String(frame), frame, { timeout: 30000 })
          const data = await canvas.evaluate(value => value.toDataURL('image/png'))
          const bytes = Buffer.from(data.split(',')[1], 'base64'); fs.writeFileSync(path.join(root, `frame-${frame}.png`), bytes)
          const pixels = require('pngjs').PNG.sync.read(bytes); const offset = ((pixels.height >> 1) * pixels.width + (pixels.width >> 1)) * 4
          return [...pixels.data.subarray(offset, offset + 4)]
        }
        evidence.wide = await center(0); evidence.left = await center(120); evidence.right = await center(300); evidence.idle = await center(599)
        assert.ok(evidence.left[0] > evidence.left[2] + 100, '第一次点击推近红色区域')
        assert.ok(evidence.right[2] > evidence.right[0] + 100, '第二次点击平移至蓝色区域')
        assert.ok(Math.abs(evidence.idle[0] - evidence.idle[2]) < 10, '无信号时回全景居中')
        const evaluate = require('../check-persistence-compat.cjs').loadTypeScript('src/core/videoEdit/keyframes.ts').evaluateVideoEditKeyframes
        const scales = Array.from({ length: 600 }, (_, frame) => evaluate(curves.scale, frame, 1))
        evidence.maxScaleStep = Math.max(...scales.slice(1).map((scale, i) => Math.abs(scale - scales[i])))
        assert.ok(evidence.maxScaleStep < .07, '正式关键帧曲线无缩放跳变')
        const manual = { ...curves.scale[2], value: Number(curves.scale[2].value) + .02 }
        await set(clipRef, { 'video_edit.clip.scale.keyframes': curves.scale.map((value, i) => i === 2 ? manual : value) })
        const regenerated = await callTool(client, 'generate_video_edit_screen_attention', operationEnvelope([await read(clipRef, ['video_edit.clip.scale.keyframes'])], { documentRef, clipRef, settings: { strength: 'light' } }))
        assert.equal(regenerated.executionState, 'completed', JSON.stringify(regenerated))
        const savedManual = readVideoEditFile(seeded.file).sequences[0].clips[0].curves.scale.find(value => value.time === manual.time)
        assert.equal(savedManual.value, manual.value); assert.equal(savedManual.source, undefined); evidence.manualPreserved = true
      } finally { await client?.close(); await disableMcp(page); fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2)) }
      await leaveVideoEditProject(page)
    } }
}
module.exports = { createScreenAttentionScene }
