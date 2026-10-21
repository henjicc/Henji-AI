const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, expectToolRefusal, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { openVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')

/**
 * 音频重构（PR“重新混合”）在真实 Electron 里的正式链路：
 * - 隔离资料目录首次重构时自动下载节拍模型（自有 ModelScope 或 Hugging Face，按清单校验），本地推理后台进程跑 Beat This!；
 * - 经 MCP 调用 remix_video_edit_music 缩短与加长，读回子片段首尾相接、总长等于目标帧数，再按 WAV 正式导出供试听；
 * - 自由节奏素材被拒绝且剪辑不变；右键菜单有“重构到时长…”并打开弹窗。
 * 默认素材由 FFmpeg 合成（稳定 120 BPM 鼓组分段 + 速度起伏的自由节奏）；设置 HENJI_REMIX_MUSIC="名字=路径;…" 时改用真实歌曲，
 * HENJI_REMIX_OUTPUT 指定试听文件另存目录。
 */
const ROOT = path.resolve('node_modules/.cache/video-edit-music-remix')
const FPS = 30
const RATIOS = [0.6, 1.6]

function synthesize(file, expression, seconds) {
  const { ffmpegPath } = require('./mediaBinaries.cjs')
  if (!fs.existsSync(file)) execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc='${expression}':s=44100:d=${seconds}`, '-ac', '2', '-c:a', 'pcm_s16le', file], { windowsHide: true, timeout: 120000 })
  return file
}

function songs() {
  fs.mkdirSync(ROOT, { recursive: true })
  const list = []
  if (process.env.HENJI_REMIX_MUSIC) {
    for (const entry of process.env.HENJI_REMIX_MUSIC.split(';').filter(Boolean)) {
      const [name, source] = entry.split('=')
      const target = path.join(ROOT, `${name}${path.extname(source)}`)
      if (!fs.existsSync(target)) fs.copyFileSync(source, target)
      list.push({ name, path: target, free: /自由|free/i.test(name) })
    }
  } else {
    // 8 小节一段、A/B 两种音色交替；每拍底鼓，二四拍军鼓噪声。
    list.push({ name: 'steady', path: synthesize(path.join(ROOT, 'steady.wav'), '0.7*sin(2*PI*55*t)*exp(-18*mod(t,0.5))+0.3*(random(0)-0.5)*exp(-30*mod(t-0.5,1))*gte(mod(t,1),0.5)+0.08*sin(2*PI*(220+110*mod(floor(t/16),2))*t)', 96), free: false })
    // 拍距在 0.35–0.85 秒之间连续起伏。
    list.push({ name: 'free', path: synthesize(path.join(ROOT, 'free.wav'), '0.7*sin(2*PI*65*t)*exp(-14*mod(t+0.3*sin(t/3),0.6))+0.06*sin(2*PI*262*t)', 60), free: true })
  }
  return list
}

/** 每首歌一个项目（导出取当前序列），一条序列、一条音频片段铺满整首。 */
function project(song, index) {
  const probe = file => Number(JSON.parse(execFileSync(require('./mediaBinaries.cjs').ffprobePath, ['-v', 'error', '-show_format', '-of', 'json', file], { encoding: 'utf8', windowsHide: true })).format.duration)
  const value = { format: 'henji-video-project', version: 5, id: `reality-music-remix-${index}`, name: `音频重构验收 ${song.name}`, revision: 0, media: [], bins: [], items: [], sequences: [] }
  {
    const seconds = probe(song.path)
    song.seconds = seconds
    value.media.push({ id: `song-${index}`, name: song.name, path: song.path, kind: 'audio', width: 0, height: 0, durationSeconds: seconds, hasAudio: true })
    value.items.push({ id: `song-item-${index}`, name: song.name, kind: 'audio', mediaId: `song-${index}` })
    value.sequences.push({ id: `song-sequence-${index}`, name: song.name, width: 1280, height: 720, frameRate: { numerator: FPS, denominator: 1 }, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2,
      tracks: [{ id: `v-${index}`, name: '视频 1', index: 1, kind: 'video', locked: false, enabled: true, muted: false, solo: false }, { id: `a-${index}`, name: '音频 1', index: 0, kind: 'audio', locked: false, enabled: true, muted: false, solo: false }],
      clips: [{ id: `song-clip-${index}`, itemId: `song-item-${index}`, name: song.name, kind: 'audio', track: 0, start: 0, duration: Math.floor(seconds * FPS), sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' }],
      annotations: [] })
  }
  const file = path.join(ROOT, `music-remix-${index}.henji-video`); fs.writeFileSync(file, JSON.stringify(value))
  return { file, value }
}

async function exportWav(page, client, documentRef, frames, output) {
  const baseline = await callTool(client, 'read_application_entity', { ref: documentRef })
  const exported = await callTool(client, 'export_video_edit', operationEnvelope([baseline], { documentRef, range: { startFrame: 0, endFrame: frames }, settings: { format: 'wav', width: 1280, height: 720, fps: null, videoBitrateMbps: 12, audioBitrateKbps: 192, fit: 'fit', loudness: null, videoEnabled: false, audioEnabled: true, audioCodec: 'wav', addToLibrary: false } }))
  const jobId = (exported.data ?? exported.result?.data)?.queue?.[0]?.id; assert.ok(jobId, JSON.stringify(exported))
  let job
  for (let attempt = 0; attempt < 600; attempt++) {
    job = (await callTool(client, 'query_video_edit_export', { documentRef, taskId: jobId, detail: 'full' })).data.queue.find(value => value.id === jobId)
    if (job && ['completed', 'failed', 'cancelled'].includes(job.state)) break
    await page.waitForTimeout(500)
  }
  assert.equal(job?.state, 'completed', JSON.stringify(job))
  fs.copyFileSync(job.path, output)
  // 导出完成弹窗是正式界面的一部分；关掉它再做下一步。
  const done = page.getByRole('dialog').getByRole('button', { name: '完成', exact: true })
  if (await done.isVisible().catch(() => false)) await done.click()
  const stream = JSON.parse(execFileSync(require('./mediaBinaries.cjs').ffprobePath, ['-v', 'error', '-show_streams', '-of', 'json', output], { encoding: 'utf8', windowsHide: true })).streams[0]
  return { path: output, seconds: Number(stream.duration), sampleRate: Number(stream.sample_rate) }
}

function createVideoEditMusicRemixScene() {
  return {
    id: 'video-edit-music-remix', surface: '剪辑', name: '剪辑-音频重构到时长（节拍模型下载、分析、拼接、导出与拒绝）', writesUserData: true,
    setup: async (page, app, { capture }) => {
      assert.ok(await app.evaluate(() => Boolean(process.env.HENJI_ISOLATED_APP_DATA)), '音频重构验收必须使用隔离资料目录')
      const list = songs()
      const outputDir = process.env.HENJI_REMIX_OUTPUT ?? ROOT
      fs.mkdirSync(outputDir, { recursive: true })
      const evidence = { songs: [], completed: false }
      const store = () => fs.writeFileSync(path.join(ROOT, 'evidence.json'), JSON.stringify(evidence, null, 2))
      let client
      try {
        await page.evaluate(dir => window.henjiNative.media.allowRoot(dir), ROOT)
        await page.getByRole('button', { name: '剪辑', exact: true }).click()
        if (await page.getByRole('button', { name: '关闭项目', exact: true }).isVisible()) await page.getByRole('button', { name: '关闭项目', exact: true }).click()
        const identity = await authorizeMcpConnection(page, { name: '音频重构验收', allowWrites: true, allowDestructive: true })
        client = await connectMcpClient(identity.config, 'Henji music remix Reality')
        for (const [index, song] of list.entries()) {
          const { file, value } = project(song, index)
          const seeded = await openVideoEditFile(page, file)
          const documentRef = { kind: 'video_edit.document', id: seeded.documentId }
          const record = { name: song.name, seconds: song.seconds, runs: [] }; evidence.songs.push(record); store()
          const sequenceRef = { kind: 'video_edit.sequence', id: `${seeded.documentId}:${value.sequences[0].id}` }
          const clipRef = { kind: 'video_edit.clip', id: `${seeded.documentId}:song-clip-${index}` }
          if (song.free) {
            const baseline = await callTool(client, 'read_application_entity', { ref: documentRef })
            const started = performance.now()
            record.refusal = await expectToolRefusal(client, 'remix_video_edit_music', operationEnvelope([baseline], { documentRef, sequenceRef, clipRef, target: { kind: 'seconds', seconds: Math.round(song.seconds * 0.6) } }))
            record.refusalMs = Math.round(performance.now() - started)
            assert.match(record.refusal, /自由|节拍/, record.refusal)
            // 拒绝后原片段原样还在。
            record.clipKeptAfterRefusal = Boolean(await callTool(client, 'read_application_entity', { ref: clipRef }))
            store(); continue
          }
          for (const ratio of RATIOS) {
            const baseline = await callTool(client, 'read_application_entity', { ref: documentRef })
            const started = performance.now()
            const raw = await callTool(client, 'remix_video_edit_music', operationEnvelope([baseline], { documentRef, sequenceRef, clipRef, target: { kind: 'seconds', seconds: Math.round(song.seconds * ratio * 10) / 10 }, granularity: 'bar', repetition: 0.5 }))
            const result = raw.data ?? raw.result?.data ?? raw.result ?? raw
            assert.ok(result?.targetFrames, JSON.stringify(raw).slice(0, 2000))
            const run = { ratio, elapsedMs: Math.round(performance.now() - started), targetFrames: result.targetFrames, segments: result.resultRefs.length, seams: result.seams, trimmedSeconds: result.trimmedSeconds, analysis: result.analysis, verified: result.verification.verified }
            record.runs.push(run); store()
            assert.equal(result.verification.verified, true, JSON.stringify(result))
            assert.equal(result.analysis.beatSource, 'beat_this', '节拍模型应已下载并使用')
            run.export = await exportWav(page, client, documentRef, result.targetFrames, path.join(outputDir, `${song.name}_${ratio < 1 ? '缩短' : '加长'}_${ratio}x_应用导出.wav`))
            assert.ok(Math.abs(run.export.seconds - result.targetFrames / FPS) < 0.05, `导出时长 ${run.export.seconds} 应等于目标 ${result.targetFrames / FPS}`)
            store()
            await callTool(client, 'undo_video_edit', operationEnvelope([await callTool(client, 'read_application_entity', { ref: documentRef })], { documentRef }))
            // 撤销后立即保存，换下一首时关闭项目不弹“保存修改”确认。
            await callTool(client, 'save_video_edit', operationEnvelope([await callTool(client, 'read_application_entity', { ref: documentRef })], { documentRef }))
          }
        }
        // 界面入口：右键音频片段出现“重构到时长…”，打开弹窗后取消。
        const clip = page.locator('[data-video-edit-clip]').first()
        if (await clip.count()) {
          await clip.click({ button: 'right' })
          await page.getByRole('menuitem', { name: '重构到时长…' }).or(page.getByRole('button', { name: '重构到时长…' })).first().click()
          const dialog = page.getByRole('dialog').filter({ hasText: '切分粒度' })
          await dialog.waitFor({ state: 'visible', timeout: 10000 })
          for (const text of ['目标时长', '重复程度', '切分粒度']) assert.ok(await dialog.getByText(text, { exact: true }).isVisible(), `弹窗缺少“${text}”`)
          await capture('music-remix-dialog')
          await page.screenshot({ path: path.join(ROOT, 'music-remix-dialog.png') })
          await page.getByRole('button', { name: '取消', exact: true }).click()
          evidence.dialog = true
        }
        evidence.completed = true; store()
      } finally {
        if (!evidence.completed) { await page.screenshot({ path: path.join(ROOT, 'failure.png') }).catch(() => undefined); evidence.dialogs = await page.locator('[role="dialog"]').allInnerTexts().catch(() => []) }
        store(); await client?.close(); await disableMcp(page)
      }
    },
  }
}

module.exports = { createVideoEditMusicRemixScene }
