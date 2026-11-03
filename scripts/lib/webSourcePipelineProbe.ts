import fs from 'node:fs/promises'
import path from 'node:path'
import { BrowserWindow, ipcMain, sharedTexture, type OffscreenSharedTexture } from 'electron'
import { WebSourcePage } from '../../electron/main/services/web-source/page'
import { GpuFrameCapture } from '../../electron/main/services/web-replay/player/gpuCapture'
import { WebCacheSubmissions } from '../../electron/main/services/web-source/submissions'
import type { VideoFrameTarget } from '../../electron/main/services/video-decoder/texture-bridge'
import type { VideoFrameMeta } from '../../src/platform/contracts/videoFrameTypes'

const FRAMES = 300

const stats = (values: number[]): Record<string, number> => {
  const sorted = [...values].sort((a, b) => a - b)
  return { count: values.length, p50Ms: sorted[Math.floor(sorted.length * .5)], p95Ms: sorted[Math.floor(sorted.length * .95)], maxMs: sorted.at(-1)! }
}

function fixture(width: number, heavy: boolean): string {
  const cards = heavy ? `<script>for(let i=0;i<144;i++){const e=document.createElement('div');e.textContent='补录 '+i;e.style.cssText='position:absolute;left:'+(i%12*8)+'%;top:'+Math.floor(i/12)*8+'%;filter:blur(.3px);text-shadow:2px 2px 4px gray;backdrop-filter:blur(4px);border-radius:12px;padding:8px;background:linear-gradient(90deg,transparent,gray)';s.append(e)}</script>` : ''
  // 左上 16 像素之外画 16 位条码：接收端从画面本身读出时刻，独立于主进程的票据与身份区。
  return `<!doctype html><style>html,body{margin:0;overflow:hidden}#s{position:relative;width:100vw;height:100vh;background:linear-gradient(120deg,navy,teal);color:white;font:${Math.round(width / 30)}px sans-serif}#b{position:absolute;top:0;left:16px;width:16px;height:1px;image-rendering:pixelated}#t{position:absolute;left:15%;top:30%}</style><div id="s" data-henji-stage><canvas id="b" width="16" height="1"></canvas><div id="t">网页</div></div><script>
    henjiWeb={ready:Promise.resolve(),duration:600,seek(t){const c=b.getContext('2d'),ms=Math.round(t*1000);for(let i=0;i<16;i++){c.fillStyle=ms&(1<<i)?'white':'black';c.fillRect(i,0,1,1)}document.getElementById('t').textContent='网页 '+t.toFixed(3);document.getElementById('t').style.transform='translateX('+Math.round(Math.sin(t)*200)+'px)'}}
  </script>${cards}`
}

/**
 * 正式 Reality 容器内运行。`baseline` 是提交里的旧实现，只测逐帧与流水两种深度并留一张同刻截图；`pipeline` 另测标记帧截图与 4K 可靠补录。
 * 条码来自网页画面，独立于主进程传来的时间与票据。
 */
export async function webSourcePipelineProbe(output: string, mode: 'baseline' | 'pipeline'): Promise<unknown> {
  await fs.mkdir(output, { recursive: true })
  // 分段计时只包装原型方法，不改被测实现：脚本返回即允许下一次 seek，之后是传输与对号。
  const stages = { script: [] as number[], transport: [] as number[], identify: [] as number[] }
  const prototype = WebSourcePage.prototype as unknown as { takeSnapshot(...args: unknown[]): Promise<unknown> }
  const takeSnapshot = prototype.takeSnapshot
  prototype.takeSnapshot = async function (this: unknown, ...args: unknown[]) {
    const started = performance.now()
    let submitted = started
    const notify = args[1] as (() => void) | undefined
    args[1] = () => { submitted = performance.now(); notify?.() }
    const result = await takeSnapshot.apply(this, args)
    stages.script.push(submitted - started); stages.transport.push(performance.now() - submitted)
    return result
  }
  const identify = GpuFrameCapture.prototype.identifySnapshot as ((texture: OffscreenSharedTexture) => Promise<string | undefined>) | undefined
  if (identify) GpuFrameCapture.prototype.identifySnapshot = async function (this: GpuFrameCapture, texture: OffscreenSharedTexture) {
    const started = performance.now()
    try { return await identify.call(this, texture) } finally { stages.identify.push(performance.now() - started) }
  }
  const host = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    preload: path.join(output, 'receiver.cjs') } })
  await host.loadURL('about:blank')
  const target: VideoFrameTarget = { id: host.webContents.id, get mainFrame() { return host.webContents.mainFrame }, isDestroyed: () => host.isDestroyed(), send: () => undefined, onGone: () => () => undefined }
  let page: WebSourcePage | undefined
  const received = new Map<string, { resolve(value: { code: number; png?: Uint8Array }): void }>()
  const listener = (event: Electron.IpcMainEvent, value: { ticket: string; code: number; png?: Uint8Array }): void => {
    if (event.sender.id === host.webContents.id) { received.get(value.ticket)?.resolve(value); received.delete(value.ticket) }
  }
  ipcMain.on('web-source-pipeline:received', listener)
  const report: { mode: string; cases: unknown[]; recording: unknown[] } = { mode, cases: [], recording: [] }
  const save = (): Promise<void> => fs.writeFile(path.join(output, `metrics-${mode}.json`), JSON.stringify(report, null, 2))
  try {
    for (const [width, height] of [[1920, 1080], [3840, 2160]]) {
      const root = path.join(output, `site-${mode}-${width}`)
      await fs.mkdir(root, { recursive: true })
      await fs.writeFile(path.join(root, 'index.html'), fixture(width, false))
      page = new WebSourcePage(`pipeline-${mode}-${width}`, target, 'pipeline', { root }, { width, height, region: [0, 0, width, height], scale: 1 }, 'fixture', () => undefined, () => undefined)
      await page.open()
      if (page.capturePath.captureMode !== 'html-in-canvas') throw new Error(JSON.stringify(page.capturePath))
      const source = page as unknown as { deliver(texture: OffscreenSharedTexture, time: number, ticket: string, restore?: number[]): Promise<void>; snapshotFrames?: { metrics: unknown } }
      let screenshot: string | undefined
      let checked = 0, mismatched = 0
      source.deliver = async (texture, time, ticket, restore) => {
        const imported = sharedTexture.importSharedTexture({ textureInfo: texture.textureInfo as unknown as Parameters<typeof sharedTexture.importSharedTexture>[0]['textureInfo'], allReferencesReleased: () => texture.release() })
        const result = new Promise<{ code: number; png?: Uint8Array }>(resolve => received.set(ticket, { resolve }))
        try {
          const meta: VideoFrameMeta & { snapshot?: boolean } = { route: 'pipeline', streamId: page!.streamId, frameIndex: 0, timestampUs: Math.round(time * 1e6), request: { kind: 'frame_at', id: ticket },
            displaySize: { width, height }, ...(restore ? { webRestore: restore } : {}), snapshot: !!screenshot }
          await sharedTexture.sendSharedTexture({ frame: host.webContents.mainFrame, importedSharedTexture: imported }, meta)
          const frame = await result
          checked++
          if (frame.code !== (Math.round(time * 1000) & 65535)) mismatched++
          if (screenshot && frame.png) await fs.writeFile(path.join(output, screenshot), frame.png)
        } finally { imported.release() }
      }
      for (const depth of [1, 3]) {
        for (const values of Object.values(stages)) values.length = 0
        const pending: Array<Promise<unknown>> = [], waits: number[] = []
        let retries = 0
        checked = 0; mismatched = 0
        const capture = async (index: number): Promise<void> => {
          for (;;) {
            const result = await page!.capture(240 + index / 30, `${width}-${depth}-${index}-${retries}`, undefined)
            if (!result.dropped) return
            retries++
          }
        }
        const started = performance.now()
        for (let index = 0; index < FRAMES + depth; index++) {
          if (index < FRAMES) pending.push(capture(index))
          if (pending.length >= depth || index >= FRAMES) {
            if (!pending.length) break
            const begun = performance.now(); await pending.shift()
            // 前十幅含首次跳到 240 秒与编译管线，不计入稳态。
            if (index >= depth + 10) waits.push(performance.now() - begun)
          }
        }
        const stage = Object.fromEntries(Object.entries(stages).map(([key, values]) => [key, values.length ? stats(values.splice(0)) : null]))
        report.cases.push({ width, height, depth, waits: stats(waits), stages: stage, meanIntervalMs: (performance.now() - started) / FRAMES, retries, checked, mismatched, matching: source.snapshotFrames?.metrics ?? null })
        await save()
      }
      const shots = mode === 'baseline' ? ['head'] : ['pipeline', 'compositor']
      for (const shot of shots) {
        if (shot === 'compositor') await (page as unknown as { disableSnapshot(error: string): Promise<void> }).disableSnapshot('Reality 对照标记帧')
        screenshot = `${width}-${shot}.png`
        await page.capture(1.5, `${width}-${shot}`, undefined)
        screenshot = undefined
      }
      page.close(); page = undefined
      if (width === 3840 && mode === 'pipeline') {
        const reader = new GpuFrameCapture(0, 'yuv444p')
        try {
          await reader.open()
          for (const heavy of [false, true]) {
            await fs.writeFile(path.join(root, 'index.html'), fixture(width, heavy))
            page = new WebSourcePage(`recording-${heavy}`, target, 'pipeline', { root }, { width, height, region: [0, 0, width, height], scale: 1 }, `fixture-${heavy}`, () => undefined, () => undefined, new WebCacheSubmissions({ info: () => undefined }))
            await page.open()
            const times = [0, 1 / 30, 10, 60, 180, 240, ...Array.from({ length: FRAMES }, (_, i) => 241 + i / 30)]
            const failures: Array<{ time: number; error: string }> = [], durations: number[] = []
            let completed = 0
            for (const time of times) {
              const begun = performance.now()
              try { await page.captureReliable(time, `record-${heavy}-${time}`, reader); completed++; durations.push(performance.now() - begun) }
              catch (error) { failures.push({ time, error: error instanceof Error ? error.message : String(error) }) }
            }
            report.recording.push({ heavy, width, height, times: [times[0], times.at(-1)], longJumps: [10, 60, 180, 240], completed, failures, durations: stats(durations) })
            await save(); page.close(); page = undefined
          }
        } finally { await reader.dispose() }
      }
    }
    return report
  } finally { page?.close(); ipcMain.off('web-source-pipeline:received', listener); host.destroy(); await save() }
}
