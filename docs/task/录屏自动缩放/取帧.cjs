// 录屏自动缩放前后对比取帧：隔离资料目录里放一份用户那段录制（只复制，不碰真实资料），按原剪辑的片段与缩放区间建一份剪辑，
// 经正式接口逐帧取节目画面。用法（仓库根目录）：
//   HENJI_SKIP_BUILD_FRESHNESS=1 node docs/task/录屏自动缩放/取帧.cjs <构建产物目录> <输出目录> [帧号,帧号...]
// 构建产物目录用 electron-vite build --outDir 另建（正式实例占着 out/）。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const root = process.cwd()
const [buildDir, outArg, framesArg] = process.argv.slice(2)
const out = path.resolve(outArg)
const SESSION_ID = '27d77643-7855-434e-a711-d65bd4a2484f'
const DATA = 'E:/文档/HenjiAI'
const SOURCE_DOC = path.join(DATA, 'Projects/未命名项目 1/未命名项目 1.hjvid')
const frames = (framesArg || '234,1228,3005,3891').split(',').map(Number)
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
    await invoke('open_document', operationEnvelope([], { documentId: seeded.documentId }))
    for (const frame of frames) {
      const result = await invoke('observe_video_edit_frame', { documentRef, target: { kind: 'program', sequenceRef, frame }, maxWidth: 1920, saveToAssets: true })
      const data = result.data; assert.ok(data?.verification?.verified, JSON.stringify(result).slice(0, 2000))
      const media = await readAllMedia(client, data.resultRef, { chunkBytes: 262144 })
      fs.writeFileSync(path.join(out, `f${String(frame).padStart(4, '0')}.png`), media.bytes); console.log('frame', frame)
    }
  } finally { await client?.close().catch(() => {}); await disableMcp(session.page).catch(() => {}); await session.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
