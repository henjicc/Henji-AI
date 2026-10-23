const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { videoEditFixtureProject } = require('./uiInspectionSceneVideoEditProbe.cjs')
const { seedVideoEditProject, openVideoEditProjectCard, readVideoEditFile, leaveVideoEditProject } = require('./uiInspectionVideoEditDocuments.cjs')
const { assignIsolatedMcpPort, authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')

function createRecordingCursorScene() {
  return { id: 'recording-cursor', surface: '剪辑', name: '录制光标-切分移动变速与点击像素', writesUserData: true,
    setup: async (page) => {
      const root = path.resolve('node_modules/.cache/recording-cursor'); fs.mkdirSync(root, { recursive: true })
      const source = path.join(root, 'screen.mp4')
      execFileSync(require('./mediaBinaries.cjs').ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:size=1920x1080:rate=60', '-t', '4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', source], { windowsHide: true })
      const log = await require('../check-persistence-compat.cjs').loadTypeScript('src/tests/recordingCursorFixture.ts').recordingCursorFixture()
      log.source.pages = log.source.pages.map((ref, index) => {
        const file = path.join(root, `page-${index}.capture.json`); fs.writeFileSync(file, log.bytes.get(ref.path)); return { ...ref, path: file }
      })
      const effect = { id: 'cursor-effect', name: '录制光标', enabled: true, amount: 1, builtin: { id: 'recording_cursor', params: { size: 6, smoothing: 0, click_style: 'highlight' } } }
      const clip = { id: 'screen-clip', mediaId: 'screen', name: '屏幕原片', kind: 'video', track: 1, start: 0, duration: 240, sourceInUs: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '', effects: [effect] }
      const fixture = videoEditFixtureProject({ id: 'recording-cursor', name: '录制光标验收', revision: 0, width: 1920, height: 1080, fps: 60,
        media: [{ id: 'screen', name: '屏幕原片', path: source, kind: 'video', durationSeconds: 4, width: 1920, height: 1080, hasAudio: false, recordingCursor: log.source }], clips: [clip], annotations: [] })
      const seeded = await seedVideoEditProject(page, fixture)
      await openVideoEditProjectCard(page, seeded.projectId)
      let client
      const evidence = {}
      try {
        await assignIsolatedMcpPort(page)
        const auth = await authorizeMcpConnection(page, { name: '录制光标免费验收', allowWrites: true, allowDestructive: true })
        client = await connectMcpClient(auth.config)
        const documentRef = { kind: 'video_edit.document', id: seeded.documentId }
        const read = (ref, propertyIds) => callTool(client, 'read_application_entity', { ref, propertyIds })
        const set = async (ref, properties) => {
          const result = await callTool(client, 'change_application_entities', operationEnvelope([await read(ref, Object.keys(properties))], { summary: '核对录制光标同步', changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties }] }))
          assert.equal(result.executionState, 'completed', JSON.stringify(result))
        }
        const seek = async frame => {
          await set(documentRef, { 'video_edit.document.program_playback': { frame, playing: false, playbackDirection: 1 } })
          await page.waitForFunction(frame => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === String(frame), frame, { timeout: 30000 })
        }
        const canvas = page.locator('canvas[aria-label="剪辑画面"]')
        const snapshot = () => canvas.evaluate(value => value.toDataURL('image/png'))
        await seek(60); const before = await snapshot()
        fs.writeFileSync(path.join(root, 'cursor-click.png'), Buffer.from(before.split(',')[1], 'base64'))
        // Pixel checks use the actual program canvas, before and after the public editing operations.
        const { PNG } = require('pngjs'); const pixels = PNG.sync.read(Buffer.from(before.split(',')[1], 'base64'))
        let whites = 0; let blues = 0
        for (let i = 0; i < pixels.data.length; i += 4) {
          if (pixels.data[i] > 200 && pixels.data[i + 1] > 200 && pixels.data[i + 2] > 200) whites++
          if (pixels.data[i + 2] > pixels.data[i] + 30) blues++
        }
        assert.ok(whites > 5 && blues > 5, `光标/点击必须出现在真实节目画面：${whites}/${blues}`)
        evidence.pixels = { whites, blues, width: pixels.width, height: pixels.height }
        const split = await callTool(client, 'split_video_edit', operationEnvelope([await read(documentRef, ['video_edit.document.name'])], { documentRef, clipRef: { kind: 'video_edit.clip', id: `${seeded.documentId}:screen-clip` }, frame: 30 }))
        assert.equal(split.executionState, 'completed', JSON.stringify(split))
        const tail = readVideoEditFile(seeded.file).sequences[0].clips.find(value => value.start === 30)
        assert.ok(tail); assert.equal(tail.sourceInUs, 500000)
        const tailRef = { kind: 'video_edit.clip', id: `${seeded.documentId}:${tail.id}` }
        await set(tailRef, { 'video_edit.clip.start': 120, 'video_edit.clip.speed_percent': 200 })
        await seek(135)
        assert.equal(await snapshot(), before, '剪切、移动及200%变速后，同源时刻的光标和点击必须逐像素一致')
        evidence.splitMoveSpeed = true
        await set(tailRef, { 'video_edit.clip.scale': 2, 'video_edit.clip.x': 0.35, 'video_edit.clip.y': 0.22 })
        await seek(136); evidence.zoom = (await snapshot()) !== before; assert.ok(evidence.zoom)
        const mode = await read({ kind: 'video_edit.media', id: `${seeded.documentId}:screen` }, ['video_edit.media.recording_cursor_mode'])
        assert.equal(mode.data.properties['video_edit.media.recording_cursor_mode'], 'redraw')
        evidence.mode = 'redraw'
        await canvas.screenshot({ path: path.join(root, 'zoom.png') })
      } finally { await client?.close(); await disableMcp(page); fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2)) }
      await leaveVideoEditProject(page)
    } }
}
module.exports = { createRecordingCursorScene }
