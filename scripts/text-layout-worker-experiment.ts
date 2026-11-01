import { serveFontChannel, type FontPort } from '../src/core/imaging/vectorContent/shaping/fontChannel'
import { fontRequestKey } from '../src/core/imaging/vectorContent/shaping/fontSession'
import { createVideoEditDocument, createVideoEditSequence, videoEditComposition } from '../src/core/videoEdit/document'
import type { RenderRequest, RenderResponse } from '../src/features/videoEdit/engine/videoEditWorker'
import type { CodeAuthorBundle } from '../src/core/videoEdit/codeAuthorProgram'

export interface Font { family: string; aliases?: string[]; file: string; hash: string; weight: number; bytes: number; variations?: Record<string, number> }
type Mode = 'static' | 'pose' | 'appearance' | 'zoom'
interface Snapshot { selections: Array<{ text: string; family?: string; hash: string; missing: boolean; glyphs: number[][]; chain: string }>; layouts: Array<{ caseId: string; lines: Array<{ start: number; end: number; width: number }>; graphemes: Array<{ text: string; source: { start: number; end: number } }>; diagnostics: unknown[]; fingerprint: { digest?: string; fallback?: string } }>;  canvasAllocations: number[][]; wasmBytes: number[]; fontInstances: Record<string, number>; fontFaceConstructions: number; nativeObjects: Record<string, { alive: number; disposed: number; collected: number }>; gcAvailable: boolean; stages: Record<string, { count: number; ms: number }> }
const output = globalThis as typeof globalThis & { textLayoutExperimentResult: unknown }
const stats = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return { p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1) } }
export async function openHarness(fonts: Font[], delayRead?: () => Promise<void>, width = 1920, height = 1080) {
  const worker = new Worker(new URL('worker-probe.mjs' + (['fallback', 'dynamic'].includes(new URL(location.href).searchParams.get('phase') ?? '') ? '?fallback=true' : ''), location.href), { type: 'module' })
  const pending = new Map<number, { resolve(value: RenderResponse): void; reject(error: Error): void }>()
  const probes = new Map<number, (snapshot: Snapshot) => void>()
  let readyResolve!: () => void, readyReject!: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject })
  const logs: unknown[] = [], reads: Array<{ requestKey: string; family: string; bytes: number; ms: number }> = []
  let next = 0, snapshotsClosed = 0
  worker.onerror = event => { const error = new Error(event.message); readyReject(error); for (const request of pending.values()) request.reject(error); pending.clear() }
  worker.onmessage = ({ data }) => {
    if (data.kind === 'probe.ready') { readyResolve(); return }
    if (data.kind === 'probe.snapshot') { probes.get(data.id)?.(data); probes.delete(data.id); return }
    if (data.kind === 'log') { logs.push(data); return }
    if (data.kind === 'code.trust') {
      worker.postMessage({ kind: 'code.trustResult', token: data.token, ...(data.request.context?.length ? { error: '实验只运行本机创建的无外来标记代码' } : {}) }); return
    }
    if (data.kind === 'code.metadata') { worker.postMessage({ kind: 'code.metadataResult', token: data.token }); return }
    const request = pending.get(data.id)
    if (request) { pending.delete(data.id); if (data.error) request.reject(new Error(data.error)); else request.resolve(data) }
  }
  const send = (request: RenderRequest): Promise<RenderResponse> => new Promise((resolve, reject) => {
    const id = ++next
    pending.set(id, { resolve, reject }); worker.postMessage({ ...request, id })
  })
  const port = new MessageChannel()
  const stop = serveFontChannel(port.port1 as unknown as FontPort, async () => { const capturedFonts = fonts.map(font => ({ ...font })); return { platform: 'win32', revision: 1, close: () => { snapshotsClosed++ }, read: async request => {
    const family = request.family === 'sans-serif' ? 'Arial' : request.family
    const matches = (font: Font): boolean => font.family === family || !!font.aliases?.includes(family)
    const font = capturedFonts.find(font => matches(font) && font.weight === (request.weight ?? 400)) ?? capturedFonts.find(matches)
    if (!font) return undefined
    const start = performance.now(), bytes = await (await fetch(font.file)).arrayBuffer()
    await delayRead?.()
    reads.push({ requestKey: fontRequestKey(request), family, bytes: bytes.byteLength, ms: performance.now() - start })
    return { bytes, variations: font.variations }
  } } }, error => logs.push({ fontError: String(error) }))
  await ready
  worker.postMessage({ kind: 'textFonts.attach', port: port.port2 }, [port.port2])
  const doc = createVideoEditDocument('文字实验'), sequence = createVideoEditSequence(); sequence.width = width; sequence.height = height; doc.sequences.push(sequence)
  const started = performance.now()
  await send({ id: 0, kind: 'init', document: videoEditComposition(doc, sequence.id), diagnostics: true })
  const initMs = performance.now() - started
  const snapshot = (gc = false): Promise<Snapshot> => new Promise(resolve => { const id = ++next; probes.set(id, resolve); worker.postMessage({ kind: 'probe.snapshot', id, gc }) })
  const bundleFor = (family: string, count = 20, mode: Mode = 'pose', apiVersion: 7 | 10 = 10): CodeAuthorBundle => {
    const weight = fonts.find(font => font.family === family)?.weight ?? 400
    const text = '文字排版中文首帧ABC2026'.repeat(Math.ceil(count / 15)).slice(0, count)
    const code = `import {layoutText,drawText} from ${JSON.stringify(new URL(apiVersion === 10 ? 'author-text.mjs' : 'layout-1.2.0/text.mjs', location.href).href)}; import {recordVideoEditPreparation as record} from ${JSON.stringify(new URL('worker-timing.mjs', location.href).href)}; const now=performance.now.bind(performance); const p=layoutText(${JSON.stringify(text)},{fontFamily:${JSON.stringify(family)},fontWeight:${weight},fontSize:32,align:'left',fill:{color:'#ffffff'}${mode === 'appearance' || mode === 'zoom' ? ",strokes:[{enabled:true,color:'#ff8844',width:2,position:'outside'}],shadows:[{enabled:true,color:'#000000',opacity:.7,blur:3,distance:4,angle:45,size:0}]" : ''}},{wrapWidth:${width - 120},anchor:{x:40,y:40,horizontal:0,vertical:0}}); export default {name:'字体实验',draw(ctx,time){const start=now();${mode === 'zoom' ? 'ctx.scale(1+Math.min(1,time)*7,1+Math.min(1,time)*7);' : ''}drawText(ctx,p,${mode === 'static' || mode === 'zoom' ? '{}' : '{graphemes:(_,i)=>({y:Math.sin(time+i)*5})}'});record('experimentAuthorDraw',now()-start)}}`
    return { code, map: '', locations: { layers: {} }, apiVersion, ...(apiVersion >= 10 ? { libraries: { 'henji-layout': '2.0.0' } } : {}), textEntry: 'main.js', textFonts: [{ file: 'main.js', declaration: { faces: [{ family, weight }], text: [text] }, diagnostics: [] }] }
  }
  const frame = (url: string, bundle: CodeAuthorBundle, time = 0): Promise<RenderResponse> => send({ id: 0, kind: 'authorFrame', url, params: {}, info: { time, frameDuration: 1 / 30, clip: { time: 0, duration: 10 } }, options: { apiVersion: bundle.apiVersion, bundle } })
  const load = async (family: string, name: string, count = 20, mode: Mode = 'pose', apiVersion: 7 | 10 = 10) => {
    const bundle = bundleFor(family, count, mode, apiVersion), before = reads.length, begin = performance.now()
    await send({ id: 0, kind: 'authorMetadata', url: name, apiVersion, bundle })
    const ready = performance.now(), result = await frame(name, bundle), first = performance.now()
    const canvas = new OffscreenCanvas(sequence.width, sequence.height), ctx = canvas.getContext('2d')!
    ctx.drawImage(result.bitmap!, 0, 0); result.bitmap!.close()
    const inkPixels = ctx.getImageData(0, 0, sequence.width, sequence.height).data.reduce((sum, value, index) => sum + Number(index % 4 !== 3 && value > 0), 0)
    return { family, bundle, name, prepareMs: ready - begin, firstFrameMs: first - begin, frameMs: first - ready, gpuMs: result.gpuMs, inkPixels, reads: reads.slice(before), snapshot: await snapshot() }
  }
  let closing: Promise<{ snapshotsClosed: number; snapshot: Snapshot; afterGc: Snapshot }> | undefined
  return { send, load, frame, snapshot, initMs, reads, logs,
    release: (url: string) => send({ id: 0, kind: 'authorRelease', url }),
    close: () => closing ??= (async () => { try { await send({ id: 0, kind: 'dispose' }); const final = await snapshot(), afterGc = await snapshot(true); return { snapshotsClosed, snapshot: final, afterGc } } finally { stop(); worker.terminate() } })(),
  }
}
async function run(): Promise<unknown> {
  const fonts: Font[] = await (await fetch('fonts.json')).json()
  if (new URL(location.href).searchParams.get('phase') === 'dynamic') return (await import('./text-layout-dynamic-experiment')).runDynamicTextExperiment(fonts, await openHarness(fonts, undefined, 640, 240))
  if (new URL(location.href).searchParams.get('phase') === 'fallback') return (await import('./text-layout-fallback-experiment')).runFallbackExperiment(fonts, await openHarness(fonts, undefined, 640, 240))
  if (new URL(location.href).searchParams.get('phase') === 'frames') {
    const host = await openHarness(fonts), rows = [], failures: string[] = []
    const font = fonts.find(font => font.family === 'Noto Sans SC')!
    try {
      // 旧库按正式 FontFace 通道装载与 HB 完全相同的 SFNT；准备不计入热帧。
      await host.send({ id: 0, kind: 'fonts', availableIds: [font.hash], reset: false, fonts: [{
        face: { id: font.hash, family: font.family, localizedFamily: font.family, fullName: '', postscriptName: '', aliases: [], style: 'Regular', weight: font.weight, italic: false, imported: false, supportsCjk: true, category: 'sans-serif' },
        bytes: new Uint8Array(await (await fetch(font.file)).arrayBuffer()),
      }] })
      for (const mode of ['pose', 'static'] as const) {
        const pair = await Promise.all([7, 10].map(async version => {
          const apiVersion = version as 7 | 10, name = `${mode}-${apiVersion}`
          return { apiVersion, loaded: await host.load(font.family, name, 200, mode, apiVersion), samples: [] as Array<{ frameMs: number; drawMs: number; recordMs: number; surfaceMs: number; rasterMs: number; uploadMs: number; textMs: number; textureReused: number }> }
        }))
        let before = await host.snapshot()
        for (let sample = 0; sample < 35; sample++) {
          // 相邻样本换先后顺序，使每对时间相同且两个引擎交替承担先测成本。
          for (const branch of sample % 2 ? [...pair].reverse() : pair) {
            const begin = performance.now(), result = await host.frame(branch.loaded.name, branch.loaded.bundle, (sample + 1) / 30)
            const frameMs = performance.now() - begin
            result.bitmap!.close()
            const after = await host.snapshot()
            const delta = (stage: string): number => (after.stages[stage]?.ms ?? 0) - (before.stages[stage]?.ms ?? 0)
            const drawMs = delta('experimentAuthorDraw'), recordMs = delta('experimentRecord'), surfaceMs = delta('experimentSurface'), rasterMs = delta('authorRaster'), uploadMs = delta('authorUpload')
            if ((after.stages.experimentRecord?.count ?? 0) - (before.stages.experimentRecord?.count ?? 0) !== 1 || (after.stages.experimentSurface?.count ?? 0) - (before.stages.experimentSurface?.count ?? 0) !== 1) throw new Error('文字阶段必须恰好覆盖一次录制与一次表面准备')
            if (sample >= 5) branch.samples.push({ frameMs, drawMs, recordMs, surfaceMs, rasterMs, uploadMs, textMs: recordMs + surfaceMs, textureReused: (after.stages.authorRasterReused?.count ?? 0) - (before.stages.authorRasterReused?.count ?? 0) })
            before = after
          }
        }
        const summaries = pair.map(({ apiVersion, loaded, samples }) => ({ apiVersion, firstFrameMs: loaded.firstFrameMs, inkPixels: loaded.inkPixels, samples, frame: stats(samples.map(s => s.frameMs)), draw: stats(samples.map(s => s.drawMs)), record: stats(samples.map(s => s.recordMs)), surface: stats(samples.map(s => s.surfaceMs)), raster: stats(samples.map(s => s.rasterMs)), upload: stats(samples.map(s => s.uploadMs)), text: stats(samples.map(s => s.textMs)) }))
        const [baseline, candidate] = summaries
        const deltaP95 = candidate.text.p95! - baseline.text.p95!
        const passed = summaries.every(row => row.inkPixels > 0) && (mode === 'pose' ? candidate.text.p95! <= 6 && deltaP95 <= 1 : candidate.text.p95! <= 4)
        rows.push({ mode, count: 200, width: 1920, height: 1080, summaries, deltaP95, passed })
        for (const branch of pair) await host.release(branch.loaded.name)
        if (!passed) { failures.push(`${mode}: API8 P95=${candidate.text.p95}ms，1.2.0 P95=${baseline.text.p95}ms，差=${deltaP95}ms`); break }
      }
      return { cases: [], experiment5Paired: { font, pipeline: '正式 Worker 专项优化构建；每帧文字阶段=录制（含作者draw及比对）+表面准备（含边界、栅格、上传）；子项不可重复相加；不含合成/GPU等待', warmupPairs: 5, measuredPairs: 30, rows }, gate: { passed: !failures.length, failures }, notRun: ['完整实验5矩阵及实验6–8'] }
    } finally { await host.close() }
  }
  if (['matrix', 'appearance'].includes(new URL(location.href).searchParams.get('phase') ?? '')) {
    const appearanceOnly = new URL(location.href).searchParams.get('phase') === 'appearance'
    const rows = [], captures = [], failures: string[] = []
    const report = () => ({ cases: [], experiment5Matrix: { rows, playback: '连续请求成本及超过30fps预算帧数；不是完整播放器跳帧结论' }, captures, gate: { passed: !failures.length, failures } })
    const capture = (bitmap: ImageBitmap, name: string): { inkPixels: number; dataUrl: string; name: string } => {
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0)
      const inkPixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data.reduce((sum, value, index) => sum + Number(index % 4 !== 3 && value > 0), 0)
      return { name, inkPixels, dataUrl: canvas.toDataURL() }
    }
    for (const [width, height] of [[1920, 1080], [3840, 2160]]) {
      const host = await openHarness(fonts, undefined, width, height)
      try {
        const font = fonts.find(font => font.family === 'Noto Sans SC')!
        await host.send({ id: 0, kind: 'fonts', availableIds: [font.hash], reset: false, fonts: [{ face: { id: font.hash, family: font.family, localizedFamily: font.family, fullName: '', postscriptName: '', aliases: [], style: 'Regular', weight: font.weight, italic: false, imported: false, supportsCjk: true, category: 'sans-serif' }, bytes: new Uint8Array(await (await fetch(font.file)).arrayBuffer()) }] })
        for (const count of [20, 200, 1000]) for (const mode of ['static', 'pose', 'appearance'] as const) {
          if (appearanceOnly && mode !== 'appearance') continue
          for (const apiVersion of [7, 10] as const) {
            const name = `${width}-${count}-${mode}-${apiVersion}`, loaded = await host.load(font.family, name, count, mode, apiVersion), samples = []
            if (mode === 'appearance' && count === 20) {
              const frame = await host.frame(name, loaded.bundle, 0)
              captures.push(capture(frame.bitmap!, name)); frame.bitmap!.close()
            }
            if (!loaded.inkPixels) {
              rows.push({ width, height, count, mode, apiVersion, inkPixels: loaded.inkPixels, snapshot: loaded.snapshot, firstFrameMs: loaded.firstFrameMs, failedBeforeMeasurement: true })
              failures.push(`${name}: 首帧无墨迹，停止热帧及后续场景`)
              return report()
            }
            let before = await host.snapshot()
            for (let index = 0; index < 35; index++) {
              const started = performance.now(), frame = await host.frame(name, loaded.bundle, (index + 1) / 30), frameMs = performance.now() - started
              frame.bitmap!.close()
              const after = await host.snapshot(), delta = (stage: string) => (after.stages[stage]?.ms ?? 0) - (before.stages[stage]?.ms ?? 0)
              if ((after.stages.experimentRecord?.count ?? 0) - (before.stages.experimentRecord?.count ?? 0) !== 1 || (after.stages.experimentSurface?.count ?? 0) - (before.stages.experimentSurface?.count ?? 0) !== 1) {
                failures.push(`${name}: 文字阶段未完整计量`); return report()
              }
              if (index >= 5) samples.push({ frameMs, drawMs: delta('experimentAuthorDraw'), recordMs: delta('experimentRecord'), surfaceMs: delta('experimentSurface'), rasterMs: delta('authorRaster'), uploadMs: delta('authorUpload'), textMs: delta('experimentRecord') + delta('experimentSurface'), reused: (after.stages.authorRasterReused?.count ?? 0) - (before.stages.authorRasterReused?.count ?? 0), allocations: after.canvasAllocations })
              before = after
            }
            rows.push({ width, height, count, mode, apiVersion, inkPixels: loaded.inkPixels, firstFrameMs: loaded.firstFrameMs, samples, text: stats(samples.map(s => s.textMs)), frame: stats(samples.map(s => s.frameMs)), draw: stats(samples.map(s => s.drawMs)), raster: stats(samples.map(s => s.rasterMs)), upload: stats(samples.map(s => s.uploadMs)), over30fpsBudget: samples.filter(s => s.frameMs > 1000 / 30).length })
            if (apiVersion === 10 && samples.some(s => s.allocations.some(([w, h]) => w >= width && h >= height))) { failures.push(`${name}: 热帧整画布分配`); return report() }
            await host.release(name)
          }
        }
        if (!appearanceOnly && width === 1920) for (const apiVersion of [7, 10] as const) {
          const name = `zoom-${apiVersion}`, loaded = await host.load(font.family, name, 20, 'zoom', apiVersion), samples = []
          if (!loaded.inkPixels) { failures.push(`${name}: 首帧无墨迹`); return report() }
          for (const time of [0, 1 / 7, 3 / 7, 1, 1]) {
            const frame = await host.frame(name, loaded.bundle, time), snapshot = await host.snapshot()
            const shot = capture(frame.bitmap!, `${name}-${samples.length}`); frame.bitmap!.close()
            captures.push(shot)
            if (!shot.inkPixels) { failures.push(`${name}: ${1 + time * 7}倍帧无墨迹`); return report() }
            samples.push({ scale: 1 + time * 7, allocations: snapshot.canvasAllocations })
          }
          rows.push({ mode: 'zoom', apiVersion, samples })
          if (apiVersion === 10 && samples.at(-1)!.allocations.length) { failures.push('推近落定重复分配外观栅格'); return report() }
          await host.release(name)
        }
      } finally { await host.close() }
      if (failures.length) break
    }
    return report()
  }
  if (new URL(location.href).searchParams.get('phase') === 'lifecycle') {
    let enteredResolve!: () => void, releaseRead!: () => void
    const entered = new Promise<void>(resolve => { enteredResolve = resolve }), delayed = new Promise<void>(resolve => { releaseRead = resolve })
    const late = await openHarness(fonts, async () => { enteredResolve(); await delayed })
    const loading = late.load('Noto Sans SC', 'late').then(() => 'unexpected-success', error => String(error))
    await entered
    const close = await late.close(), rejection = await loading
    releaseRead(); await new Promise(resolve => setTimeout(resolve, 0))
    const shared = await openHarness(fonts)
    try {
      const first = await shared.load('Noto Sans SC', 'one'), second = await shared.load('Noto Sans SC', 'two')
      const loaded = [first, second]
      const keys = shared.reads.map(read => read.requestKey), duplicateReads = keys.filter((key, index) => keys.indexOf(key) !== index)
      const wasmGrowth = second.snapshot.wasmBytes.reduce((sum, bytes) => sum + bytes, 0) - first.snapshot.wasmBytes.reduce((sum, bytes) => sum + bytes, 0)
      const fontBytes = fonts.find(font => font.family === 'Noto Sans SC')!.bytes
      const duplicateFontStorage = Object.entries(second.snapshot.fontInstances).some(([key, count]) => first.snapshot.fontInstances[key] && count > first.snapshot.fontInstances[key])
      await shared.release(first.name)
      const remaining = await shared.frame(second.name, second.bundle, 1)
      remaining.bitmap!.close()
      const afterFirstRelease = await shared.snapshot()
      await shared.release(second.name)
      const afterBothRelease = await shared.snapshot()
      const rebuilt = await shared.load('Noto Sans SC', 'rebuilt')
      const closed = await shared.close()
      const wasmReuse = rebuilt.snapshot.wasmBytes.reduce((sum, bytes) => sum + bytes, 0) === second.snapshot.wasmBytes.reduce((sum, bytes) => sum + bytes, 0)
      const released = Object.values(closed.snapshot.nativeObjects).every(counts => counts.alive === 0)
      return { cases: [], experiment4Lifecycle: { rejection, lateClosed: close, duplicateReads, wasmGrowth, fontBytes, duplicateFontStorage, twoMaterials: loaded.map(({ bundle: _bundle, ...item }) => item), afterFirstRelease, afterBothRelease, rebuilt: { inkPixels: rebuilt.inkPixels, snapshot: rebuilt.snapshot }, wasmReuse, released, closed }, gate: { passed: rejection.includes('释放') && close.snapshotsClosed === 1 && !duplicateReads.length && !duplicateFontStorage && loaded.every(item => item.inkPixels > 0 && !item.snapshot.fontFaceConstructions) && rebuilt.inkPixels > 0 && released && wasmReuse && closed.snapshotsClosed === 1 } }
    } finally { await shared.close() }
  }
  const report: Record<string, unknown> = { pipeline: '正式 videoEditWorker / authorMetadata / authorFrame；隔离 Electron；专项 esbuild 生产优化构建', diskCache: '未清理操作系统磁盘缓存' }
  const cold = [], failures: string[] = []
  const lag: number[] = []; let last = performance.now()
  const timer = setInterval(() => { const now = performance.now(); lag.push(Math.max(0, now - last - 16)); last = now }, 16)
  try {
    for (let sample = 0; sample < 35; sample++) {
      const host = await openHarness(fonts)
      try {
        const { bundle: _bundle, ...result } = await host.load('Noto Sans SC', 'cold')
        const close = await host.close()
        if (!result.inkPixels || result.snapshot.fontFaceConstructions || close.snapshotsClosed !== 1) failures.push(`cold-${sample}`)
        if (sample >= 5) cold.push({ ...result, initMs: host.initMs, close })
      } catch (error) { await host.close(); throw error }
    }
    report.cold = { samples: cold, prepare: stats(cold.map(item => item.prepareMs)), firstFrame: stats(cold.map(item => item.firstFrameMs)) }
    const host = await openHarness(fonts)
    try {
      const warm = [], a = await host.load('Noto Sans SC', 'a'), readsBefore = host.reads.length
      for (let sample = 0; sample < 35; sample++) {
        const { bundle: _bundle, ...item } = await host.load('Noto Sans SC', `warm-${sample}`)
        if (sample >= 5) warm.push(item)
        await host.release(item.name)
      }
      const readsAfter = host.reads.length, resident = await host.snapshot()
      if (readsAfter !== readsBefore || warm.some(item => !item.inkPixels)) failures.push('同 Worker 同字体重复准备或空白帧')
      const switched = []
      for (const family of ['Noto Sans JP', 'TicketCJK', 'SimSun-ExtB', 'Segoe UI Emoji']) {
        const { bundle: _bundle, ...item } = await host.load(family, family)
        switched.push(item); await host.release(item.name)
      }
      await host.release(a.name)
      report.warm = { samples: warm, prepare: stats(warm.map(item => item.prepareMs)), firstFrame: stats(warm.map(item => item.firstFrameMs)), newFontReads: readsAfter - readsBefore, resident }
      report.switches = switched
      report.closed = await host.close()
      if (switched.some(item => !item.inkPixels || item.snapshot.fontFaceConstructions) || (report.closed as { snapshotsClosed: number }).snapshotsClosed !== 1) failures.push('切换字体或关闭失败')
    } catch (error) { await host.close(); throw error }
    const pair = await Promise.all([openHarness(fonts), openHarness(fonts)])
    try {
      const results = await Promise.all(pair.map((host, index) => host.load('Noto Sans SC', `parallel-${index}`)))
      report.parallel = results.map(({ bundle: _bundle, ...item }) => item)
      if (results.some(item => !item.inkPixels || item.snapshot.fontFaceConstructions)) failures.push('两 Worker 字体准备或出帧失败')
    } finally { const closed = await Promise.all(pair.map(host => host.close())); report.parallelClosed = closed; if (closed.some(item => item.snapshotsClosed !== 1)) failures.push('双 Worker 关闭失败') }
    report.mainThreadLagMs = stats(lag)
    return { cases: [], experiment4: report, gate: { passed: failures.length === 0, failures }, notRun: ['实验5–8：等待实验4完整性复核'] }
  } catch (error) { return { cases: [], experiment4: report, gate: { passed: false }, fatal: String(error) } }
  finally { clearInterval(timer) }
}
run().then(result => { output.textLayoutExperimentResult = result }).catch(error => { output.textLayoutExperimentResult = { cases: [], fatal: String(error) } })
