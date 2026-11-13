'use strict'

/**
 * 长录测试的驱动层：通过远程调试端口接管已经在运行的痕迹AI，正式能力走 MCP，界面操作走 Playwright；
 * 系统侧（进程内存、窗口还原、光标、powercfg、结束编码进程）走 PowerShell 与系统命令。
 * 界面整页重载或渲染进程崩溃后自动重新找到主页面。
 */

const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { chromium } = require('playwright-core')
const { connectMcpClient } = require('./uiInspectionMcpClient.cjs')

const MCP_CONNECTION_NAME = '长录测试脚本'

function run(file, args, { timeoutMs = 120_000, input, maxBuffer = 64 * 1024 * 1024 } = {}) {
  return new Promise(resolve => {
    const child = execFile(file, args, { timeout: timeoutMs, maxBuffer, windowsHide: true, encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), error: error ? String(error.message ?? error) : null })
    })
    if (input !== undefined) { child.stdin.end(input) }
  })
}

/** PowerShell 脚本用 -EncodedCommand 传入，免得引号转义；输出统一 UTF-8 JSON。 */
async function powershell(script, options) {
  // 不加 -ExecutionPolicy：本机策略下带它的调用没有任何输出；-EncodedCommand 本来就不受脚本执行策略约束。
  const full = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; ${script}`
  const encoded = Buffer.from(full, 'utf16le').toString('base64')
  const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { input: '', ...options })
  if (result.code !== 0) throw new Error(`PowerShell 失败：${(result.stderr || result.error || '').trim().slice(0, 800)}`)
  const text = result.stdout.trim()
  return text ? JSON.parse(text) : null
}

const WIN32 = `
if (-not ('SoakWin' -as [type])) { Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text; using System.Collections.Generic;
public static class SoakWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int cmd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  public struct POINT { public int X; public int Y; }
  public static List<object[]> Windows(uint target) {
    var list = new List<object[]>();
    EnumWindows((h, l) => { uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid == target && IsWindowVisible(h)) { var sb = new StringBuilder(512); GetWindowText(h, sb, 512); list.Add(new object[] { h.ToInt64(), sb.ToString(), IsIconic(h) }); }
      return true; }, IntPtr.Zero);
    return list;
  }
}
"@ }
`

const os = {
  /** 全部进程（含命令行），用于进程树、内存和找编码进程。 */
  async processes() {
    const list = await powershell("Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,PrivatePageCount,CommandLine,ExecutablePath | ConvertTo-Json -Compress -Depth 2")
    return Array.isArray(list) ? list : list ? [list] : []
  },
  async listenerPid(port) {
    return powershell(`$c = Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $c.OwningProcess | ConvertTo-Json } else { 'null' }`)
  },
  async windows(pid) {
    const list = await powershell(`${WIN32} ConvertTo-Json -Compress -Depth 3 -InputObject @([SoakWin]::Windows(${Number(pid)}) | ForEach-Object { @{ handle = $_[0]; title = $_[1]; minimized = $_[2] } })`)
    return Array.isArray(list) ? list : list ? [list] : []
  },
  /** 还原该进程所有最小化的顶层窗口：应用没有“还原”的 IPC，只能走系统。 */
  async restoreWindows(pid) {
    return powershell(`${WIN32} $n = 0; foreach ($w in [SoakWin]::Windows(${Number(pid)})) { if ($w[2]) { [void][SoakWin]::ShowWindowAsync([IntPtr]::new([long]$w[0]), 9); $n++ } }; $n | ConvertTo-Json`)
  },
  /**
   * 用 mouse_event 绝对坐标把光标从 A 移到 B（走系统输入，低级钩子能收到），再放回原处。
   * 返回每次移动后的墙钟毫秒。A、B 在被录显示器（display，DIP 布局；省略时主屏）中心两侧，x、y 都不同：
   * 录制只记被录区域里的光标，移到别的显示器上事件里只有空位置。
   * PowerShell 不感知 DPI，坐标与 Electron 的 DIP 一致（各屏缩放相同时）；按虚拟桌面归一化（MOUSEEVENTF_VIRTUALDESK）。
   */
  async moveCursor(holdMs = 400, display = null) {
    const rect = display ? [display.x, display.y, display.width, display.height].map(value => Math.round(value)) : null
    return powershell(`${WIN32}
$o = New-Object SoakWin+POINT; [void][SoakWin]::GetCursorPos([ref]$o)
$vx = [SoakWin]::GetSystemMetrics(76); $vy = [SoakWin]::GetSystemMetrics(77); $vw = [SoakWin]::GetSystemMetrics(78); $vh = [SoakWin]::GetSystemMetrics(79)
${rect ? `$rx = ${rect[0]}; $ry = ${rect[1]}; $w = ${rect[2]}; $h = ${rect[3]}` : '$rx = 0; $ry = 0; $w = [SoakWin]::GetSystemMetrics(0); $h = [SoakWin]::GetSystemMetrics(1)'}
$a = @([int]($rx+$w*0.4), [int]($ry+$h*0.4)); $b = @([int]($rx+$w*0.6), [int]($ry+$h*0.6))
function MoveTo($p) { [SoakWin]::mouse_event(0xC001, [int](($p[0]-$vx)*65535/($vw-1)), [int](($p[1]-$vy)*65535/($vh-1)), 0, [UIntPtr]::Zero); [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
$ta = MoveTo $a; Start-Sleep -Milliseconds ${Number(holdMs)}; $tb = MoveTo $b; Start-Sleep -Milliseconds ${Number(holdMs)}
[void][SoakWin]::SetCursorPos($o.X, $o.Y)
@{ a = $a; b = $b; aAtMs = $ta; bAtMs = $tb; endAtMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); screen = @($w, $h) } | ConvertTo-Json -Compress`)
  },
  /** 各显示器的物理像素矩形（进程先声明感知 DPI，否则拿到的是按缩放虚拟化后的坐标）。 */
  async physicalScreens() {
    const list = await powershell(`Add-Type 'using System; using System.Runtime.InteropServices; public static class SoakDpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
[void][SoakDpi]::SetProcessDPIAware(); Add-Type -AssemblyName System.Windows.Forms
ConvertTo-Json -Compress -InputObject @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object { @{ primary = $_.Primary; x = $_.Bounds.X; y = $_.Bounds.Y; width = $_.Bounds.Width; height = $_.Bounds.Height } })`)
    return Array.isArray(list) ? list : list ? [list] : []
  },
  /** powercfg /requests 需要管理员权限；用 UTF-8 代码页读输出。 */
  async powerRequests() {
    const result = await run('cmd.exe', ['/d', '/c', 'chcp 65001>nul & powercfg /requests'], { timeoutMs: 30_000 })
    return { code: result.code, text: result.stdout, error: result.code ? (result.stdout + result.stderr).trim().slice(0, 400) || result.error : null }
  },
  async kill(pid) { return run('taskkill.exe', ['/PID', String(pid), '/F'], { timeoutMs: 15_000 }) },
}

function mediaBinaries() {
  const { ffmpegPath, ffprobePath } = require('ffmpeg-ffprobe-static')
  return { ffmpegPath, ffprobePath }
}

async function probe(file) {
  if (!file || !fs.existsSync(file)) return { ok: false, error: '文件不存在' }
  const result = await run(mediaBinaries().ffprobePath, ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,codec_name,sample_rate,channels,width,height,avg_frame_rate', '-of', 'json', file], { timeoutMs: 60_000 })
  if (result.code !== 0) return { ok: false, error: result.stderr.trim().slice(0, 400) || result.error }
  try {
    const parsed = JSON.parse(result.stdout)
    const audio = parsed.streams?.find(stream => stream.codec_type === 'audio'), video = parsed.streams?.find(stream => stream.codec_type === 'video')
    return { ok: true, durationSeconds: Number(parsed.format?.duration), sizeBytes: Number(parsed.format?.size), codec: (video ?? audio)?.codec_name,
      ...(audio ? { sampleRate: Number(audio.sample_rate), channels: audio.channels } : {}), ...(video ? { width: video.width, height: video.height, frameRate: video.avg_frame_rate } : {}) }
  } catch (error) { return { ok: false, error: `ffprobe 输出无法解析：${error.message}` } }
}

/** 一段时间里画面有没有明显变化：ffmpeg 场景分数，两个线程，避免抢满 CPU。返回相对 startSeconds 的变化时刻。 */
async function sceneChanges(file, startSeconds, windowSeconds, threshold = 0.02, { crop } = {}) {
  const result = await run(mediaBinaries().ffmpegPath, ['-hide_banner', '-nostats', '-threads', '2', '-ss', String(Math.max(0, startSeconds)), '-i', file, '-t', String(windowSeconds), '-an',
    '-vf', `${crop ? `crop=${crop},` : ''}select='gt(scene\\,${threshold})',showinfo`, '-f', 'null', '-'], { timeoutMs: 180_000 })
  if (result.code !== 0) return { ok: false, error: result.stderr.trim().split('\n').slice(-3).join(' ').slice(0, 400) }
  return { ok: true, times: [...result.stderr.matchAll(/pts_time:([\d.]+)/g)].map(match => Number(match[1])) }
}

/**
 * 声音电平与静音段：ffmpeg volumedetect 给峰值与平均值，silencedetect 找出长于 minSilence 的静音。
 * startSeconds/windowSeconds 省略时测整个文件。
 */
async function audioLevel(file, { startSeconds, windowSeconds, silenceDb = -70, minSilence = 0.2 } = {}) {
  const range = Number.isFinite(startSeconds) ? ['-ss', String(Math.max(0, startSeconds)), '-t', String(windowSeconds)] : []
  const result = await run(mediaBinaries().ffmpegPath, ['-hide_banner', '-nostats', '-threads', '2', ...range, '-i', file, '-vn',
    '-af', `silencedetect=n=${silenceDb}dB:d=${minSilence},volumedetect`, '-f', 'null', '-'], { timeoutMs: 600_000 })
  if (result.code !== 0) return { ok: false, error: result.stderr.trim().split('\n').slice(-3).join(' ').slice(0, 400) }
  const number = pattern => { const match = pattern.exec(result.stderr); return match ? Number(match[1]) : null }
  const starts = [...result.stderr.matchAll(/silence_start: (-?[\d.]+)/g)].map(match => Number(match[1]))
  const ends = [...result.stderr.matchAll(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g)].map(match => ({ end: Number(match[1]), duration: Number(match[2]) }))
  // 静音一直持续到窗口末尾时只有 silence_start，没有对应的 end。
  const silences = starts.map((start, index) => ({ startSeconds: start, durationSeconds: ends[index]?.duration ?? (Number.isFinite(windowSeconds) ? windowSeconds - start : null) }))
  return { ok: true, maxVolumeDb: number(/max_volume: (-?[\d.]+|-inf) dB/), meanVolumeDb: number(/mean_volume: (-?[\d.]+|-inf) dB/), silences }
}

/**
 * 被录显示器上的运动源：系统 PATH 上的 ffplay 播放 lavfi 合成源——testsrc2 高运动测试图（按显示器像素、60 帧）
 * 加约 -30 dBFS 峰值的粉噪，无边框置顶铺满该显示器，一直播到 stop()。完全静止的画面说明不了问题。
 * display 是录制来源的 DIP 布局（x/y/width/height/scaleFactor）。ffplay（SDL）感知 DPI，窗口位置与大小按物理像素给：
 * 按 DIP 给时在 150% 缩放下窗口会错到相邻显示器上（盖住主屏一部分，被录屏只露出一角）。
 */
async function startMotion({ display, fps = 60 }) {
  const version = await run('ffplay', ['-hide_banner', '-version'], { timeoutMs: 15_000 })
  if (version.code !== 0) return { ok: false, reason: `系统 PATH 上找不到可用的 ffplay（${(version.error ?? '').slice(0, 120)}）` }
  if (!display) return { ok: false, reason: '录制来源没有显示器布局（单窗口录制时运动源无法放进被录画面）' }
  const even = value => Math.max(2, Math.round(value / 2) * 2)
  const scale = display.scaleFactor ?? 1
  const width = Math.round(display.width * scale), height = Math.round(display.height * scale)
  // 物理坐标里同尺寸、同为（不为）主屏、离按缩放估算的位置最近的那块就是被录显示器。
  const screens = (await os.physicalScreens().catch(() => [])).filter(item => Boolean(item.primary) === Boolean(display.primary) && Math.abs(item.width - width) <= 2 && Math.abs(item.height - height) <= 2)
  const target = screens.sort((a, b) => Math.hypot(a.x - display.x * scale, a.y - display.y * scale) - Math.hypot(b.x - display.x * scale, b.y - display.y * scale))[0]
  if (!target) return { ok: false, reason: `找不到与录制来源对应的物理显示器（${width}×${height}）` }
  const graph = `testsrc2=size=${even(width)}x${even(height)}:rate=${fps}[out0];anoisesrc=color=pink:amplitude=0.0316:sample_rate=48000[out1]`
  const args = ['-hide_banner', '-loglevel', 'error', '-noborder', '-alwaysontop', '-window_title', '长录测试运动源',
    '-left', String(target.x), '-top', String(target.y), '-x', String(target.width), '-y', String(target.height), '-f', 'lavfi', '-i', graph]
  const { spawn } = require('node:child_process')
  const child = spawn('ffplay', args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: false })
  const state = { ok: true, source: 'ffplay', audio: true, pid: child.pid, args, startedAtMs: Date.now(), exitedAtMs: null, exitCode: null, stderr: '' }
  child.stderr.on('data', chunk => { state.stderr = (state.stderr + chunk).slice(-2000) })
  child.on('exit', code => { state.exitedAtMs = Date.now(); state.exitCode = code })
  child.on('error', error => { state.exitedAtMs ??= Date.now(); state.stderr += String(error.message) })
  await new Promise(resolve => setTimeout(resolve, 3000))
  if (state.exitedAtMs) return { ok: false, reason: `ffplay 启动后立刻退出（${state.exitCode}）：${state.stderr.trim().slice(0, 300)}` }
  return {
    state,
    running: () => !state.exitedAtMs,
    // 只结束自己启动的这棵进程树（scoop 的 ffplay 是转发外壳，真正的播放器是它的子进程）。
    stop: async () => { if (!state.exitedAtMs) await run('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeoutMs: 15_000 }) },
  }
}

async function directorySize(target) {
  let total = 0
  const walk = async (entry) => {
    let stat
    try { stat = await fs.promises.lstat(entry) } catch { return }
    if (stat.isSymbolicLink()) return
    if (!stat.isDirectory()) { total += stat.size; return }
    for (const child of await fs.promises.readdir(entry).catch(() => [])) await walk(path.join(entry, child))
  }
  await walk(target)
  return total
}

const TRANSIENT = /Target (page, context or browser )?(has been )?closed|Execution context was destroyed|crash|has been closed|detached|Cannot find context|Protocol error|not attached|navigat/i

class AppDriver {
  constructor({ port, log }) {
    this.port = port
    this.log = log
    this.browser = null
    this.currentPage = null
    this.client = null
    this.connectionId = null
    this.enabledMcp = false
  }

  /** 应用没在运行就报错，并说明怎么启动；脚本自己不构建也不启动应用。 */
  async connect() {
    let version
    try {
      const response = await fetch(`http://127.0.0.1:${this.port}/json/version`, { signal: AbortSignal.timeout(5000) })
      version = await response.json()
    } catch {
      throw new Error([
        `连不上 127.0.0.1:${this.port} 的远程调试端口：痕迹AI 没有在运行，或启动时没有打开调试端口。`,
        '先在另一个终端启动正式构建（PowerShell）：',
        `  $env:HENJI_ELECTRON_REMOTE_DEBUGGING_PORT=${this.port}; npm run electron:prod -- --dev-skip-onboarding`,
        '（需要新产物时先 npm run build:audio-capture 与 npm run electron:bundle；产物已最新时加 --skip-build）',
      ].join('\n'))
    }
    this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.port}`, { timeout: 30_000 })
    this.browserVersion = version?.Browser ?? null
    await this.page()
    return { browser: this.browserVersion, url: this.currentPage.url() }
  }

  findMainPage() {
    for (const context of this.browser?.contexts() ?? []) {
      for (const page of context.pages()) {
        const url = page.url()
        if (url.startsWith('devtools://') || /[?&]view=/.test(url) || page.isClosed()) continue
        return page
      }
    }
    return null
  }

  /** 拿到可用的主页面：断开就重连，页面没了就重新找，并等应用和对外宿主就绪。 */
  async page({ timeoutMs = 90_000 } = {}) {
    const deadline = Date.now() + timeoutMs
    let lastError
    for (let attempt = 1; Date.now() < deadline; attempt++) {
      try {
        // 渲染进程崩溃后旧的页面对象可能一直不可用：连续失败时整条 CDP 连接重建，拿新的页面对象。
        if (attempt % 10 === 0) { await this.browser?.close().catch(() => {}); this.browser = null; this.currentPage = null }
        if (!this.browser?.isConnected()) this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.port}`, { timeout: 15_000 })
        const page = this.findMainPage()
        if (page) {
          if (page !== this.currentPage) {
            // 应用如果在重载前弹“离开此页”，接受它：脚本只操作测试项目。
            page.on('dialog', dialog => { void (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss()).catch(() => {}) })
            this.currentPage = page
          }
          await page.waitForFunction(() => typeof window.henjiNative === 'object' && document.readyState === 'complete', null, { timeout: 15_000 })
          return page
        }
        lastError = new Error('没有找到主窗口页面')
      } catch (error) { lastError = error }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    throw new Error(`主窗口页面在 ${Math.round(timeoutMs / 1000)} 秒内没有就绪：${lastError?.message ?? lastError}`)
  }

  async evaluate(fn, arg, { attempts = 4 } = {}) {
    let lastError
    for (let attempt = 0; attempt < attempts; attempt++) {
      try { return await (await this.page()).evaluate(fn, arg) } catch (error) {
        lastError = error
        if (!TRANSIENT.test(String(error?.message ?? error))) throw error
        this.log(`页面暂时不可用，重试：${String(error.message).split('\n')[0]}`)
        await new Promise(resolve => setTimeout(resolve, 1500))
      }
    }
    throw lastError
  }

  async waitMcpReady(timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (await this.evaluate(async () => (await window.henjiNative.mcp.status()).ready).catch(() => false)) return
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new Error('应用对外宿主没有就绪')
  }

  /** 新建一个只给本脚本用的外部连接；对外服务原本关着就临时打开，结束时恢复。 */
  async connectMcp() {
    const identity = await this.evaluate(async (name) => {
      const before = await window.henjiNative.mcp.status()
      if (!before.enabled) await window.henjiNative.mcp.configure({ enabled: true, port: before.port })
      const connection = await window.henjiNative.mcp.authorize({ name })
      return { enabledBefore: before.enabled, port: before.port, id: connection.id, config: JSON.parse(await window.henjiNative.mcp.connectionConfig({ id: connection.id })).mcpServers.henji }
    }, MCP_CONNECTION_NAME)
    this.connectionId = identity.id
    this.enabledMcp = !identity.enabledBefore
    this.mcpPort = identity.port
    this.mcpConfig = identity.config
    await this.waitMcpReady()
    this.client = await connectMcpClient(identity.config, 'Henji recording soak')
    return { connectionId: identity.id, enabledMcp: this.enabledMcp }
  }

  /** 只撤销本脚本建的连接，不动用户其他连接。 */
  async disconnectMcp() {
    await this.client?.close().catch(() => {})
    this.client = null
    if (!this.connectionId) return
    const id = this.connectionId, disable = this.enabledMcp, port = this.mcpPort
    await this.evaluate(async ({ id, disable, port }) => {
      await window.henjiNative.mcp.revoke({ id })
      if (disable) await window.henjiNative.mcp.configure({ enabled: false, port })
    }, { id, disable, port })
    this.connectionId = null
  }

  /**
   * 调用正式能力。写操作带新的 operationId；只有幂等调用（读取、导航）才在宿主重载期间重试。
   * 返回能力自己的 data。
   */
  async call(name, input, { write = false, retryMs = 0, timeoutMs = 120_000 } = {}) {
    const deadline = Date.now() + retryMs
    for (;;) {
      try {
        if (!this.client) this.client = await connectMcpClient(this.mcpConfig, 'Henji recording soak')
        const args = write ? { operationId: randomUUID(), baselineIds: [], ...input } : input
        const result = await this.client.callTool({ name, arguments: args }, { timeout: timeoutMs })
        if (result.isError) throw new Error(`${name} 调用失败：${JSON.stringify(result.content ?? result).slice(0, 800)}`)
        const content = result.structuredContent
        if (!write) return content?.data ?? content
        if (!['completed', 'submitted'].includes(content?.executionState)) throw new Error(`${name} 没有完成：${JSON.stringify(content).slice(0, 800)}`)
        return content.result?.data ?? content.result
      } catch (error) {
        if (Date.now() >= deadline) throw error
        this.log(`${name} 暂时失败，重试：${String(error.message).split('\n')[0].slice(0, 200)}`)
        await this.waitMcpReady().catch(() => {})
        await new Promise(resolve => setTimeout(resolve, 1500))
      }
    }
  }

  async readEntity(ref, propertyIds) {
    const data = await this.call('read_application_entity', { ref, ...(propertyIds ? { propertyIds } : {}) }, { retryMs: 30_000 })
    return data?.properties ?? data
  }

  /** 正式日志查询接口：按 UTC 日期、afterTimestamp、级别与关键字在主进程过滤，分页读完。 */
  async queryLogs({ sinceIso, dates, level, keyword }) {
    return this.evaluate(async ({ sinceIso, dates, level, keyword }) => {
      const events = []
      let corrupted = 0
      for (const date of dates) {
        let beforeLine
        for (let page = 0; page < 500; page++) {
          const result = await window.henjiNative.logging.queryLogEvents({ date, afterTimestamp: sinceIso, limit: 2000, ...(level ? { level } : {}), ...(keyword ? { keyword } : {}), ...(beforeLine !== undefined ? { beforeLine } : {}) })
          corrupted += result.corruptedLines
          for (const event of result.events) {
            let context = event.context
            const text = context === undefined ? '' : JSON.stringify(context)
            if (text.length > 4000) context = { truncated: text.slice(0, 4000) }
            events.push({ timestamp: event.timestamp, level: event.level, domain: event.domain, event: event.event, message: event.message, requestId: event.requestId, context,
              ...(event.error ? { error: typeof event.error === 'object' ? JSON.stringify(event.error).slice(0, 1000) : String(event.error) } : {}) })
          }
          if (!result.hasMore || result.nextBeforeLine === undefined) break
          beforeLine = result.nextBeforeLine
        }
      }
      return { events, corrupted }
    }, { sinceIso, dates, level, keyword })
  }

  /** 页面里用的 CDP 会话：整页重载、主动让渲染进程崩溃。 */
  async reloadPage() {
    // 不先等页面就绪：崩溃后的页面执行不了脚本，但仍能重载。
    const page = this.findMainPage() ?? await this.page()
    await page.reload({ waitUntil: 'load', timeout: 120_000 }).catch(error => this.log(`整页重载返回：${error.message.split('\n')[0]}`))
    await this.page({ timeoutMs: 120_000 })
  }

  async crashRenderer() {
    const page = await this.page()
    const session = await page.context().newCDPSession(page)
    await session.send('Page.crash').catch(() => {})
    this.currentPage = null
  }

  /** 主进程 PID：调试端口由主进程监听；查不到时退回 CDP 的进程信息。 */
  async mainPid() {
    const listener = await os.listenerPid(this.port).catch(() => null)
    if (Number.isInteger(listener)) return listener
    const session = await this.browser.newBrowserCDPSession()
    try {
      const info = await session.send('SystemInfo.getProcessInfo')
      return info.processInfo.find(item => item.type === 'browser')?.id ?? null
    } finally { await session.detach().catch(() => {}) }
  }

  async close() {
    await this.disconnectMcp().catch(error => this.log(`撤销外部连接失败：${error.message}`))
    // 只断开 CDP，不关闭应用。
    await this.browser?.close().catch(() => {})
  }
}

module.exports = { AppDriver, audioLevel, directorySize, MCP_CONNECTION_NAME, os, probe, sceneChanges, startMotion }
