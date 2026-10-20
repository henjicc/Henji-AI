const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')

// Planned inputs, not acceptance results; each entry needs the native timeline evidence.
const YOGA_AUTHOR_BATCHES = [
  ['11105410', '14937101', '14027410', '6921525', '2094695'],
  // First five remaining effects in the actual main sequence's appearance order.
  ['6314410', '13815500', '146814', '7701821', '9642704'],
  ['9049942', '13119842', '1845381', '4715265', '8250556'],
  ['764366', '15048341', '1270546', '3295436', '15969942'],
  ['15934198', '11711573', '16756797', '5880153', '8335157'],
]
const digest = source => crypto.createHash('sha256').update(source).digest('hex')
// Exercise the image panel after its entrance, not just the opening title.
const ACTIVE_SAMPLE_TIMES = { '9049942': 7.5 }

/** Read the runtime bundles actually consumed by PR, not possibly stale editable directories. */
async function readYogaAuthors(root) {
  const effects = []
  for (const file of fs.readdirSync(root).filter(file => /_\d+\.js$/.test(file)).sort()) {
    const source = fs.readFileSync(path.join(root, file), 'utf8')
    const effect = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default
    assert.ok(effect && typeof effect.name === 'string', `缺少作者模块：${file}`)
    effects.push({ id: /_(\d+)\.js$/.exec(file)[1], file, name: effect.name, kind: effect.kind ?? 'generator', params: effect.params ?? [], source, hash: digest(source) })
  }
  assert.equal(effects.length, 25, 'YOGA 原始运行源码清单已改变，不能静默漏迁')
  return effects
}

/** PR parameter mapping is a saved index into the native control pool, not the displayed label. */
function yogaInstanceParameters(effect, bridge, root) {
  const scalar = id => bridge.parameters.find(parameter => Number(parameter.ParameterID) === id)
  const value = parameter => parameter?.StartKeyframe?.split(',')[1]
  const configuration = Number(value(scalar(387)) ?? 0)
  const content = configuration ? JSON.parse(fs.readFileSync(path.join(root, '配置', `${configuration}.json`), 'utf8')).values : {}
  const params = {}, assets = {}
  effect.params.forEach((parameter, index) => {
    let current = content[parameter.key] ?? parameter.default
    if (!['image', 'text', 'color'].includes(parameter.type)) {
      const mapped = Number(value(scalar(35 + index)))
      const native = scalar(mapped >= 50 ? mapped + 1 : index + 2)
      assert.ok(!native?.Keyframes, `参数动画需要精确迁移：${effect.name}/${parameter.key}`)
      if (native) current = Number(value(native))
      if (parameter.type === 'boolean') current = Boolean(current)
      if (parameter.type === 'select') current = parameter.options[current]?.value
    }
    if (parameter.type === 'image') {
      if (!current) return
      const reference = /^素材\/([a-f0-9]+)@/.exec(current)
      assert.ok(reference, `无法解析图片绑定：${effect.name}/${parameter.key}`)
      const media = JSON.parse(fs.readFileSync(path.join(root, '素材引用', `${reference[1]}.json`), 'utf8'))
      assert.ok(!media.offline && fs.existsSync(media.file), `原图片缺失：${media.name}`)
      assets[parameter.key] = media.file
    } else params[parameter.key] = current
  })
  return { params, assets }
}

/** A reproducible batch input for the existing candidate + formal Electron scene. */
async function prepareYogaAuthorBatch(root, graph, output, batch = 0, options = {}) {
  const effects = await readYogaAuthors(root)
  const selected = YOGA_AUTHOR_BATCHES[batch]; assert.ok(selected, '未登记的迁移批次')
  const entries = []
  for (const id of selected) {
    const effect = effects.find(effect => effect.id === id); assert.ok(effect)
    const uses = graph.sequences.flatMap(sequence => sequence.tracks.flatMap(track => track.clips.flatMap(clip => (clip.effects ?? []).filter(bridge => bridge.matchName === 'AE.FrameFlow Bridge' && bridge.parameters.some(parameter => parameter.Name === '实例 ID' && parameter.StartKeyframe?.split(',')[1] === id)).map(bridge => ({ sequence, clip, bridge })))))
    uses.sort((a, b) => Number(b.sequence.id === graph.mainSequenceId) - Number(a.sequence.id === graph.mainSequenceId) || Number(a.clip.start) - Number(b.clip.start))
    const use = uses[0]
    // Isolated filters may sample the global sequence clock beyond their first clip's duration.
    const duration = options.durations?.[id] ?? (use ? (Number(use.clip.end) - Number(use.clip.start)) / 254016000000 : 6)
    const bindings = use ? yogaInstanceParameters(effect, use.bridge, root) : { params: {}, assets: {} }
    const directory = path.join(output, id); fs.mkdirSync(directory, { recursive: true })
    const sourceFile = path.join(directory, 'original.js'); fs.writeFileSync(sourceFile, effect.source)
    assert.equal(digest(fs.readFileSync(sourceFile)), effect.hash, '复制改变了原作者源码')
    const spec = { entry: 'original.js', sourceFiles: { 'original.js': sourceFile }, width: 3840, height: 2160, duration, time: options.times?.[id] ?? ACTIVE_SAMPLE_TIMES[id] ?? Math.min(2, duration / 2), frames: 30, ...bindings }
    // Candidate seconds and the formal integer-frame playhead must describe the same instant.
    spec.time = Math.round(spec.time * 60) / 60
    const adaptations = []
    if (id === '4715265') {
      const canvas = 'const c2 = document.createElement("canvas");'
      const renderer = 'new ca2({ antialias: true,'
      assert.equal(effect.source.split(canvas).length, 2, '芯片 CanvasTexture 接口已变')
      assert.equal(effect.source.split(renderer).length, 2, '芯片 WebGLRenderer 接口已变')
      const adapted = effect.source.replace(canvas, 'const c2 = new OffscreenCanvas(w2,h2);').replace(renderer, 'new ca2({ canvas: new OffscreenCanvas(1,1), antialias: true,')
      const adaptedFile = path.join(directory, 'adapted.js')
      fs.writeFileSync(adaptedFile, adapted)
      spec.sourceFiles['adapted.js'] = adaptedFile
      spec.entry = 'adapted.js'
      adaptations.push({ file: 'adapted.js', changes: ['CanvasTexture 使用 OffscreenCanvas(w2,h2)', 'WebGLRenderer 显式传入 OffscreenCanvas；原 Three.js WebGL 和绘制算法不变'] })
    }
    if (effect.kind === 'filter') {
      assert.ok(options.filterInput && fs.existsSync(options.filterInput), '处理型独立场景需要明确的真实输入帧')
      const translated = await require('./yogaAuthorFilters.cjs').translateYogaFilter(effect)
      const adaptedFile = path.join(directory, 'adapted.js')
      fs.writeFileSync(adaptedFile, translated)
      spec.sourceFiles['adapted.js'] = adaptedFile
      spec.entry = 'adapted.js'
      spec.filterInput = options.filterInput
      spec.formal = true
      adaptations.push({ file: 'adapted.js', changes: ['原 CUDA 算法逐算子翻译 WGSL，保留原常数、采样、时间表和 pass 顺序', 'createWebGPU 借用正式输入与输出，独立管理中间纹理及释放'] })
    }
    spec.adaptations = adaptations
    fs.writeFileSync(path.join(directory, 'input.json'), JSON.stringify(spec, null, 2))
    entries.push({ id, name: effect.name, kind: effect.kind, original: path.join(root, effect.file), sha256: effect.hash, directory, adaptations, uses: uses.map(({ sequence, clip }) => ({ sequence: sequence.id, clip: clip.id, startTicks: clip.start, endTicks: clip.end })) })
  }
  fs.writeFileSync(path.join(output, `batch-${batch + 1}.json`), JSON.stringify({ source: graph.source, entries }, null, 2))
  return entries
}

module.exports = { YOGA_AUTHOR_BATCHES, readYogaAuthors, yogaInstanceParameters, prepareYogaAuthorBatch }
