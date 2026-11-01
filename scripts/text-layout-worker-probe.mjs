// 仅实验入口安装只读计数器；正式 Worker 与作者库仍使用原始实现。
const memories = new Set()
const instantiate = WebAssembly.instantiate.bind(WebAssembly)
WebAssembly.instantiate = async (...args) => {
  const result = await instantiate(...args), instance = result.instance ?? result
  for (const value of Object.values(instance.exports)) if (value instanceof WebAssembly.Memory) memories.add(value)
  return result
}
const instantiateStreaming = WebAssembly.instantiateStreaming.bind(WebAssembly)
WebAssembly.instantiateStreaming = async (...args) => {
  const result = await instantiateStreaming(...args)
  for (const value of Object.values(result.instance.exports)) if (value instanceof WebAssembly.Memory) memories.add(value)
  return result
}
let fontFaceConstructions = 0
const canvasAllocations = []
const NativeOffscreenCanvas = globalThis.OffscreenCanvas
globalThis.OffscreenCanvas = class extends NativeOffscreenCanvas {
  constructor(width, height) { super(width, height); canvasAllocations.push([this.width, this.height]) }
  get width() { return super.width }
  set width(value) { super.width = value; canvasAllocations.push([this.width, this.height]) }
  get height() { return super.height }
  set height(value) { super.height = value; canvasAllocations.push([this.width, this.height]) }
}
const NativeFontFace = globalThis.FontFace
globalThis.FontFace = class extends NativeFontFace { constructor(...args) { super(...args); fontFaceConstructions++ } }
const { TextShaper } = await import('./worker-shaper.mjs')
const { TextFontSession } = await import('./worker-font-session.mjs')
const selections = [], layouts = []
const post = self.postMessage.bind(self)
self.postMessage = function(message, ...args) { if (message.kind === 'probe.layout') layouts.push(message); return post(message, ...args) }
const choose = TextFontSession.prototype.choose
TextFontSession.prototype.choose = function(chain, text, shaper, options) {
  const result = choose.call(this, chain, text, shaper, options)
  if (new URL(self.location.href).searchParams.get('fallback') === 'true') selections.push({ text, family: chain.candidates.find(candidate => candidate.font === result.font)?.family, hash: result.font.hash, missing: result.missing, glyphs: shaper.shape(result.font, text, options).glyphs.map(glyph => [glyph.id, glyph.cluster, glyph.advance]), chain: chain.identity })
  return result
}
const font = TextShaper.prototype.font, fontInstances = new Map(), fontIds = new WeakMap()
const objects = { fonts: new Map(), faces: new Map(), blobs: new Map() }, objectIds = new WeakMap()
let nextObject = 0
function track(kind, object) {
  if (!objectIds.has(object)) objectIds.set(object, ++nextObject)
  objects[kind].set(objectIds.get(object), new WeakRef(object))
}
let nextFont = 0
TextShaper.prototype.font = function(source, axes) {
  const result = font.call(this, source, axes), key = JSON.stringify([source.hash, source.face ?? 0, source.variations ?? {}, axes ?? {}])
  if (!fontIds.has(result)) fontIds.set(result, ++nextFont)
  const ids = fontInstances.get(key) ?? new Set(); ids.add(fontIds.get(result)); fontInstances.set(key, ids)
  track('fonts', result); track('faces', result.face)
  for (const entry of this.pool.blobs.values()) track('blobs', entry.blob)
  return result
}
await import('./render-worker.mjs')
const timing = await import('./worker-timing.mjs')
self.addEventListener('message', async ({ data }) => {
  if (data.kind !== 'probe.snapshot') return
  if (data.gc) { await new Promise(resolve => setTimeout(resolve, 0)); globalThis.gc?.() }
  const nativeObjects = Object.fromEntries(Object.entries(objects).map(([kind, entries]) => {
    const counts = { alive: 0, disposed: 0, collected: 0 }
    for (const ref of entries.values()) {
      const object = ref.deref()
      if (!object) counts.collected++
      else { try { void object.ptr; counts.alive++ } catch { counts.disposed++ } }
    }
    return [kind, counts]
  }))
  self.postMessage({ kind: 'probe.snapshot', id: data.id, selections: selections.splice(0), layouts: layouts.splice(0), wasmBytes: [...memories].map(memory => memory.buffer.byteLength), nativeObjects, gcAvailable: typeof globalThis.gc === 'function', fontInstances: Object.fromEntries([...fontInstances].map(([key, ids]) => [key, ids.size])), fontFaceConstructions, canvasAllocations: canvasAllocations.splice(0), stages: timing.videoEditPreparationSnapshot() })
})
self.postMessage({ kind: 'probe.ready' })
