const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { dialogs, presented } = require('./uiInspectionSceneVideoEditMonitor.cjs')
const { videoEditFixtureProject } = require('./uiInspectionSceneVideoEditProbe.cjs')

/**
 * 原生解码故障回退（3.1）：在真实 Electron 中注入五类故障并核对用户看到的结果、回退与恢复、结构化日志。
 * - 崩溃：播放中结束原生服务进程（taskkill）。浏览器能解的 H.264 层当场改由后备解码，只有原生能解的 ProRes 层在
 *   重启的服务上重新打开会话；画面逐帧时间正确、播放继续；冷却后播放中的读取与新读取都回到原生（restored）。
 * - 超时：播放中挂起原生服务进程（NtSuspendProcess）。主进程心跳判定卡死、结束并重启，之后同上。
 * - 导入失败：在主进程把 `sharedTexture.importSharedTexture` 换成抛错（模拟显卡共享纹理导入失败）并重新加载预览（清空帧缓存）。H.264 层回退，
 *   ProRes 层就地提示、不画错帧；恢复导入后不需操作，自动重试出画并清除提示。
 * - 坏文件：截断的 ProRes 文件就地提示（用户语言），无画面；文件修复后自动重试出画。
 * - 缺失：主进程诊断变量指向不存在的服务可执行文件后结束服务进程（重启时找不到服务）。H.264 工程全程走后备解码且
 *   画面正确；ProRes 就地提示“格式当前无法播放”；恢复可执行文件后重新加载预览即回到原生。
 * 另含超预算：同时显示 11 个视频素材（每个渲染器最多 10 个原生会话）时就地提示且不崩溃。
 * 证据：`node_modules/.cache/video-edit-native-faults/evidence.json`。
 */
const ROOT = path.resolve('node_modules/.cache/video-edit-native-faults')
const FPS = 30
/** Each source file: 8s at 30fps. The fault project repeats it three times per track (24s of timeline). */
const FRAMES = 240
const REPEATS = 3
const button = (page, name) => page.getByRole('button', { name, exact: true })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function project(id, name, media, clips, extraTracks = 0) {
  const fixture = videoEditFixtureProject({ id, name, revision: 0, width: 1920, height: 1080, fps: FPS, media, clips, annotations: [] })
  const sequence = fixture.sequences[0]
  for (let index = 0; index < extraTracks; index++) sequence.tracks.push({ id: `${id}-track-x${index}`, name: `视频 ${8 + index}`, index: 8 + index, kind: 'video', locked: false, enabled: true, muted: false, solo: false })
  return fixture
}
const clip = (id, mediaId, track, extra = {}) => ({ id, mediaId, name: id, kind: 'video', track, start: 0, duration: FRAMES, sourceInUs: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, brightness: 1, text: '', ...extra })
/** The same file back to back on one track (cuts within one file, as in real edits). */
const repeated = (id, mediaId, track, extra = {}) => Array.from({ length: REPEATS }, (_, index) => clip(`${id}-${index}`, mediaId, track, { ...extra, start: index * FRAMES }))
const media = (id, file) => ({ id, name: path.basename(file), path: file, kind: 'video', durationSeconds: FRAMES / FPS, width: 1920, height: 1080, hasAudio: false, frameRate: { numerator: FPS, denominator: 1 }, frameRateMode: 'sampled-constant' })

async function logsSince(page, since) {
  return page.evaluate(async startedAt => (await window.henjiNative.logging.queryLogEvents({ date: startedAt.slice(0, 10), afterTimestamp: startedAt, limit: 2000 })).events.map(event => ({ at: event.timestamp, level: event.level, event: event.event, context: event.context ?? {} })), since)
}
async function waitLog(page, since, predicate, label, timeoutMs = 30000) {
  const started = Date.now()
  for (;;) {
    const found = (await logsSince(page, since)).find(predicate)
    if (found) return found
    if (Date.now() - started > timeoutMs) throw new Error(`等待日志超时：${label}`)
    await sleep(200)
  }
}
async function nativeStats(page) {
  return page.evaluate(() => window.henjiNative.videoFrames.stats().then(stats => ({ pid: stats.native?.pid ?? null, streams: stats.streams.length, unreleasedImports: stats.unreleasedImports, nativeStreams: stats.native?.streams.length ?? null, audioSessions: stats.native?.audioSessions ?? null })).catch(() => null))
}
/** The service process id, starting the service if needed (stats only answers while it runs). */
async function servicePid(page) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const stats = await nativeStats(page)
    if (stats?.pid) return stats.pid
    await sleep(100)
  }
  throw new Error('原生解码服务没有运行')
}
function processAlive(pid) {
  try { return execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8', windowsHide: true }).includes(String(pid)) } catch { return false }
}
function suspendProcess(pid) {
  const script = `$t = Add-Type -MemberDefinition '[DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h);' -Name Suspender -Namespace Faults -PassThru; $p = Get-Process -Id ${pid}; $t::NtSuspendProcess($p.Handle)`
  return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true }).trim()
}

/** Records every presented frame of the program monitor with its drawn source times. */
async function observe(page) {
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas[aria-label="剪辑画面"]')
    window.__faultFrames = []
    window.__faultPrompt = []
    window.__faultObserver?.disconnect()
    window.__faultObserver = new MutationObserver(() => window.__faultFrames.push({ at: performance.now(), wall: Date.now(), frame: Number(canvas.dataset.presentedFrame), timestamps: (canvas.dataset.sourceTimestamps || '').split(',').filter(Boolean).map(Number) }))
    window.__faultObserver.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame', 'data-source-timestamps'] })
    clearInterval(window.__faultPromptTimer)
    window.__faultPromptTimer = setInterval(() => { if (document.body.innerText.includes('节目画面无法显示')) window.__faultPrompt.push(Date.now()) }, 50)
  })
}
async function collect(page) {
  return page.evaluate(() => { window.__faultObserver?.disconnect(); clearInterval(window.__faultPromptTimer); return { frames: window.__faultFrames, prompts: window.__faultPrompt.length } })
}
/** Every presented frame shows each layer's exact picture: `layers` timestamps, each the frame's source time. */
function checkFrames(frames, layers, label) {
  const unique = frames.filter((value, index) => index === 0 || value.frame !== frames[index - 1].frame || value.timestamps.join() !== frames[index - 1].timestamps.join())
  for (const value of unique) {
    const expected = (value.frame % FRAMES) / FPS
    assert.equal(value.timestamps.length, layers, `${label}：第 ${value.frame} 帧画了 ${value.timestamps.length} 层（应为 ${layers}），出现空层`)
    for (const time of value.timestamps) assert.ok(Math.abs(time - expected) < 1e-5, `${label}：第 ${value.frame} 帧的源时间 ${time} 不是 ${expected}`)
  }
  const gaps = unique.slice(1).map((value, index) => value.at - unique[index].at)
  return { presented: unique.length, firstFrame: unique[0]?.frame ?? null, lastFrame: unique.at(-1)?.frame ?? null, maxGapMs: Math.round(Math.max(0, ...gaps)), backwards: unique.slice(1).filter((value, index) => value.frame < unique[index].frame).length }
}
async function promptText(page) {
  return page.evaluate(() => [...document.querySelectorAll('[role="alert"], [data-ui-error]')].map(node => node.textContent).join('\n') || (document.body.innerText.match(/节目画面无法显示[^\n]*\n?[^\n]*/) || [''])[0])
}
async function waitPrompt(page, includes, timeoutMs = 30000) {
  await page.waitForFunction(text => document.body.innerText.includes('节目画面无法显示') && document.body.innerText.includes(text), includes, { timeout: timeoutMs })
}
async function waitNoPrompt(page, timeoutMs = 30000) {
  await page.waitForFunction(() => !document.body.innerText.includes('节目画面无法显示'), null, { timeout: timeoutMs })
}
async function openProject(page, app, file) {
  if (await button(page, '关闭工程').isVisible().catch(() => false)) await button(page, '关闭工程').click()
  await dialogs(app, [file], file)
  await button(page, '打开工程').click()
}
/** Steps the paused program monitor `count` frames forward (each step is a single-frame read) and returns the frame. */
async function stepFrames(page, count) {
  const ruler = page.getByRole('slider', { name: '剪辑时间定位' })
  await ruler.focus()
  for (let index = 0; index < count; index++) await ruler.press('ArrowRight')
  return Number(await ruler.getAttribute('aria-valuenow'))
}

function createVideoEditNativeFaultsScene() {
  return {
    id: 'video-edit-native-faults', surface: '剪辑', name: '剪辑-原生解码五类故障的回退就地提示与恢复', writesUserData: true,
    // Injected on purpose (timeout phase): the heartbeat reports the hung service before ending it.
    expectedLogEvents: ['video_decoder.service.hung'],
    setup: async (page, app, { capture }) => {
      fs.rmSync(ROOT, { recursive: true, force: true }); fs.mkdirSync(ROOT, { recursive: true })
      const { ffmpegPath } = require('./mediaBinaries.cjs')
      const encode = (args, file) => execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=1920x1080:rate=${FPS}`, '-t', String(FRAMES / FPS), ...args, file], { windowsHide: true, timeout: 120000 })
      const h264 = path.join(ROOT, 'h264.mp4'); encode(['-c:v', 'libx264', '-preset', 'veryfast', '-g', '30', '-pix_fmt', 'yuv420p'], h264)
      const prores = path.join(ROOT, 'prores.mov'); encode(['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le'], prores)
      const broken = path.join(ROOT, 'broken.mov')
      // A damaged copy: the header cut off and the rest scrambled (a partial download or a failing disk).
      const bytes = fs.readFileSync(prores); const damaged = Buffer.from(bytes.subarray(0, Math.floor(bytes.length * 0.4))); for (let index = 0; index < 4096 && index < damaged.length; index++) damaged[index] ^= 0x5a
      fs.writeFileSync(broken, damaged)
      const faultFile = path.join(ROOT, 'faults.henji-video')
      fs.writeFileSync(faultFile, JSON.stringify(project('native-faults', '原生故障', [media('h264', h264), media('prores', prores)], [...repeated('base', 'h264', 1), ...repeated('overlay', 'prores', 2, { x: .25, y: .25, scale: .4 })])))
      const h264File = path.join(ROOT, 'h264-only.henji-video')
      fs.writeFileSync(h264File, JSON.stringify(project('native-faults-h264', '只有浏览器也能解的素材', [media('h264', h264)], [clip('base', 'h264', 1)])))
      const brokenFile = path.join(ROOT, 'broken.henji-video')
      fs.writeFileSync(brokenFile, JSON.stringify(project('native-faults-broken', '坏文件', [media('broken', broken)], [clip('broken-clip', 'broken', 1)])))
      const copies = Array.from({ length: 11 }, (_, index) => { const file = path.join(ROOT, `copy-${index}.mp4`); fs.copyFileSync(h264, file); return file })
      const budgetFile = path.join(ROOT, 'budget.henji-video')
      fs.writeFileSync(budgetFile, JSON.stringify(project('native-faults-budget', '同时显示 11 个视频', copies.map((file, index) => media(`copy-${index}`, file)), copies.map((_, index) => clip(`copy-clip-${index}`, `copy-${index}`, index + 1, { x: (index % 4) / 4 - .375, y: Math.floor(index / 4) / 3 - .33, scale: .24 })), 4)))

      const evidence = { startedAt: new Date().toISOString(), phases: {} }
      const store = () => fs.writeFileSync(path.join(ROOT, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const missingExecutable = path.join(ROOT, 'missing', 'henji-video-decoder.exe')
      try {
        await button(page, '剪辑').first().click()

        // ---- 崩溃：播放中结束服务进程 ----
        let since = new Date().toISOString()
        await openProject(page, app, faultFile); await presented(page, 0)
        const crashedPid = await servicePid(page)
        await observe(page)
        await button(page, '播放／暂停').click()
        await sleep(1500)
        const killedAt = Date.now()
        execFileSync('taskkill', ['/F', '/PID', String(crashedPid)], { windowsHide: true })
        await sleep(6000)
        await button(page, '播放／暂停').click()
        let observed = await collect(page)
        const crashLogs = await logsSince(page, since)
        const afterKill = observed.frames.filter(value => value.wall > killedAt)
        evidence.phases.crash = {
          killedPid: crashedPid, newPid: await servicePid(page), oldProcessAlive: processAlive(crashedPid),
          frames: checkFrames(observed.frames, 2, '崩溃'), framesAfterKill: checkFrames(afterKill, 2, '崩溃后'), promptPolls: observed.prompts,
          events: crashLogs.filter(entry => /video_decoder\.service\.(exited|ready|restart_scheduled)|video_edit\.decode\.native\.(fallback|retry|restored)/.test(entry.event)).map(entry => ({ event: entry.event, mediaId: entry.context.mediaId, code: entry.context.code, reason: entry.context.reason })),
        }
        store()
        assert.notEqual(evidence.phases.crash.newPid, crashedPid); assert.equal(evidence.phases.crash.oldProcessAlive, false)
        assert.ok(afterKill.length > 30, `结束服务进程后播放没有继续（之后只呈现 ${afterKill.length} 次）`)
        assert.ok(crashLogs.some(entry => entry.event === 'video_decoder.service.exited'), '缺少服务退出日志')
        assert.ok(crashLogs.some(entry => entry.event === 'video_edit.decode.native.fallback' && entry.context.mediaId === 'h264'), 'H.264 层没有回退到后备解码')
        assert.ok(crashLogs.some(entry => entry.event === 'video_edit.decode.native.retry' && entry.context.mediaId === 'prores'), 'ProRes 层没有在重启的服务上重试')
        assert.equal(await page.getByText('节目画面无法显示').count(), 0, '崩溃恢复后仍有就地提示')
        // After the cool-down, new reads of the H.264 file return to native.
        // After the cool-down the reader still playing on the fallback, and new reads, return to native. (Paused frames the
        // fallback already decoded come from the frame cache without a read, so step until one needs a read.)
        const isRestored = entry => entry.event === 'video_edit.decode.native.restored' && entry.context.mediaId === 'h264'
        for (let step = 0; step < 45 && !(await logsSince(page, since)).some(isRestored); step++) await presented(page, await stepFrames(page, 1))
        const restored = await waitLog(page, since, isRestored, 'H.264 回到原生解码', 15000)
        evidence.phases.crash.restoredAfterKillMs = Date.parse(restored.at) - killedAt
        await capture('native-faults-crash-recovered')
        store()

        // ---- 超时：播放中挂起服务进程，心跳判定卡死后结束并重启 ----
        since = new Date().toISOString()
        const hungPid = await servicePid(page)
        await observe(page)
        await button(page, '播放／暂停').click()
        await sleep(1500)
        const suspendedAt = Date.now()
        evidence.phases.timeout = { suspendResult: suspendProcess(hungPid), suspendedPid: hungPid }
        const hung = await waitLog(page, since, entry => entry.event === 'video_decoder.service.hung', '心跳判定卡死', 20000)
        await waitLog(page, since, entry => entry.event === 'video_decoder.service.ready' && entry.context.pid !== hungPid, '服务重启就绪', 20000)
        await sleep(3500)
        await button(page, '播放／暂停').click()
        observed = await collect(page)
        const timeoutLogs = await logsSince(page, since)
        evidence.phases.timeout = {
          ...evidence.phases.timeout, detectedAfterMs: Date.parse(hung.at) - suspendedAt, newPid: await servicePid(page), oldProcessAlive: processAlive(hungPid),
          frames: checkFrames(observed.frames, 2, '超时'), framesAfterRecovery: checkFrames(observed.frames.filter(value => value.wall > Date.parse(hung.at)), 2, '超时恢复后'), promptPolls: observed.prompts,
          events: timeoutLogs.filter(entry => /video_decoder\.service\.(heartbeat_missed|hung|exited|ready)|video_edit\.decode\.native\.(fallback|retry)/.test(entry.event)).map(entry => ({ event: entry.event, mediaId: entry.context.mediaId, reason: entry.context.reason })),
        }
        store()
        assert.equal(evidence.phases.timeout.oldProcessAlive, false, '卡死的服务进程没有被结束')
        assert.ok(timeoutLogs.some(entry => entry.event === 'video_decoder.service.exited' && entry.context.reason === 'hung'), '退出日志没有标明卡死')
        assert.ok(evidence.phases.timeout.framesAfterRecovery.presented > 30, '服务重启后播放没有继续')
        assert.equal(await page.getByText('节目画面无法显示').count(), 0, '超时恢复后仍有就地提示')

        // ---- 导入失败：主进程共享纹理导入抛错 ----
        since = new Date().toISOString()
        const patched = await app.evaluate(({ sharedTexture }) => {
          globalThis.__henjiFaultImport = sharedTexture.importSharedTexture
          sharedTexture.importSharedTexture = () => { throw new Error('模拟共享纹理导入失败（3.1 故障注入）') }
          return sharedTexture.importSharedTexture !== globalThis.__henjiFaultImport
        })
        assert.ok(patched, '无法在主进程替换共享纹理导入（故障注入未生效）')
        // Frames around the playhead are in the frame cache (no import), so the preview is reloaded: a new render session
        // (empty cache) whose every picture goes through the failing import.
        const target = Number(await page.getByRole('slider', { name: '剪辑时间定位' }).getAttribute('aria-valuenow'))
        await button(page, '更多节目操作').click(); await button(page, '重新加载预览').click()
        await waitPrompt(page, '素材「prores.mov」的解码暂时中断')
        const blocked = await page.evaluate(() => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame ?? null)
        evidence.phases.importFailure = { target, promptWhileFailing: await promptText(page), presentedWhileFailing: blocked }
        assert.notEqual(blocked, String(target), '导入失败时不能呈现缺层的画面')
        await capture('native-faults-import-prompt')
        await app.evaluate(({ sharedTexture }) => { sharedTexture.importSharedTexture = globalThis.__henjiFaultImport; delete globalThis.__henjiFaultImport })
        const restoredAt = Date.now()
        await presented(page, target); await waitNoPrompt(page)
        const importLogs = await logsSince(page, since)
        evidence.phases.importFailure = {
          ...evidence.phases.importFailure, recoveredAfterMs: Date.now() - restoredAt,
          timestamps: await page.evaluate(() => document.querySelector('canvas[aria-label="剪辑画面"]').dataset.sourceTimestamps),
          events: importLogs.filter(entry => /video_frames\.frame\.import_failed|video_edit\.decode\.native\.(fallback|retry)|video_edit\.preview\.render_failed/.test(entry.event)).map(entry => ({ event: entry.event, mediaId: entry.context.mediaId, code: entry.context.code })),
        }
        store()
        assert.ok(importLogs.some(entry => entry.event === 'video_frames.frame.import_failed'), '缺少导入失败日志')
        assert.ok(importLogs.some(entry => entry.event === 'video_edit.decode.native.fallback' && entry.context.mediaId === 'h264' && entry.context.code === 'IMPORT_FAILED'), 'H.264 层没有因导入失败回退')
        // Native reports microseconds: equal within 1e-5 s.
        const drawn = evidence.phases.importFailure.timestamps.split(',').map(Number)
        assert.equal(drawn.length, 2, `导入恢复后画了 ${drawn.length} 层`)
        for (const time of drawn) assert.ok(Math.abs(time - (target % FRAMES) / FPS) < 1e-5, `导入恢复后源时间 ${time} 不是 ${(target % FRAMES) / FPS}`)

        // ---- 坏文件：截断的 ProRes 就地提示，修复后自动重试 ----
        since = new Date().toISOString()
        await openProject(page, app, brokenFile)
        await waitPrompt(page, '素材「broken.mov」')
        evidence.phases.brokenFile = { prompt: await promptText(page), presented: await page.evaluate(() => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame ?? null) }
        assert.equal(evidence.phases.brokenFile.presented, null, '坏文件不能呈现画面')
        await capture('native-faults-broken-file')
        fs.copyFileSync(prores, broken)
        const repairedAt = Date.now()
        await presented(page, 0); await waitNoPrompt(page)
        evidence.phases.brokenFile.recoveredAfterMs = Date.now() - repairedAt
        evidence.phases.brokenFile.timestamps = await page.evaluate(() => document.querySelector('canvas[aria-label="剪辑画面"]').dataset.sourceTimestamps)
        evidence.phases.brokenFile.events = (await logsSince(page, since)).filter(entry => /video_frames\.decoder\.open\.failed|video_edit\.preview\.render_failed|video_edit\.decode\.native/.test(entry.event)).map(entry => ({ event: entry.event, code: entry.context.code }))
        store()
        assert.equal(evidence.phases.brokenFile.timestamps, '0')

        // ---- 超出预算：同时显示 11 个视频素材 ----
        since = new Date().toISOString()
        const budgetPid = await servicePid(page)
        await openProject(page, app, budgetFile)
        await waitPrompt(page, '同时读取的视频素材过多')
        evidence.phases.budget = { prompt: await promptText(page), samePid: (await servicePid(page)) === budgetPid, rendererResponsive: await page.evaluate(() => document.readyState) }
        await capture('native-faults-budget')
        assert.ok(evidence.phases.budget.samePid, '超出预算不能让服务崩溃')
        await button(page, '关闭工程').click()
        await page.waitForFunction(() => !document.querySelector('canvas[aria-label="剪辑画面"]'), null, { timeout: 30000 })
        await sleep(2000)
        evidence.phases.budget.afterClose = await nativeStats(page)
        store()
        assert.equal(evidence.phases.budget.afterClose.streams, 0, '关闭工程后帧流没有归零')
        assert.equal(evidence.phases.budget.afterClose.nativeStreams, 0, '关闭工程后原生会话没有归零')

        // ---- 缺失：服务可执行文件不存在 ----
        since = new Date().toISOString()
        await app.evaluate((_electron, file) => { process.env.HENJI_VIDEO_DECODER_EXECUTABLE = file }, missingExecutable)
        execFileSync('taskkill', ['/F', '/PID', String(await servicePid(page))], { windowsHide: true })
        await waitLog(page, since, entry => entry.event === 'video_decoder.service.unavailable', '服务缺失', 20000)
        await openProject(page, app, h264File); await presented(page, 0)
        await observe(page)
        await button(page, '播放／暂停').click(); await sleep(2000); await button(page, '播放／暂停').click()
        observed = await collect(page)
        const missingLogs = await logsSince(page, since)
        evidence.phases.missing = {
          frames: checkFrames(observed.frames, 1, '缺失时浏览器可解素材'),
          backends: missingLogs.filter(entry => entry.event === 'video_edit.decode.backend.selected').map(entry => entry.context),
        }
        assert.ok(evidence.phases.missing.frames.presented > 30, '服务缺失时浏览器可解素材没有播放')
        assert.ok(evidence.phases.missing.backends.some(entry => entry.mediaId === 'h264' && entry.backend === 'browser' && entry.nativeAvailable === false), '服务缺失时没有改用后备解码')
        await openProject(page, app, faultFile)
        await waitPrompt(page, '素材「prores.mov」的格式当前无法播放')
        evidence.phases.missing.prompt = await promptText(page)
        await capture('native-faults-missing')
        await app.evaluate(() => { delete process.env.HENJI_VIDEO_DECODER_EXECUTABLE })
        await button(page, '更多节目操作').click(); await button(page, '重新加载预览').click()
        await presented(page, 0); await waitNoPrompt(page)
        evidence.phases.missing.recovered = { timestamps: await page.evaluate(() => document.querySelector('canvas[aria-label="剪辑画面"]').dataset.sourceTimestamps), pid: await servicePid(page) }
        assert.deepEqual(evidence.phases.missing.recovered.timestamps.split(',').map(Number), [0, 0])
        await button(page, '关闭工程').click()
        await page.waitForFunction(() => !document.querySelector('canvas[aria-label="剪辑画面"]'), null, { timeout: 30000 })
        await sleep(2000)
        evidence.afterClose = await nativeStats(page)
        assert.equal(evidence.afterClose.streams, 0); assert.equal(evidence.afterClose.nativeStreams, 0); assert.equal(evidence.afterClose.unreleasedImports, 0)
        evidence.completed = true
        store()
      } catch (error) {
        evidence.failed = { message: String(error?.message ?? error), stack: error?.stack }
        store(); await capture('native-faults-failed').catch(() => {})
        throw error
      } finally {
        await app.evaluate(({ sharedTexture }) => {
          delete process.env.HENJI_VIDEO_DECODER_EXECUTABLE
          if (globalThis.__henjiFaultImport) { sharedTexture.importSharedTexture = globalThis.__henjiFaultImport; delete globalThis.__henjiFaultImport }
        }).catch(() => {})
        await page.evaluate(() => { window.__faultObserver?.disconnect(); clearInterval(window.__faultPromptTimer) }).catch(() => {})
        if (await button(page, '关闭工程').isVisible().catch(() => false)) await button(page, '关闭工程').click().catch(() => {})
      }
    },
  }
}

module.exports = { createVideoEditNativeFaultsScene }
