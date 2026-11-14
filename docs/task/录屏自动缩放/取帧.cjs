// 录屏自动缩放前后对比取帧：隔离资料目录里放一份用户那段录制（只复制，不碰真实资料），按原剪辑的片段与缩放区间建一份剪辑，
// 经正式接口逐帧取节目画面。用法（仓库根目录）：
//   HENJI_SKIP_BUILD_FRESHNESS=1 node docs/task/录屏自动缩放/取帧.cjs <构建产物目录> <输出目录> [帧号,帧号...]
// 构建产物目录用 electron-vite build --outDir 另建（正式实例占着 out/）。帧号可写 起-止 表示连续帧。
// ZOOM_MOTION_BLUR=0 关掉序列运动模糊；ZOOM_WIDTH 取帧宽度（默认 1920）；ZOOM_PLAY=起,止 改为完整分辨率播放这段两遍，输出播放统计（渲染耗时、跳帧）。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const root = process.cwd()
const [buildDir, outArg, framesArg] = process.argv.slice(2)
const out = path.resolve(outArg)
const SESSION_ID = '27d77643-7855-434e-a711-d65bd4a2484f'
const DATA = 'E:/文档/HenjiAI'
const SOURCE_DOC = path.join(DATA, 'Projects/未命名项目 1/未命名项目 1.hjvid')
const frames = (framesArg || '234,1228,3005,3891').split(',').flatMap(part => { const [a, b] = part.split('-').map(Number); return b === undefined ? [a] : Array.from({ length: b - a + 1 }, (_, i) => a + i) })
const { launchElectronApp, waitForApp } = require(path.join(root, 'scripts/lib/electronLaunch.cjs'))
const { assignIsolatedMcpPort, authorizeMcpConnection, connectMcpClient, callTool, operationEnvelope, readAllMedia, disableMcp } = require(path.join(root, 'scripts/lib/uiInspectionMcpClient.cjs'))
const { seedVideoEditProject } = require(path.join(root, 'scripts/lib/uiInspectionVideoEditDocuments.cjs'))

;(async () => {
  fs.mkdirSync(out, { recursive: true })
  const raw = JSON.parse(fs.readFileSync(SOURCE_DOC, 'utf8'))
  const content = structuredClone(raw.content)
  // 只留画面片段：麦克风与系统声音不影响缩放和光标。
  const sequence = content.sequences[0]
  sequence.clips = sequence.clips.filter(clip => clip.kind === 'video')
  const keepItems = new Set(sequence.clips.map(clip => clip.itemId))
  content.items = content.items.filter(item => keepItems.has(item.id))
  const keepMedia = new Set(content.items.map(item => item.mediaId))
  // 复制件的修改时间到不了原件的亚毫秒精度，去掉原文件身份，免得被当成“源文件已改变”。
  content.media = content.media.filter(media => keepMedia.has(media.id)).map(({ assetContent: _assetContent, ...media }) => media)
  if (process.env.ZOOM_MOTION_BLUR === '0') sequence.motionBlur = false
  // ZOOM_REGIONS=缩放段对比.cjs 输出的 json：换成里面的缩放区间（比如新版自动生成的那一组）。
  if (process.env.ZOOM_REGIONS) {
    const regions = JSON.parse(fs.readFileSync(process.env.ZOOM_REGIONS, 'utf8')).regions
    for (const clip of sequence.clips) for (const effect of clip.effects ?? []) if (effect.builtin?.id === 'recording_zoom') effect.builtin.regions = regions
  }
  sequence.tracks = sequence.tracks.filter(track => track.kind === 'video' || sequence.clips.some(clip => clip.track === track.index))
  const session = await launchElectronApp({ mainEntry: path.join(root, buildDir, 'main/index.cjs'), cwd: root, useElectronApi: true, skipOnboarding: true, extraArgs: ['--background', '--enable-unsafe-webgpu'] })
  let client
  try {
    const page = session.page
    page.on('pageerror', error => console.error(error.stack))
    await waitForApp(page); await assignIsolatedMcpPort(page)
    const workRoot = await page.evaluate(async () => {
      const documents = window.henjiNative.documents
      const project = await documents.createProject({ name: '取帧占位' })
      return project.path
    }).then(projectPath => path.dirname(path.dirname(projectPath)))
    const target = path.join(workRoot, 'Uploads/screen-recordings', SESSION_ID)
    if (!fs.existsSync(target)) fs.cpSync(path.join(DATA, 'Uploads/screen-recordings', SESSION_ID), target, { recursive: true, preserveTimestamps: true })
    const seeded = await seedVideoEditProject(page, { id: null, name: '录屏缩放取帧', ...content })
    const identity = await authorizeMcpConnection(page, { name: '录屏缩放取帧' }); client = await connectMcpClient(identity.config, 'zoom frames')
    const invoke = (name, args) => callTool(client, name, args)
    const documentRef = { kind: 'video_edit.document', id: seeded.documentId }
    const sequenceRef = { kind: 'video_edit.sequence', id: `${seeded.documentId}:${sequence.id}` }
    if (process.env.ZOOM_PLAY) { fs.writeFileSync(path.join(out, 'playback.json'), JSON.stringify(await play(page, client, seeded, process.env.ZOOM_PLAY.split(',').map(Number)), null, 1)); return }
    await invoke('open_document', operationEnvelope([], { documentId: seeded.documentId }))
    for (const frame of frames) {
      const result = await invoke('observe_video_edit_frame', { documentRef, target: { kind: 'program', sequenceRef, frame }, maxWidth: Number(process.env.ZOOM_WIDTH || 1920), saveToAssets: true })
      const data = result.data; assert.ok(data?.verification?.verified, JSON.stringify(result).slice(0, 2000))
      const media = await readAllMedia(client, data.resultRef, { chunkBytes: 262144 })
      fs.writeFileSync(path.join(out, `f${String(frame).padStart(4, '0')}.png`), media.bytes); console.log('frame', frame)
    }
  } finally { await client?.close().catch(() => {}); await disableMcp(session.page).catch(() => {}); await session.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })

/** 照播放基准台（scripts/bench-video-edit.cjs）的做法：关自动预渲染、完整分辨率，预热一遍后正式播两遍，读回每遍的播放统计日志。 */
async function play(page, client, seeded, [from, to]) {
  const { openVideoEditProjectCard } = require(path.join(root, 'scripts/lib/uiInspectionVideoEditDocuments.cjs'))
  const { presented } = require(path.join(root, 'scripts/lib/uiInspectionSceneVideoEditMonitor.cjs'))
  const documentRef = { kind: 'video_edit.document', id: seeded.documentId }
  const change = async (entry, summary) => {
    const read = await callTool(client, 'read_application_entity', { ref: documentRef })
    const changed = await callTool(client, 'change_application_entities', operationEnvelope([read], { summary, changes: [entry] }))
    if (changed.executionState !== 'completed') throw new Error(`${summary}失败`)
  }
  await openVideoEditProjectCard(page, seeded.projectId)
  const set = (properties, summary) => change({ kind: 'set_properties', entityType: documentRef.kind, target: documentRef, properties }, summary)
  await set({ 'video_edit.document.render_preference': { autoRender: false } }, '关闭自动预渲染')
  await set({ 'video_edit.document.playback_resolution': { resolution: 'full', fullWhenPaused: true } }, '完整分辨率播放')
  const runs = []
  for (let round = 0; round < 3; round++) {
    await set({ 'video_edit.document.program_playback': { frame: from, playing: false, playbackDirection: 1 } }, '定位'); await presented(page, from)
    await page.waitForTimeout(1500)
    const after = new Date().toISOString()
    await set({ 'video_edit.document.program_playback': { frame: from, playing: true, playbackDirection: 1 } }, '起播')
    await page.waitForFunction(last => Number(document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame) >= last, to - 1, { timeout: 180000, polling: 250 })
    await set({ 'video_edit.document.program_playback': { frame: to - 1, playing: false, playbackDirection: 1 } }, '停')
    let stats
    for (let attempt = 0; attempt < 50 && !stats; attempt++) {
      if (attempt) await page.waitForTimeout(200)
      const events = await page.evaluate(async after => (await window.henjiNative.logging.queryLogEvents({ date: after.slice(0, 10), afterTimestamp: after, keyword: 'video_edit.playback.stats', level: 'info', limit: 20 })).events, after)
      stats = events.filter(event => event.event === 'video_edit.playback.stats').sort((a, b) => b.context.expectedFrames - a.context.expectedFrames)[0]?.context
    }
    if (round) runs.push(stats); console.log('round', round, JSON.stringify(stats).slice(0, 400))
  }
  return runs
}
