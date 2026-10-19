// Explicit CPU/memory diagnostic; each implementation/fixture runs in a fresh process.
// Historical code is loaded from Git only on request, never shipped as a second kernel.
const { readFileSync, writeFileSync, mkdtempSync, rmSync } = require('node:fs')
const { join, resolve, dirname } = require('node:path')
const { tmpdir, cpus } = require('node:os')
const { execFileSync } = require('node:child_process')
const { buildSync } = require('esbuild')

const root = resolve(__dirname, '..')
const file = 'src/core/media/alignSpeechTimings.ts'
const args = process.argv.slice(2)
if (args.length && (args.length !== 2 || args[0] !== '--baseline' || !args[1])) throw new Error('用法：npm run benchmark:speech-alignment -- [--baseline <commit>]')
const baseline = args.length ? execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${args[1]}^{commit}`], { cwd: root, encoding: 'utf8' }).trim() : undefined

async function runFixture() {
  const phrase = '请打开后台，在用户设置中修改项目名称，然后保存。再次打开后台，检查修改结果。'
  const fixtures = {
    distributed: [phrase.repeat(240), phrase.replace(/，/g, '').replace('项目', '工程').repeat(240)],
    'insert-delete': [phrase.repeat(180), phrase.repeat(60) + '这一段是额外录制的补充说明'.repeat(50) + phrase.repeat(90)],
    unrelated: ['甲乙丙丁戊己庚辛'.repeat(650), '子丑寅卯辰巳午未'.repeat(650)],
  }
  const [original, recognized] = fixtures[process.argv[2]]
  const input = { granularity: 'char', items: Array.from(recognized).map((text, i) => ({ text, startMs: i * 100, endMs: i * 100 + 100 })) }
  const { createHash } = await import('node:crypto')
  await alignSpeechTimings('预热', { granularity: 'char', items: [{ text: '预热', startMs: 0, endMs: 200 }] })
  const samples = []
  for (let sample = 0; sample < 3; sample++) {
    global.gc()
    const before = process.memoryUsage()
    const start = performance.now()
    const result = await alignSpeechTimings(original, input)
    const durationMs = performance.now() - start
    const live = process.memoryUsage()
    if (result.map(char => char.text).join('') !== original) throw new Error('对齐丢失原文')
    const matches = result.filter(char => !char.estimated)
    if (!matches.every((char, i) => i === 0 || char.startMs >= matches[i - 1].endMs)) throw new Error('来源锚点逆序')
    const anchorDigest = createHash('sha256').update(JSON.stringify(matches.map(char => [char.text, char.startMs, char.endMs]))).digest('hex')
    // Whole-process RSS high-water includes inputs, runtime and result. The live heap
    // delta includes garbage not yet collected, so it is not a peak-allocation claim.
    samples.push({ durationMs, matches: matches.length, mismatches: result.filter(char => char.mismatch).length, anchorDigest,
      liveHeapDeltaBytes: live.heapUsed - before.heapUsed, maxProcessRssKiB: process.resourceUsage().maxRSS })
  }
  console.log(JSON.stringify({ originalCharacters: Array.from(original).length, recognizedCharacters: Array.from(recognized).length, samples }))
}

const tempRoot = mkdtempSync(join(tmpdir(), 'henji-speech-alignment-'))
try {
  const implementations = baseline ? [
    { name: 'baseline', revision: baseline, source: execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8' }) },
    { name: 'current', source: readFileSync(join(root, file), 'utf8') },
  ] : [{ name: 'current', source: readFileSync(join(root, file), 'utf8') }]
  const results = []
  for (const implementation of implementations) {
    const bundle = buildSync({ stdin: { contents: `${implementation.source}\n(${runFixture.toString()})().catch(error => { console.error(error); process.exitCode = 1 })`, resolveDir: dirname(join(root, file)), loader: 'ts' },
      bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent' })
    const executable = join(tempRoot, `${implementation.name}.mjs`)
    writeFileSync(executable, bundle.outputFiles[0].contents)
    for (const fixture of ['distributed', 'insert-delete', 'unrelated']) {
      const metrics = JSON.parse(execFileSync(process.execPath, ['--expose-gc', executable, fixture], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }))
      const result = { implementation: implementation.name, revision: implementation.revision, fixture, ...metrics }
      results.push(result)
      console.log(JSON.stringify(result))
    }
  }
  if (baseline) for (const fixture of ['distributed', 'insert-delete', 'unrelated']) {
    const before = results.find(result => result.implementation === 'baseline' && result.fixture === fixture)
    const after = results.find(result => result.implementation === 'current' && result.fixture === fixture)
    if (before.samples[0].matches !== after.samples[0].matches) throw new Error(`${fixture} 的精确匹配数量改变，请检查质量证据`)
  }
  console.log(JSON.stringify({ cpu: cpus()[0]?.model, node: process.version, platform: process.platform, scope: 'synthetic CPU kernel and timestamp metadata; excludes Worker startup, transfer, ASR and subtitle layout' }))
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}
