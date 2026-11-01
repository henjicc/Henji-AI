import type { CodeAuthorBundle } from '../src/core/videoEdit/codeAuthorProgram'
import type { VideoEditRenderTransport } from '../src/features/videoEdit/engine/videoEditRenderTransport'
import type * as Host from '../src/core/videoEdit/document'
type Harness = typeof Host & { VideoEditRenderTransport: typeof VideoEditRenderTransport; rememberTransientCodeSource: typeof import('../src/core/videoEdit/codeMaterial/sources').rememberTransientCodeSource; makeVideoEditItemClip: typeof import('../src/core/videoEdit/projectItems').makeVideoEditItemClip }
const global = globalThis as typeof globalThis & { preflightBundles: Record<number, CodeAuthorBundle>; preflightPlatform: unknown; preflightLogs: unknown[]; textLayoutExperimentResult: unknown }
const stats = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return { p50: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * .95) - 1] } }
async function run() {
  global.preflightLogs = []
  global.preflightPlatform = { videoDecoder: { status: async () => ({ available: false, forcedBackend: 'browser' }) }, videoFrames: { connect: async () => { throw new Error('专项无媒体解码') } }, fonts: { list: async () => ({ faces: [], revision: 1 }), onChanged: () => () => undefined }, settings: { get: async () => null } }
  const counts = new Map<Worker, Record<string, number>>()
  const WorkerClass = globalThis.Worker
  globalThis.Worker = class extends WorkerClass {
    constructor(url: string | URL, options?: WorkerOptions) { super(url, options); counts.set(this, {}) }
    postMessage(message: unknown, transfer?: Transferable[]): void {
      const kind = (message as { kind?: string }).kind
      if (kind) { const count = counts.get(this)!; count[kind] = (count[kind] ?? 0) + 1 }
      super.postMessage(message, transfer ?? [])
    }
  }
  const rows = [], failures: string[] = []
  const sides = await (await fetch('sides.json')).json() as { baseline: string } & Record<'before' | 'after', { apiVersion: number; library: string }>
  try {
    for (const engine of ['canvas', 'harfbuzz'] as const) {
      const pair = []
      for (const side of ['before', 'after', 'control-a', 'control-b']) {
        const sourceSide = side === 'after' ? 'after' : 'before'
        const apiVersion = engine === 'canvas' ? 7 : sides[sourceSide].apiVersion, version = engine === 'canvas' ? '1.2.0' : sides[sourceSide].library
        const host = await import(/* @vite-ignore */ new URL(`${sourceSide}/host.mjs`, location.href).href) as Harness
        const text = '文字排版播放拖动ABC2026'.repeat(14).slice(0, 200)
        const library = new URL(`${sourceSide}/layout/${version}/text.mjs`, location.href).href
        const code = `import {layoutText,drawText} from ${JSON.stringify(library)}; self.postMessage({kind:'log',level:'info',message:'作者求值',event:'preflight.module',context:{side:${JSON.stringify(side)},apiVersion:${apiVersion}}}); export default {name:'文字流水', params:[{key:'text',type:'text',default:${JSON.stringify(text)}},{key:'offset',type:'number',default:0,min:0,max:100,step:1}], draw(ctx,time,params){const p=layoutText(params.text,{fontSize:32,fill:{color:'#ffffff'}},{wrapWidth:1800});ctx.translate(30,40+params.offset);drawText(ctx,p,{graphemes:(_,i)=>({y:Math.sin(time+i)*5})})}}`
        const resource = { file: 'main.js', usesText: true, declaration: {}, defaults: { text, offset: 0 }, textParameters: ['text'], diagnostics: [] }
        const bundle: CodeAuthorBundle = { code, map: '', locations: { layers: {} }, apiVersion, libraries: { 'henji-layout': version }, textEntry: 'main.js', textFonts: [resource] }
        global.preflightBundles = { [apiVersion]: bundle }
        const document = host.createVideoEditDocument('文字预检'), sequence = host.createVideoEditSequence('配对')
        sequence.width = 1920; sequence.height = 1080
        sequence.tracks.push({ id: 'picture', name: '画面', kind: 'video', index: 0, enabled: true, muted: false, locked: false, solo: false })
        document.sequences.push(sequence)
        const hash = ['a', 'b', 'c', 'd'][pair.length].repeat(64), locationRef = host.rememberTransientCodeSource(hash, code)
        document.codeMaterials = [{ id: 'code', name: '文字', defaultVersionId: 'v', versions: [{ id: 'v', apiVersion, languageVersion: 4, entry: 'main.js', files: [{ path: 'main.js', hash, location: locationRef }], libraries: bundle.libraries }] }]
        document.items.push({ id: 'item', name: '文字', kind: 'code', code: { definitionId: 'code', versionId: 'v', parameters: { text, offset: 0 } } })
        sequence.clips = [host.makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0, duration: 600 }, () => ({ name: '文字', kind: 'generator', mode: 'dynamic', seed: 0, parameters: [] }))]
        const composition = host.videoEditComposition(document, sequence.id)
        // 两侧共用同一系统字体清单和字节，只替换编译/I/O边界；Transport、Worker、作者求值与 GPU 全部为正式代码。
        const fonts = await (await fetch('fonts/fonts.json')).json() as Array<{ family: string; file: string; hash: string; weight: number; aliases?: string[] }>
        const faces = fonts.map(font => ({ id: font.hash, family: font.family, localizedFamily: font.family, fullName: font.family, postscriptName: '', style: 'Regular', weight: font.weight, italic: false, imported: false, supportsCjk: true, category: 'sans-serif' as const, aliases: font.aliases ?? [] }))
        const payloads = new Map<string, Promise<{ face: typeof faces[number]; bytes: Uint8Array }>>()
        global.preflightPlatform = { ...global.preflightPlatform as object, fonts: { list: async () => ({ faces, revision: 1 }), onChanged: () => () => undefined, readFace: async (id: string) => {
          let payload = payloads.get(id)
          if (!payload) { const index = faces.findIndex(face => face.id === id); payload = fetch(`fonts/${fonts[index].file}`).then(async response => ({ face: faces[index], bytes: new Uint8Array(await response.arrayBuffer()) })); payloads.set(id, payload) }
          return payload
        } } }
        const session = new host.VideoEditRenderTransport({ fonts: async () => [], proxies: async () => ({}), maskUpdateTime: () => undefined }, composition, { surface: new OffscreenCanvas(1920, 1080) })
        await session.prepareGpu()
        for (let frame = 0; frame < 12; frame++) await session.present(frame, true)
        pair.push({ side, apiVersion, session, composition, bundle, worker: [...counts.keys()].at(-1)!, playback: [] as number[], scrub: [] as number[], edit: [] as number[], pipeline: [] as number[], samples: [] as Array<{ mode: string; frame: number; elapsed: number; render?: number; stages?: Record<string, number> }>, skipped: 0, pipelineSkipped: 0 })
      }
      try {
        // A/B 与同源码 A/A 四会话逐帧轮换，固定四轮，保留每个完成帧；同源码三会话两两之差估计同样本量下的尾部噪声。
        for (let round = 0; round < 4; round++) for (let i = 0; i < 100; i++) for (const entry of [...pair.slice((i + round) % 4), ...pair.slice(0, (i + round) % 4)]) {
          global.preflightBundles = { [entry.apiVersion]: entry.bundle }
          for (const mode of ['playback', 'scrub', 'edit'] as const) {
            const start = performance.now()
            if (mode === 'edit') {
              entry.composition = { ...entry.composition, revision: entry.composition.revision + 1, clips: entry.composition.clips.map(clip => ({ ...clip, code: { ...clip.code!, parameters: { ...clip.code!.parameters, offset: i % 100 } } })) }
              await entry.session.updateDocument(entry.composition)
            }
            const frame = mode === 'playback' ? i * 2 + 20 : i % 2 ? 120 - i : i
            const replies = [await entry.session.present(frame, mode === 'playback', mode === 'scrub')]
            const elapsed = performance.now() - start
            entry[mode].push(elapsed)
            entry.samples.push({ mode, frame, elapsed, render: replies[0].renderElapsedMs, stages: replies[0].renderStages })
            entry.skipped += replies.filter(reply => reply.skipped).length
          }
        }
        // 双在途另测，避免把基线取消一帧的批次耗时冒充完成两帧的性能。
        for (let i = 0; i < 20; i++) for (const entry of i % 2 ? [...pair].reverse() : pair) {
          global.preflightBundles = { [entry.apiVersion]: entry.bundle }
          const start = performance.now()
          const replies = await Promise.all([entry.session.present(i * 2 + 220, true), entry.session.present(i * 2 + 221, true)])
          entry.pipeline.push(performance.now() - start)
          entry.pipelineSkipped += replies.filter(reply => reply.skipped).length
        }
        const result = pair.map(entry => ({ side: entry.side, apiVersion: entry.apiVersion, playback: stats(entry.playback), scrub: stats(entry.scrub), edit: stats(entry.edit), samples: entry.samples, skipped: entry.skipped, pipeline: stats(entry.pipeline), pipelineSkipped: entry.pipelineSkipped, requests: counts.get(entry.worker) }))
        const comparisons = (['playback', 'scrub', 'edit'] as const).map(mode => {
          const aaPairs = ([[0, 2], [0, 3], [2, 3]] as const).map(([a, b]) => ({ sides: [result[a].side, result[b].side], delta: result[b][mode].p95 - result[a][mode].p95 }))
          const aaRounds = Array.from({ length: 4 }, (_, index) => stats(pair[3][mode].slice(index * 100, (index + 1) * 100)).p95 - stats(pair[2][mode].slice(index * 100, (index + 1) * 100)).p95)
          const noise = Math.max(...aaPairs.map(item => Math.abs(item.delta)))
          const delta = result[1][mode].p95 - result[0][mode].p95
          if (delta > 1.000001 || delta > noise + .000001) failures.push(`${engine} ${mode}: P95 差 ${delta.toFixed(3)}ms，A/A 噪声 ${noise.toFixed(3)}ms，门槛同时 ≤1ms 且在噪声内`)
          return { mode, delta, aaPairs, aaRounds, noise }
        })
        rows.push({ engine, result, comparisons })
        if (result[1].requests?.prepareText && engine === 'canvas') failures.push('旧 API 发送了文字预检')
        if (result[1].skipped || result[1].pipelineSkipped) failures.push(`${engine}: 修复侧丢帧 ${result[1].skipped}`)
      } finally { for (const entry of pair) await entry.session.dispose() }
    }
    return { cases: [], sides, rows, logs: global.preflightLogs, gate: { passed: !failures.length, failures } }
  } finally { globalThis.Worker = WorkerClass }
}
void run().then(result => { global.textLayoutExperimentResult = result }, error => { global.textLayoutExperimentResult = { cases: [], fatal: String(error?.stack ?? error) } })
