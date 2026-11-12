import type { RecordingControlSnapshot } from '@/core/screenRecording/contracts'
import { getPlatform } from '@/platform/runtime'
import { listVideoEditActivities, listVideoEditInstances } from './videoEditService'
import { videoEditProxyGenerating } from './videoEditProxy'
import { videoEditTrackingActive } from './videoEditTracking'
import { videoEditSmartRegionsActive } from './videoEditSmartRegions'
import { videoEditSceneDetectionActive } from './videoEditSceneDetection'

/**
 * 后台预渲染要让开的前台信号：用户输入、应用失去焦点，以及会占用显卡解码或编码的前台任务（录屏、建代理、导出）。
 * 预渲染的解码与编码和这些工作共用同一块显卡（本机硬解约 3.7 路 4K60），只有用户真的闲着、显卡有余量时才值得做。
 */

let lastInputAt = Number.NEGATIVE_INFINITY
const inputListeners = new Set<() => void>()
let inputInstalled = false
/**
 * 按下、键盘、滚轮与按住拖动算用户在操作；只移动鼠标不算（悬停不会带来重活，算进去会让预渲染永远等不到空闲）。
 * 窗口失去焦点也算：用户切去别的程序干活或玩游戏，正要用显卡。捕获阶段被动监听，不影响任何界面处理。
 */
function installInput(): void {
  if (inputInstalled || typeof window === 'undefined') return
  inputInstalled = true
  const note = (): void => { lastInputAt = performance.now(); for (const listener of inputListeners) listener() }
  const options = { capture: true, passive: true }
  for (const type of ['pointerdown', 'keydown', 'wheel'] as const) window.addEventListener(type, note, options)
  window.addEventListener('pointermove', event => { if (event.buttons) note() }, options)
  window.addEventListener('blur', note)
}
/** 距最近一次用户输入的时长；从未输入为无穷大。 */
export function videoEditUserInputIdleFor(): number { installInput(); return performance.now() - lastInputAt }
/** 用户一有输入就通知（同步，在事件处理里调用，要轻）。 */
export function subscribeVideoEditUserInput(listener: () => void): () => void {
  installInput(); inputListeners.add(listener)
  return () => { inputListeners.delete(listener) }
}
/** 应用内这么久没有输入、且窗口有焦点，算用户闲着（应用内空闲）。 */
const APP_INPUT_IDLE_MS = 10_000
/** 全系统（所有程序）这么久没有键盘鼠标输入，算用户走开了（全系统空闲），不看焦点。 */
const SYSTEM_IDLE_SECONDS = 30
/** 全系统空闲时长的采样间隔：查询走主进程，几秒一次足够。 */
const SYSTEM_IDLE_SAMPLE_MS = 2000
let systemIdle: { seconds: number; at: number } | undefined
let sampling = false
/** 全系统空闲秒数的估计：上次采样值加上采样后经过的时间；距上次采样超过间隔时在后台再取一次。拿不到时为 0（按用户在操作）。 */
function systemIdleSeconds(): number {
  const now = performance.now()
  if (!sampling && (!systemIdle || now - systemIdle.at >= SYSTEM_IDLE_SAMPLE_MS)) {
    sampling = true
    void (async () => { try { systemIdle = { seconds: await getPlatform().system.idleSeconds(), at: performance.now() } } catch { /* 没有桌面宿主：只按应用内空闲判断。 */ } finally { sampling = false } })()
  }
  return systemIdle ? systemIdle.seconds + (now - systemIdle.at) / 1000 : 0
}
/**
 * 用户是不是闲着，后台预渲染可以开始或继续：
 * - 窗口必须可见（副屏可见即可）：正式版窗口最小化或被完全遮住时浏览器把主线程定时器节流到一秒以上，预渲染逐帧的节拍
 *   在主线程上，推进不了，不假装支持。
 * - 再满足其一：全系统空闲达到阈值（用户挂着软件去吃饭、窗口在副屏，不看焦点）；或窗口有焦点且应用内一段时间没有输入。
 *   用户在别的程序里操作时全系统空闲达不到，应用又没有焦点，自然不开始；一旦有全系统输入，空闲时长归零，随即让出。
 * 返回依据（system / app）便于日志说明；不闲着为 undefined。没有窗口的环境（测试）只看应用内空闲。
 */
export function videoEditUserIdleBasis(): 'system' | 'app' | undefined {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return undefined
  if (systemIdleSeconds() >= SYSTEM_IDLE_SECONDS) return 'system'
  const focused = typeof document === 'undefined' || typeof document.hasFocus !== 'function' || document.hasFocus()
  return focused && videoEditUserInputIdleFor() >= APP_INPUT_IDLE_MS ? 'app' : undefined
}

let recording: RecordingControlSnapshot['phase'] | undefined
let recordingWatched = false
function watchRecording(): void {
  if (recordingWatched) return
  recordingWatched = true
  try {
    const api = getPlatform().screenRecording
    if (!api) return
    let received = false
    api.onChanged(snapshot => { received = true; recording = snapshot?.phase })
    void api.snapshot().then(snapshot => { if (!received) recording = snapshot?.phase }, () => undefined)
  } catch { /* 没有录屏能力的环境（测试、网页预览）按没在录。 */ }
}
const RECORDING_ACTIVE = new Set<RecordingControlSnapshot['phase']>(['countdown', 'recording', 'paused', 'stopping'])
/** 正在录屏（不论录到哪里）：录制的硬件编码和预渲染抢同一个编码器。 */
export function videoEditRecordingActive(): boolean {
  watchRecording()
  return recording !== undefined && RECORDING_ACTIVE.has(recording)
}

/**
 * 登记在剪辑上、确实解码原片或占用显卡的长任务：导出（排队中的也算，马上就要开始）、录屏写入、录制成片、重录替换，
 * 以及逐帧解原片跑本地模型的自动重构画幅、敏感文字识别、注意力推近。剪辑上的其他登记（云端生成、字幕、节拍、
 * 音频处理、多机位声音同步等）只为保活或只用声音，不让预渲染停下。原生解码服务没有“在途会话数”这类全局信号，只能按名单。
 */
const GPU_ACTIVITIES = new Set(['export', '屏幕录制', '导演录制', '录制成片', '重录替换', '自动重构画幅', '敏感文字识别', '注意力推近'])

/** 正在进行的占显卡的前台任务（用于日志与让出原因）；没有时为 undefined。正在进行的导出由实例的 busy 另行判断。 */
export function videoEditGpuTask(): string | undefined {
  if (videoEditRecordingActive()) return 'recording'
  if (videoEditProxyGenerating()) return 'proxy'
  // 跟踪（含稳定）、智能区域、场景检测不登记长任务，各自的状态表就是信号。
  if (videoEditTrackingActive()) return 'tracking'
  if (videoEditSmartRegionsActive()) return 'smart-region'
  if (videoEditSceneDetectionActive()) return 'scene-detection'
  for (const instance of listVideoEditInstances()) {
    const label = listVideoEditActivities(instance).find(value => GPU_ACTIVITIES.has(value))
    if (label !== undefined) return `activity:${label}`
  }
  return undefined
}
