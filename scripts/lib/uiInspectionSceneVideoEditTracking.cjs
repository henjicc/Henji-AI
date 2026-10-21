const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { videoEditFixtureProject } = require('./uiInspectionSceneVideoEditProbe.cjs')
const { seedVideoEditProject, openVideoEditProjectCard, readVideoEditFile, leaveVideoEditProject } = require('./uiInspectionVideoEditDocuments.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')

/*
 * 跟踪与防抖真实验收：真实后台跟踪进程（OpenCV 两点 LK、相机运动）、渲染 Worker 的 HiGHS 平滑路径与节目画面像素。
 * - 两点跟踪：画面匀速旋转，绿色标注条跟随旋转与缩放，取节目画面里标注条的主轴角度核对；
 * - 防抖：同一段抖动素材开关防抖，比较相邻帧差，并存前后对比截图；
 * - 录屏光标：光标事件跟踪，标注条随光标横移，核对横向位移。
 */
const ROTATION_PER_SECOND = 0.3

function media(root) {
  const ffmpeg = require('./mediaBinaries.cjs').ffmpegPath
  const run = args => execFileSync(ffmpeg, ['-v', 'error', '-y', ...args], { windowsHide: true })
  const photo = name => path.resolve('tests/fixtures/image-inpainting', `${name}.png`)
  const files = { rotate: path.join(root, 'rotate.mp4'), shaky: path.join(root, 'shaky.mp4'), screen: path.join(root, 'screen.mp4'), bar: path.join(root, 'bar.png') }
  run(['-loop', '1', '-i', photo('astronaut'), '-vf', `scale=1280:720,rotate=a='t*${ROTATION_PER_SECOND}':c=black,format=yuv420p`, '-t', '3', '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', files.rotate])
  run(['-loop', '1', '-i', photo('astronaut'), '-loop', '1', '-i', photo('hair-edge-original'), '-loop', '1', '-i', photo('face-scratch-original'), '-filter_complex',
    "[0][1][2]hstack=3,scale=2880:960,crop=1280:720:x='800+40*sin(n*1.7)+25*sin(n*3.1)':y='120+30*cos(n*2.3)+15*sin(n*4.7)',format=yuv420p", '-t', '3', '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', files.shaky])
  run(['-f', 'lavfi', '-i', 'color=c=gray:size=1920x1080:rate=30', '-t', '4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', files.screen])
  run(['-f', 'lavfi', '-i', 'color=c=0x00FF00:size=300x60', '-frames:v', '1', files.bar])
  return files
}

/** 节目画面里纯绿标注条（素材里没有这种颜色）的重心与主轴角度（度，顺时针为正）。 */
function redBlob(png) {
  let n = 0; let sx = 0; let sy = 0; let sxx = 0; let syy = 0; let sxy = 0
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const i = (y * png.width + x) * 4
    if (png.data[i + 1] > 200 && png.data[i] < 80 && png.data[i + 2] < 80) { n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y }
  }
  assert.ok(n > 200, `节目画面里应看到跟随的绿色标注条：${n} 像素`)
  const cx = sx / n; const cy = sy / n
  const mxx = sxx / n - cx * cx; const myy = syy / n - cy * cy; const mxy = sxy / n - cx * cy
  return { n, x: cx / png.width, y: cy / png.height, angle: 0.5 * Math.atan2(2 * mxy, mxx - myy) * 180 / Math.PI }
}

function createVideoEditTrackingScene() {
  return { id: 'video-edit-tracking-stabilize', surface: '剪辑', name: '跟踪与防抖-两点旋转跟随录屏光标跟随与防抖对比', writesUserData: true,
    setup: async (page) => {
      const root = path.resolve('node_modules/.cache/video-edit-tracking'); fs.mkdirSync(root, { recursive: true })
      const files = media(root)
      const log = await require('../check-persistence-compat.cjs').loadTypeScript('src/tests/recordingCursorFixture.ts').recordingCursorFixture()
      log.source.pages = log.source.pages.map((ref, index) => {
        const file = path.join(root, `page-${index}.capture.json`); fs.writeFileSync(file, log.bytes.get(ref.path)); return { ...ref, path: file }
      })
      const base = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '', sourceInUs: 0 }
      const bar = { ...base, kind: 'image', mediaId: 'bar', scale: 0.15, track: 2 }
      const fixture = videoEditFixtureProject({ id: 'tracking-stabilize', name: '跟踪与防抖验收', revision: 0, width: 1280, height: 720, fps: 30,
        media: [
          { id: 'rotate', name: '旋转镜头', path: files.rotate, kind: 'video', durationSeconds: 3, width: 1280, height: 720, hasAudio: false },
          { id: 'shaky', name: '手持抖动', path: files.shaky, kind: 'video', durationSeconds: 3, width: 1280, height: 720, hasAudio: false },
          { id: 'screen', name: '屏幕原片', path: files.screen, kind: 'video', durationSeconds: 4, width: 1920, height: 1080, hasAudio: false, recordingCursor: log.source },
          { id: 'bar', name: '标注条', path: files.bar, kind: 'image', durationSeconds: 0, width: 300, height: 60 },
        ],
        clips: [
          { ...base, id: 'rotate-clip', mediaId: 'rotate', name: '旋转镜头', kind: 'video', track: 1, start: 0, duration: 90 },
          { ...bar, id: 'rotate-bar', name: '旋转标注', start: 0, duration: 90, x: 0.18, y: -0.1 },
          { ...base, id: 'shaky-clip', mediaId: 'shaky', name: '手持抖动', kind: 'video', track: 1, start: 90, duration: 90 },
          { ...base, id: 'screen-clip', mediaId: 'screen', name: '屏幕原片', kind: 'video', track: 1, start: 180, duration: 120 },
          { ...bar, id: 'cursor-bar', name: '光标标注', start: 180, duration: 120, x: -0.3, y: 0.1 },
        ], annotations: [] })
      const seeded = await seedVideoEditProject(page, fixture)
      await openVideoEditProjectCard(page, seeded.projectId)
      let client
      const evidence = {}
      try {
        const auth = await authorizeMcpConnection(page, { name: '跟踪与防抖免费验收', allowWrites: true, allowDestructive: true })
        client = await connectMcpClient(auth.config)
        const documentRef = { kind: 'video_edit.document', id: seeded.documentId }
        const clipRef = id => ({ kind: 'video_edit.clip', id: `${seeded.documentId}:${id}` })
        const read = (ref, propertyIds) => callTool(client, 'read_application_entity', { ref, propertyIds })
        const call = async (name, input) => {
          const result = await callTool(client, name, operationEnvelope([await read(documentRef, ['video_edit.document.name'])], input))
          assert.equal(result.executionState, 'completed', `${name}: ${JSON.stringify(result)}`)
          return result
        }
        const set = async (ref, properties) => {
          const result = await callTool(client, 'change_application_entities', operationEnvelope([await read(ref, Object.keys(properties))], { summary: '跟踪与防抖验收', changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties }] }))
          assert.equal(result.executionState, 'completed', JSON.stringify(result))
        }
        const canvas = page.locator('canvas[aria-label="剪辑画面"]')
        const seek = async frame => {
          await set(documentRef, { 'video_edit.document.program_playback': { frame, playing: false, playbackDirection: 1 } })
          await page.waitForFunction(frame => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame === String(frame), frame, { timeout: 60000 })
        }
        const { PNG } = require('pngjs')
        const snapshot = async (frame, file) => {
          await seek(frame)
          const bytes = Buffer.from((await canvas.evaluate(value => value.toDataURL('image/png'))).split(',')[1], 'base64')
          if (file) fs.writeFileSync(path.join(root, file), bytes)
          return PNG.sync.read(bytes)
        }

        // 1. 两点跟踪：经通用事务建立，真实后台 OpenCV 跟满后，绿色标注条跟随旋转与缩放。
        const created = await callTool(client, 'change_application_entities', operationEnvelope([await read(clipRef('rotate-clip'), ['video_edit.clip.name'])], { summary: '两点跟踪', changes: [{ kind: 'create_items', entityType: 'video_edit.tracker', parent: clipRef('rotate-clip'),
          items: [{ properties: { 'video_edit.tracker.name': '两点', 'video_edit.tracker.method': 'point', 'video_edit.tracker.prompts': [{ timeUs: 0, points: [[0.336, 0.75, 1], [0.592, 0.70, 1]], window: { feature: 0.08, search: 0.25 } }] } }] }] }))
        assert.equal(created.executionState, 'completed', JSON.stringify(created))
        const trackerId = readVideoEditFile(seeded.file).sequences[0].clips.find(clip => clip.id === 'rotate-clip').trackers[0].id
        const trackerRef = { kind: 'video_edit.tracker', id: `${seeded.documentId}:tracker:${'rotate-clip'.length}:rotate-clip${trackerId}` }
        await call('follow_video_edit_tracker', { documentRef, clipRef: clipRef('rotate-bar'), trackerRef, follow: { rotation: true, scale: true }, frame: 0 })
        const follow = readVideoEditFile(seeded.file).sequences[0].clips.find(clip => clip.id === 'rotate-bar').follow
        assert.ok(follow?.motion?.rotation !== undefined && follow.motion.size > 0, JSON.stringify(follow))
        const angles = {}
        for (const frame of [0, 45, 87]) angles[frame] = redBlob(await snapshot(frame, `two-point-${frame}.png`)).angle
        const expected = frame => frame / 30 * ROTATION_PER_SECOND * 180 / Math.PI
        evidence.twoPoint = { angles, expected: { 45: expected(45), 87: expected(87) } }
        for (const frame of [45, 87]) assert.ok(Math.abs(angles[frame] - angles[0] - expected(frame)) < 4, `两点跟随旋转：第 ${frame} 帧 ${angles[frame] - angles[0]}°，应约 ${expected(frame)}°`)

        // 2. 防抖：算法能力写参数并等待真实相机运动分析，比较开关防抖时的相邻帧差，存前后截图。
        const stabilized = await call('stabilize_video_edit_clip', { documentRef, clipRef: clipRef('shaky-clip'), smoothness: 'locked', maxCrop: 0.15 })
        const find = (value, key) => value && typeof value === 'object' ? key in value ? value : Object.values(value).map(child => find(child, key)).find(Boolean) : undefined
        const output = find(stabilized, 'crop')
        assert.ok(output && output.crop > 0 && output.crop <= 0.15, `防抖应返回不超过上限的实际裁切：${JSON.stringify(stabilized)}`)
        const crop = output.crop
        evidence.stabilize = { result: { crop: output.crop, analyzedFrames: output.analyzedFrames, message: output.message } }
        const difference = (a, b) => { let sum = 0; for (let i = 0; i < a.data.length; i += 16) sum += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]); return sum / (a.data.length / 16) }
        const sweep = async (label) => { const shots = []; for (let frame = 120; frame <= 132; frame += 3) shots.push(await snapshot(frame, frame === 126 ? `${label}-126.png` : undefined)); return shots.slice(1).reduce((s, shot, i) => s + difference(shots[i], shot), 0) / (shots.length - 1) }
        const steady = await sweep('stabilized')
        await set(clipRef('shaky-clip'), { 'video_edit.clip.stabilization': null })
        const raw = await sweep('original')
        assert.ok(steady < raw * 0.6, `防抖后相邻帧差应明显减小：${steady} / ${raw}`)
        evidence.stabilize.frameDifference = { stabilized: steady, original: raw, crop }

        // 3. 录屏光标：事件跟踪，绿色标注条随光标横移（光标 x = 100 + 录制时间/10000 像素，录制画面 1920 宽）。
        const recorded = await call('track_video_edit_recording', { documentRef, clipRef: clipRef('screen-clip'), target: 'cursor', frame: 180 })
        const cursorTracker = readVideoEditFile(seeded.file).sequences[0].clips.find(clip => clip.id === 'screen-clip').trackers.find(entry => entry.recording?.kind === 'cursor')
        assert.ok(cursorTracker, JSON.stringify(recorded))
        await call('follow_video_edit_tracker', { documentRef, clipRef: clipRef('cursor-bar'), trackerRef: { kind: 'video_edit.tracker', id: `${seeded.documentId}:tracker:${'screen-clip'.length}:screen-clip${cursorTracker.id}` }, frame: 180 })
        const early = redBlob(await snapshot(200, 'cursor-200.png')); const late = redBlob(await snapshot(280, 'cursor-280.png'))
        const cursorDelta = ((100 + (280 - 180) / 30 * 1e6 / 10000) - (100 + (200 - 180) / 30 * 1e6 / 10000)) / 1920
        assert.ok(Math.abs((late.x - early.x) - cursorDelta) < 0.004, `标注条横移 ${late.x - early.x}，光标横移 ${cursorDelta}`)
        assert.ok(Math.abs(late.y - early.y) < 0.004)
        evidence.cursor = { early, late, cursorDelta }
        // 4. 跟踪面板：重新打开防抖，面板读回实际裁切；截取面板供目视（防抖分组、录屏新建选项）。
        await set(clipRef('shaky-clip'), { 'video_edit.clip.stabilization': { smoothness: 'natural', maxCrop: 0.1, rotation: true, scale: true } })
        await page.getByRole('button', { name: '面板', exact: true }).click()
        await page.locator('button', { hasText: /^跟踪$/ }).first().click()
        await page.locator('[data-video-edit-clip="shaky-clip"]').first().click()
        const panel = page.locator('[data-video-edit-panel="tracking"]')
        await panel.getByText(/实际裁切/).waitFor({ timeout: 120000 })
        await panel.screenshot({ path: path.join(root, 'tracking-panel-stabilize.png') })
        await page.locator('[data-video-edit-clip="screen-clip"]').first().click()
        await panel.getByLabel('新建跟踪方式').click()
        await page.locator('button', { hasText: '录屏 · 光标' }).first().waitFor({ timeout: 10000 })
        await panel.screenshot({ path: path.join(root, 'tracking-panel-recording.png') })
        await page.keyboard.press('Escape')
        await canvas.screenshot({ path: path.join(root, 'program.png') })
      } finally { await client?.close(); await disableMcp(page); fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2)) }
      await leaveVideoEditProject(page)
    } }
}
module.exports = { createVideoEditTrackingScene }
