// 口播粗剪评估台：对一份粗剪管线源码（默认当前工作区）在回归用例、扰动条件与合成重念样本上打分，并与上次基线对比。
// 改去重念、停顿、呼吸、气口这些粗剪算法时跑它；只读仓库里的用例，单线程，整套几十秒内。
//
// 用法：npm run eval:rough-cut -- [--ref <提交>] [--verbose] [--update-baseline] [--json <文件>] [--clean-text <干净口播.txt>]
//   --ref <提交>        评估 Git 里某个版本的 src/core（只读取，不改工作区），用来和当前工作区对照
//   --update-baseline   把这次的分数存成基线（scripts/audio-edit-rough-cut-eval/baseline.json）
//   --verbose           列出每一处差异的时间码和上下文
//   --clean-text        额外拿一份没有重念的口播文稿做合成样本
// 加新的定稿用例：node scripts/audio-edit-rough-cut-eval/build-fixture.cjs（见文件头）
const { readFileSync, writeFileSync, readdirSync, mkdtempSync, mkdirSync, rmSync, existsSync } = require('node:fs')
const { join, resolve, dirname } = require('node:path')
const { tmpdir } = require('node:os')
const { execFileSync } = require('node:child_process')
const { gunzipSync } = require('node:zlib')
const { buildSync } = require('esbuild')
const { scoreWords, scoreTiming, strip } = require('./audio-edit-rough-cut-eval/score.cjs')
const { synthesize, scoreSynthetic } = require('./audio-edit-rough-cut-eval/synthetic.cjs')

const root = resolve(__dirname, '..')
const home = join(__dirname, 'audio-edit-rough-cut-eval')
const args = process.argv.slice(2)
const option = (flag) => { const at = args.indexOf(flag); return at >= 0 ? args[at + 1] : undefined }
const verbose = args.includes('--verbose')
const started = Date.now()
const work = mkdtempSync(join(tmpdir(), 'rough-cut-eval-'))

/** 被评估的源码：当前工作区，或把某个提交的 src/core/audioEdit 与 audioAnalysis 取到临时目录。 */
function sourceRoot() {
  const ref = option('--ref')
  if (!ref) return { core: join(root, 'src/core'), label: '当前工作区' }
  const commit = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { cwd: root, encoding: 'utf8' }).trim()
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', commit, 'src/core/audioEdit', 'src/core/audioAnalysis'], { cwd: root, encoding: 'utf8' })
    .split('\n').filter((file) => /\.ts$/.test(file) && !/\.test\.ts$/.test(file) && !file.includes('/__'))
  for (const file of files) {
    const target = join(work, file)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, execFileSync('git', ['show', `${commit}:${file}`], { cwd: root, maxBuffer: 1 << 26 }))
  }
  return { core: join(work, 'src/core'), label: `${ref}（${commit.slice(0, 9)}）` }
}

function loadPipeline(core) {
  const outfile = join(work, 'pipeline.cjs')
  buildSync({ entryPoints: [join(home, 'pipeline.ts')], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'error',
    alias: { '@rough-cut-core': core }, nodePaths: [join(root, 'node_modules')] })
  return require(outfile)
}

function loadFixtures() {
  return readdirSync(join(home, 'fixtures')).filter((file) => file.endsWith('.json.gz')).sort().map((file) => {
    const fixture = JSON.parse(gunzipSync(readFileSync(join(home, 'fixtures', file))).toString('utf8'))
    const unpack = (text) => { const bytes = Buffer.from(text, 'base64'); return Array.from(new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2), (value) => value / 10) }
    return { ...fixture, levels: { wideDb: unpack(fixture.energy.wideDb10), highDb: unpack(fixture.energy.highDb10) } }
  })
}

const inputOf = (fixture, patch = {}) => ({
  sampleRate: fixture.sampleRate, channels: fixture.channels, durationFrames: fixture.durationFrames, referenceScript: fixture.referenceScript,
  blocks: fixture.blocks.map(({ id, text, startFrame, endFrame }) => ({ id, text, startFrame, endFrame })),
  pauses: fixture.energy.pauses, breaths: fixture.breaths, levels: fixture.levels, ...patch,
})

function seeded(seed) {
  let state = seed
  return () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
}

/** 扰动条件：模拟没有稿子、识别不给标点、识别有错字、词时间不准。 */
const PERTURBATIONS = {
  无参考稿: (input) => ({ ...input, referenceScript: '' }),
  去掉标点: (input) => ({ ...input, blocks: input.blocks.map((block) => ({ ...block, text: block.text.replace(/\p{P}/gu, '') || block.text })) }),
  无稿且无标点: (input) => ({ ...PERTURBATIONS.去掉标点(input), referenceScript: '' }),
  '5% 错字': (input) => { const next = seeded(11); return { ...input, blocks: input.blocks.map((block) => (next() < 0.05 && /^[一-鿿]{2,}/.test(block.text) ? { ...block, text: `某${block.text.slice(1)}` } : block)) } },
  '5% 错字且无稿': (input) => ({ ...PERTURBATIONS['5% 错字'](input), referenceScript: '' }),
  '词时间抖动 ±60 毫秒': (input) => {
    const next = seeded(7), shift = () => Math.round((next() * 2 - 1) * 0.06 * input.sampleRate)
    return { ...input, blocks: input.blocks.map((block) => { const start = Math.max(0, block.startFrame + shift()); return { ...block, startFrame: start, endFrame: Math.max(start + 1, block.endFrame + shift()) } }) }
  },
}

const wordSummary = (score) => ({
  整处漏删: score.wholeMiss.count, 整处漏删秒: Number(score.wholeMiss.seconds.toFixed(1)), 整处误删: score.wholeFalse.count, 整处误删秒: Number(score.wholeFalse.seconds.toFixed(1)),
  留错遍: score.wrongTake.count, 接缝偏移: score.seamShift.count, 语气词漏删: score.fillerMiss, 语气词误删: score.fillerFalse, 待确认: score.review.count, 待确认命中: score.review.hit,
})

function evaluate(pipeline) {
  const scores = {}, details = []
  const fixtures = loadFixtures()
  for (const fixture of fixtures) {
    const finalDeleted = fixture.blocks.map((block) => !block.kept)
    const result = pipeline.roughCut(inputOf(fixture))
    const words = scoreWords(fixture.blocks, fixture.sampleRate, finalDeleted, result.deleted, result.review)
    const timing = scoreTiming(fixture, fixture.levels, result,
      { deleted: finalDeleted, cuts: fixture.finalCuts.filter((cut) => cut.enabled) })
    const shift = words.seamShift
    const section = scores[`${fixture.name}${fixture.gold ? '' : '（非定稿，仅参考）'}`] = {
      ...wordSummary(words),
      接缝偏移最多词数: Math.max(0, ...shift.words), 接缝偏移中位毫秒: [...shift.ms].sort((a, b) => a - b)[shift.ms.length >> 1] ?? 0,
      停顿偏差超80毫秒: timing.pauses.over80, 其中偏长: timing.pauses.longer80, 其中偏短: timing.pauses.shorter80, 停顿偏差超150毫秒: timing.pauses.over150,
      停顿偏差九成分位毫秒: timing.pauses.p90, 停顿偏差九九分位毫秒: timing.pauses.p99,
      硬接缝: timing.hardSeams, 碎保留段: timing.islands, 切到字: timing.clippedWords, 成片秒: Number(timing.outputSeconds.toFixed(1)), 定稿秒: Number(timing.finalSeconds.toFixed(1)),
    }
    // 不需二次调整的总指标：每一项都是用户要动手的一个位置（语气词与停顿各算一处）
    section.预计改动次数 = section.整处漏删 + section.整处误删 + section.留错遍 + section.接缝偏移 + section.语气词漏删 + section.语气词误删
      + section.停顿偏差超80毫秒 + section.硬接缝 + section.碎保留段 + section.切到字
    details.push([fixture.name, words, `（比较了 ${timing.pauses.compared} 个停顿、${timing.seamCount} 个接缝）`])
    if (!fixture.gold) continue
    for (const [name, perturb] of Object.entries(PERTURBATIONS)) {
      const input = perturb(inputOf(fixture))
      const retakes = pipeline.detectRetakes(input)
      const index = new Map(fixture.blocks.map((block, i) => [block.id, i]))
      const deleted = fixture.blocks.map(() => false)
      for (const retake of retakes) if (!retake.review) for (const id of retake.blockIds) deleted[index.get(id)] = true
      // 定稿里的删除也包含只跑去重念时不会删的语气词，这里只看实词，与“原样”同口径
      const perturbed = scoreWords(fixture.blocks, fixture.sampleRate, finalDeleted, deleted, retakes.filter((retake) => retake.review).map((retake) => retake.blockIds))
      const { 语气词漏删: _a, 语气词误删: _b, ...summary } = wordSummary(perturbed)
      scores[`${fixture.name} · ${name}`] = summary
      details.push([`${fixture.name} · ${name}`, perturbed, ''])
    }
  }
  // 合成重念：干净文字取定稿里保留下来的词（真实的词长与标点），可再加外部文稿
  const sources = fixtures.filter((fixture) => fixture.gold).map((fixture) => ({
    name: fixture.name, words: fixture.blocks.filter((block) => block.kept).map((block) => ({ text: block.text, durationMs: (block.endFrame - block.startFrame) * 1000 / fixture.sampleRate })),
  }))
  if (option('--clean-text')) {
    const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
    const words = []
    for (const { segment } of segmenter.segment(readFileSync(option('--clean-text'), 'utf8').replace(/\s+/g, ''))) {
      if (strip(segment)) words.push({ text: segment, durationMs: Math.max(120, strip(segment).length * 190) })
      else if (words.length) words.at(-1).text += segment
    }
    sources.push({ name: '外部文稿', words })
  }
  for (const withScript of [true, false]) {
    const failures = []
    const merged = { byType: {}, total: { total: 0, resolved: 0, review: 0, missed: 0, damaged: 0 }, falseRuns: 0, marker: { aiKept: 0, aiTotal: 0, otherDeleted: 0, otherTotal: 0 } }
    for (const source of sources) for (const seed of [1, 2, 3]) {
      const sample = synthesize(source.words, { seed })
      const outcome = scoreSynthetic(sample, pipeline.detectRetakes({ ...sample, referenceScript: withScript ? sample.referenceScript : '' }))
      for (const [type, bucket] of Object.entries(outcome.byType)) { const into = merged.byType[type] ??= { total: 0, resolved: 0, review: 0, missed: 0, damaged: 0 }; for (const key of Object.keys(into)) into[key] += bucket[key] }
      for (const key of Object.keys(merged.total)) merged.total[key] += outcome.total[key]
      for (const key of Object.keys(merged.marker)) merged.marker[key] += outcome.marker[key]
      merged.falseRuns += outcome.falseRuns
      failures.push(...outcome.failures)
    }
    details.push([`合成重念 · ${withScript ? '有稿' : '无稿'}`, undefined, '（~ 开头的词是算法删掉的）', failures])
    const percent = (bucket) => bucket.total ? Math.round(bucket.resolved / bucket.total * 100) : 0
    const names = { verbatim: '原样重念', rephrase: '换说法', mid: '句中重起', triple: '连念三遍', stutter: '蹦字' }
    scores[`合成重念 · ${withScript ? '有稿' : '无稿'}`] = {
      重念处数: merged.total.total, 剪对百分比: percent(merged.total), 漏剪: merged.total.missed, 剪坏: merged.total.damaged, 只提了待确认: merged.total.review, 范围外误删: merged.falseRuns,
      ...Object.fromEntries(Object.entries(merged.byType).sort().map(([type, bucket]) => [`${names[type]}剪对百分比`, percent(bucket)])),
      哎保留: merged.marker.aiKept, 哎总数: merged.marker.aiTotal, 呃与不对删除: merged.marker.otherDeleted, 呃与不对总数: merged.marker.otherTotal,
    }
  }
  // 一小时原始录音的耗时：把合成样本接长
  if (sources.length) {
    const long = []
    while (long.reduce((sum, word) => sum + word.durationMs, 0) < 40 * 60 * 1000) long.push(...sources[0].words)
    const sample = synthesize(long, { seed: 9 })
    const before = Date.now()
    pipeline.detectRetakes(sample)
    scores['长录音耗时'] = { 原始分钟: Math.round(sample.durationFrames / sample.sampleRate / 60), 词块数: sample.blocks.length, 去重念毫秒: Date.now() - before }
  }
  return { scores, details }
}

/** 越小越好的指标（其余只作参考，不标好坏）。 */
const LOWER_IS_BETTER = /漏删|误删|留错遍|接缝偏移$|停顿偏差|硬接缝|碎保留段|切到字|预计改动次数|漏剪|剪坏|范围外/
const HIGHER_IS_BETTER = /剪对百分比|待确认命中/

function print(label, scores, details, baseline) {
  console.log(`\n口播粗剪评估 · ${label}${baseline ? `（对比基线：${baseline.label}）` : '（没有基线）'}`)
  for (const [section, values] of Object.entries(scores)) {
    console.log(`\n【${section}】`)
    const cells = Object.entries(values).map(([key, value]) => {
      const before = baseline?.scores?.[section]?.[key]
      if (before === undefined || before === value || section === '长录音耗时') return `${key} ${value}`
      const better = LOWER_IS_BETTER.test(key) ? value < before : HIGHER_IS_BETTER.test(key) ? value > before : undefined
      return `${key} ${value}（基线 ${before}${better === undefined ? '' : better ? '，变好' : '，变差'}）`
    })
    for (let i = 0; i < cells.length; i += 5) console.log(`  ${cells.slice(i, i + 5).join('　')}`)
  }
  if (verbose) {
    for (const [name, words, note, failures] of details) {
      console.log(`\n—— ${name} 的逐处差异 ${note}`)
      if (!words) { for (const item of failures.slice(0, 60)) console.log(`  ${item}`); continue }
      for (const item of words.wholeMiss.items) console.log(`  整处漏删 ${item}`)
      for (const item of words.wholeFalse.items) console.log(`  整处误删 ${item}`)
      for (const item of words.wrongTake.items) console.log(`  留错遍   ${item}`)
      for (const item of words.seamShift.items) console.log(`  接缝偏移 ${item}`)
      for (const item of words.fillerItems) console.log(`  语气词   ${item}`)
    }
  }
}

try {
  const source = sourceRoot()
  const { scores, details } = evaluate(loadPipeline(source.core))
  const baselinePath = join(home, 'baseline.json')
  const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : undefined
  print(source.label, scores, details, baseline)
  if (option('--json')) writeFileSync(option('--json'), JSON.stringify({ label: source.label, scores }, null, 2))
  if (args.includes('--update-baseline')) {
    const { 长录音耗时: _timing, ...stable } = scores
    const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    const label = option('--ref') ? source.label : `${new Date().toISOString().slice(0, 10)} 的工作区（当时的提交 ${head}）`
    writeFileSync(baselinePath, `${JSON.stringify({ label, scores: stable }, null, 2)}\n`)
    console.log(`\n基线已更新：${baselinePath}`)
  }
  console.log(`\n用时 ${((Date.now() - started) / 1000).toFixed(1)} 秒`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
