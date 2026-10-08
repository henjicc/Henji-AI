const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const Module = require('node:module')
const { buildSync } = require('esbuild')

const ROOT = path.resolve(__dirname, '..')
const BASELINE = path.join(ROOT, 'src/core/persistence/schemaBaseline.json')
function loadTypeScript(entry, root = ROOT) {
  const file = path.resolve(root, entry)
  const result = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external', logLevel: 'silent' })
  const compiled = new Module(file, module)
  compiled.filename = file
  compiled.paths = Module._nodeModulePaths(path.dirname(file))
  compiled._compile(result.outputFiles[0].text, file)
  return compiled.exports
}
function snapshot(root = ROOT) {
  const { PERSISTENCE_FORMATS } = loadTypeScript('src/core/persistence/formats.ts', root)
  const { persistenceSchemaStructure } = loadTypeScript('src/core/persistence/fingerprint.ts', root)
  const ids = new Set()
  return PERSISTENCE_FORMATS.map(format => {
    if (ids.has(format.id)) throw new Error(`持久格式重复登记：${format.id}`)
    ids.add(format.id)
    if (!Number.isSafeInteger(format.version) || format.version < 1) throw new Error(`格式版本无效：${format.id}`)
    return { ...format, fingerprint: crypto.createHash('sha256').update(persistenceSchemaStructure(format.schemas)).digest('hex') }
  })
}
function fixtureVersions(root, id) {
  const dir = path.join(root, 'tests/fixtures/persistence', id)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).flatMap(file => /^v([1-9]\d*)\.[^.]+$/.test(file) ? [Number(file.match(/^v(\d+)/)[1])] : [])
}
function validateCompatibility(formats, baseline, fixtures) {
  const errors = []
  if (typeof baseline.releasedCompatibility !== 'boolean' || !Array.isArray(baseline.devBreaks)) return ['持久格式基线无效']
  const current = new Map(formats.map(format => [format.id, format]))
  for (const id of Object.keys(baseline.formats)) if (!current.has(id)) errors.push(`持久格式登记被删除：${id}；保留读取能力并显式登记退役。`)
  for (const format of formats) {
    const previous = baseline.formats[format.id]
    if (!previous) { errors.push(`未登记基线：${format.id}；运行 npm run persistence:baseline。`); continue }
    if (format.version < previous.version) errors.push(`持久格式版本不能回退：${format.id}`)
    if (format.fingerprint !== previous.fingerprint || format.version !== previous.version) {
      errors.push(format.version === previous.version
        ? `改了持久格式 ${format.id}：请升版本并写迁移；开发期可运行 npm run persistence:baseline -- --dev-break ${format.id} --reason "…" 显式登记放弃兼容。`
        : `持久格式 ${format.id} 已升版本，请补迁移和样本后运行 npm run persistence:baseline。`)
    }
    // Grandfathered dev breaks reject historical versions even after release; new ones are forbidden.
    const breaks = baseline.devBreaks.filter(item => item.format === format.id)
    const waived = new Set(breaks.flatMap(item => item.waivedFixtureVersions ?? []))
    for (let version = 1; version <= format.version; version++) {
      if (!fixtures(format.id).includes(version) && !(version < format.version && waived.has(version))) errors.push(`缺少黄金样本：${format.id}/v${version}.*`)
    }
    const floor = previous.supportedFrom ?? 1
    if (format.storage !== 'sqlite-ledger') for (let version = floor; version < format.version; version++) {
      if (!Object.hasOwn(format.migrations, version)) errors.push(`缺少逐版本迁移：${format.id} v${version} → v${version + 1}`)
    }
  }
  return errors
}
function updateBaseline(formats, baseline, options, fixtures) {
  const next = structuredClone(baseline)
  const breaks = options.devBreak ? (Array.isArray(options.devBreak) ? options.devBreak : [options.devBreak]) : []
  if (breaks.length && baseline.releasedCompatibility) throw new Error('正式发布后禁止 --dev-break；请升版本并写迁移和黄金样本。')
  if (breaks.length && (!options.reason?.trim() || breaks.some(id => !formats.some(format => format.id === id) && !baseline.formats[id]))) throw new Error('--dev-break 必须指定已登记格式与非空 --reason。')
  for (const format of formats) {
    const broken = breaks.includes(format.id)
    if (breaks.length && !broken && baseline.formats[format.id]) continue
    const previous = baseline.formats[format.id]
    if (previous && format.version < previous.version) throw new Error(`持久格式版本不能回退：${format.id}`)
    if (previous && format.version === previous.version && previous.fingerprint !== format.fingerprint && !broken) throw new Error(`改了持久格式 ${format.id}，请升版本并写迁移；开发期须显式 --dev-break。`)
    const adoption = options.init && format.version > 1
    const supportedFrom = broken || adoption ? format.version : previous?.supportedFrom ?? 1
    next.formats[format.id] = { version: format.version, fingerprint: format.fingerprint, supportedFrom }
    if (broken || adoption) next.devBreaks.push({ at: new Date().toISOString(), format: format.id, version: format.version, reason: options.reason.trim(), previousFingerprint: previous?.fingerprint ?? null, fingerprint: format.fingerprint,
      waivedFixtureVersions: options.waiveBefore || adoption ? Array.from({ length: format.version - 1 }, (_, i) => i + 1) : [] })
  }
  for (const id of breaks.filter(id => !formats.some(format => format.id === id))) {
    const previous = baseline.formats[id]
    next.devBreaks.push({ at: new Date().toISOString(), format: id, version: previous.version, reason: options.reason.trim(), previousFingerprint: previous.fingerprint, fingerprint: null, retired: true, waivedFixtureVersions: [] })
    delete next.formats[id]
  }
  const errors = validateCompatibility(formats, next, fixtures)
  if (errors.length) throw new Error(errors.join('\n'))
  return next
}
function main(argv = process.argv.slice(2)) {
  const flags = new Set(['--write', '--init', '--dev-break', '--reason', '--waive-before'])
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (!flags.has(flag)) throw new Error(`未知参数：${flag}`)
    if (flag === '--dev-break' || flag === '--reason') { if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`${flag} 缺少参数`); const value = argv[++i]; if (flag === '--dev-break') options.devBreak = [...(options.devBreak ?? []), value]; else options.reason = value }
    else options[flag.slice(2)] = true
  }
  options.waiveBefore = options['waive-before']
  if ((options.devBreak || options.reason || options.waiveBefore || options.init) && !options.write) throw new Error('登记命令必须通过 persistence:baseline 执行。')
  if (options.waiveBefore && !options.devBreak) throw new Error('--waive-before 只允许和 --dev-break、--reason 一起使用。')
  const formats = snapshot()
  let baseline
  if (options.init) {
    if (fs.existsSync(BASELINE)) throw new Error('基线已存在，禁止重新初始化或清空历史。')
    if (!options.reason?.trim()) throw new Error('初始化基线须用 --reason 显式登记接入前历史样本豁免。')
    baseline = { releasedCompatibility: false, formats: {}, devBreaks: [] }
  } else baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
  const fixtures = id => fixtureVersions(ROOT, id)
  if (options.write) {
    const next = updateBaseline(formats, baseline, options, fixtures)
    // Atomic publication, no partial baseline on rejection.
    const temporary = `${BASELINE}.${crypto.randomUUID()}.tmp`
    try { fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' }); fs.renameSync(temporary, BASELINE) }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
  } else {
    const errors = validateCompatibility(formats, baseline, fixtures)
    if (errors.length) throw new Error(errors.join('\n'))
  }
  console.log(`持久格式兼容门禁通过：${formats.length} 种格式。`)
}
if (require.main === module) { try { main() } catch (error) { console.error(error.message); process.exitCode = 1 } }
module.exports = { loadTypeScript, snapshot, validateCompatibility, updateBaseline, fixtureVersions, main }
