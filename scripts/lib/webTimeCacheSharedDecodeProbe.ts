import { app, BrowserWindow, ipcMain, sharedTexture } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { VideoDecoderService } from '../../electron/main/services/video-decoder/client'
import { VideoFrameBridge, type VideoFrameTarget } from '../../electron/main/services/video-decoder/texture-bridge'
import { createMainLogger } from '../../electron/main/services/logging/main-logger'
import { queryLogEvents } from '../../electron/main/services/logging/query'
import { appendLogEvents } from '../../electron/main/services/logging/push'

interface Frame { ticket: string; width: number; height: number; png?: Uint8Array; error?: string }
interface Segment { file: string; name: string; segment: { frameCount: number }; grid: { rate: { numerator: number; denominator: number } } }

/** 独立开段真值与共享会话往返结果逐字节比较，覆盖实际纹理交付而非只检查 found。 */
export async function sharedDecodeProbe(output: string, executable: string, segments: Segment[]): Promise<unknown> {
  const logger = createMainLogger('main.web_source'), afterTimestamp = new Date().toISOString()
  const service = new VideoDecoderService({ resolveExecutable: () => executable, logger, heartbeatIntervalMs: 0 })
  const bridge = new VideoFrameBridge({ service, sharedTexture, logger })
  const host = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
    preload: path.join(output, 'preload', 'decode.cjs'), backgroundThrottling: false } })
  const target: VideoFrameTarget = { id: host.webContents.id, get mainFrame() { return host.webContents.mainFrame }, isDestroyed: () => host.isDestroyed(),
    send: (channel, payload) => host.webContents.send(channel, payload), onGone: listener => {
      const gone = (): void => listener('closed'); host.once('closed', gone); return () => { host.off('closed', gone) }
    } }
  const pending = new Map<string, (frame: Frame) => void>(), results: unknown[] = []
  let serial = 0
  const listener = (event: Electron.IpcMainEvent, frame: Frame): void => { if (event.sender.id === target.id) pending.get(frame.ticket)?.(frame) }
  ipcMain.on('web-cache-probe:decoded', listener)
  const read = async (streamId: string, time: number): Promise<{ hash: string; ms: number; ptsUs: number | undefined }> => {
    const ticket = `segment-${serial++}`, started = performance.now()
    let timer: ReturnType<typeof setTimeout> | undefined
    const delivered = new Promise<Frame>((resolve, reject) => {
      pending.set(ticket, resolve); timer = setTimeout(() => reject(new Error('共享段纹理未交付')), 15000)
    })
    try {
      const [result, frame] = await Promise.all([bridge.frameAt(target.id, { streamId, ticket, time }), delivered])
      if (!result.found || frame.error || !frame.png || frame.width !== 258 || frame.height !== 260) throw new Error(`共享段结果错误：${JSON.stringify({ result, frame: { ...frame, png: undefined } })}`)
      return { hash: crypto.createHash('sha256').update(frame.png).digest('hex'), ms: performance.now() - started, ptsUs: result.ptsUs }
    } finally { clearTimeout(timer); pending.delete(ticket) }
  }
  try {
    await host.loadURL('data:text/html,<title>Shared segment decode</title>')
    for (const rate of [60, 30000]) {
      const pair = segments.filter(segment => segment.grid.rate.numerator === rate)
      if (pair.length !== 2) throw new Error('缺少同变体的两个独立段')
      const interval = pair[0].grid.rate.denominator / rate
      const truths = []
      for (const segment of pair) {
        const opened = await bridge.openDecoder(target, { route: 'shared-probe', path: segment.file, purpose: 'seek', hardware: 'auto', format: 'rgbaf16', poolSize: 2 })
        if (!opened.decoder.hardware || opened.decoder.path !== 'cuda_planar') throw new Error('共享段真值没有走硬解')
        const frames = []
        for (let frame = 0; frame < Math.min(3, segment.segment.frameCount); frame++) frames.push(await read(opened.streamId, frame * interval))
        truths.push(frames)
        await bridge.closeStream(opened.streamId)
      }
      const opened = await bridge.openDecoder(target, { route: 'shared-probe', path: pair[1].file, purpose: 'seek', hardware: 'auto', format: 'rgbaf16', poolSize: 2 })
      const switches = []
      for (const index of [0, 1, 0, 1, 0]) {
        const started = performance.now()
        await service.setDecoderSegment(opened.streamId, pair[index].file)
        const switchMs = performance.now() - started
        for (const frame of [0, 2, 1, 0].filter(frame => frame < pair[index].segment.frameCount)) {
          const actual = await read(opened.streamId, frame * interval)
          if (actual.hash !== truths[index][frame].hash || actual.ptsUs !== truths[index][frame].ptsUs) throw new Error(`跨段/倒退结果与独立解码不符 ${rate}/${index}/${frame}`)
          switches.push({ segment: index, frame, switchMs, ...actual })
        }
        const stats = await service.stats()
        if (stats.streams.length !== 1) throw new Error('跨段创建了额外原生会话')
      }
      let incompatibleRejected = false
      const other = segments.find(segment => segment.grid.rate.numerator !== rate)!
      try { await service.setDecoderSegment(opened.streamId, other.file) } catch { incompatibleRejected = true }
      if (!incompatibleRejected || (await read(opened.streamId, 0)).hash !== truths[0][0].hash) throw new Error('拒绝不兼容段时破坏了原会话')
      let missingRejected = false
      try { await service.setDecoderSegment(opened.streamId, path.join(output, 'missing.mp4')) } catch { missingRejected = true }
      if (!missingRejected || (await read(opened.streamId, 0)).hash !== truths[0][0].hash) throw new Error('缺失段破坏了原会话')
      results.push({ rate, opened, switches, incompatibleRejected, missingRejected, stats: await service.stats() })
      await bridge.closeStream(opened.streamId)
    }
    const afterClose = await service.stats()
    if (afterClose.streams.length) throw new Error('共享段解码未清理')
    await appendLogEvents([{ timestamp: new Date().toISOString(), level: 'debug', domain: 'main.web_source', event: 'web_source.probe.completed', message: '共享段解码专项完成', source: 'backend' }])
    const logs = await queryLogEvents({ date: new Date().toISOString().slice(0, 10), afterTimestamp, domainPrefix: 'main.web_source', limit: 1000 })
    if (logs.corruptedLines || logs.events.filter(event => event.event === 'video_decoder.native.decode.segment.completed').length !== 10) throw new Error('共享段切换日志未完整读回')
    await fs.writeFile(path.join(output, 'shared-segment-logs.json'), JSON.stringify(logs))
    return { results, afterClose, logs, environment: { versions: process.versions, gpu: await app.getGPUInfo('basic') } }
  } finally { ipcMain.off('web-cache-probe:decoded', listener); await bridge.dispose(); await service.shutdown(); host.destroy() }
}
