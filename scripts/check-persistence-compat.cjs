const { RELEASED_PATH, sampleDigests, validateReleasedCompatibility, validateReleaseHistory, createReleaseSnapshot, readProtectedRelease } = require('./lib/releasedCompatibility.cjs')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const Module = require('node:module')
const { buildSync } = require('esbuild')

const ROOT = path.resolve(__dirname, '..')
const BASELINE = path.join(ROOT, 'src/core/persistence/schemaBaseline.json')
function loadTypeScript(entry, root = ROOT) {
  const file = path.resolve(root, entry)
  const result = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external', alias: { '@': path.join(root, 'src') }, logLevel: 'silent' })
  const compiled = new Module(file, module)
  compiled.filename = file
  compiled.paths = Module._nodeModulePaths(path.dirname(file))
  compiled._compile(result.outputFiles[0].text, file)
  return compiled.exports
}
function snapshot(root = ROOT) {
  const { PERSISTENCE_FORMATS } = loadTypeScript('src/core/persistence/formats.ts', root)
  const { persistenceSchemaStructure } = loadTypeScript('src/core/persistence/fingerprint.ts', root)
  const { SCHEMA_MIGRATIONS } = loadTypeScript('electron/main/services/db-migrations.ts', root)
  const sql = PERSISTENCE_FORMATS.find(format => format.id === 'sqlite')
  if (!sql || SCHEMA_MIGRATIONS.length !== sql.version || SCHEMA_MIGRATIONS.some((step, index) => step.version !== index + 1 || typeof step.up !== 'function')) throw new Error('SQLite 登记版本必须与真实 SQL 账本连续步骤一致')
  const ids = new Set()
  return PERSISTENCE_FORMATS.map(format => {
    if (ids.has(format.id)) throw new Error(`持久格式重复登记：${format.id}`)
    ids.add(format.id)
    if (!Number.isSafeInteger(format.version) || format.version < 1) throw new Error(`格式版本无效：${format.id}`)
    const minReaderVersion = format.minReaderVersion ?? format.version
    if (!Number.isSafeInteger(minReaderVersion) || minReaderVersion < 1 || minReaderVersion > format.version) throw new Error(`最低可读版本无效：${format.id}`)
    return { ...format, minReaderVersion, fingerprint: crypto.createHash('sha256').update(persistenceSchemaStructure(format.schemas)).digest('hex') }
  })
}
function fixtureVersions(root, id, extension) {
  const dir = path.join(root, 'tests/fixtures/persistence', id)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(file => !extension || file.endsWith(`.${extension}`)).flatMap(file => /^v([1-9]\d*)\.[^.]+$/.test(file) ? [Number(file.match(/^v(\d+)/)[1])] : [])
}
function validateCompatibility(formats, baseline, fixtures) {
  const errors = []
  if (typeof baseline.releasedCompatibility !== 'boolean' || !Array.isArray(baseline.devBreaks)) return ['持久格式基线无效']
  if (baseline.compatibilityRestorations !== undefined && !Array.isArray(baseline.compatibilityRestorations)) return ['恢复支持审计必须为数组']
  const current = new Map(formats.map(format => [format.id, format]))
  for (const id of Object.keys(baseline.formats)) if (!current.has(id)) errors.push(`持久格式登记被删除：${id}；保留读取能力并显式登记退役。`)
  for (const format of formats) {
    const previous = baseline.formats[format.id]
    if (!previous) { errors.push(`未登记基线：${format.id}；运行 npm run persistence:baseline。`); continue }
    if (format.version < previous.version) errors.push(`持久格式版本不能回退：${format.id}`)
    const previousMinReader = previous.minReaderVersion ?? previous.version, minReader = format.minReaderVersion ?? format.version
    if (format.version === previous.version && minReader !== previousMinReader) errors.push(`最低可读版本与基线不一致：${format.id}；只新增可选字段时保持不变，改变已有含义时提高，然后运行 npm run persistence:baseline。`)
    if (minReader < previousMinReader) errors.push(`最低可读版本不能降低：${format.id}`)
    if (format.fingerprint !== previous.fingerprint || format.version !== previous.version) {
      errors.push(format.version === previous.version
        ? `改了持久格式 ${format.id}：请升版本并写迁移与黄金样本。`
        : `持久格式 ${format.id} 已升版本，请补迁移和样本后运行 npm run persistence:baseline。`)
    }
    // Grandfathered dev breaks reject historical versions even after release; new ones are forbidden.
    const breaks = baseline.devBreaks.filter(item => item.format === format.id)
    // 支持下限必须与最后一次破坏/恢复审计一致，不能只手改 supportedFrom。
    const restorations = (baseline.compatibilityRestorations ?? []).filter(item => item.format === format.id)
    for (const item of restorations) {
      if (!item.reason?.trim() || !Number.isFinite(Date.parse(item.at))
        || !Number.isSafeInteger(item.supportedFrom) || item.supportedFrom < 1
        || !Number.isSafeInteger(item.previousSupportedFrom) || item.supportedFrom >= item.previousSupportedFrom
        || !Number.isSafeInteger(item.version) || item.previousSupportedFrom > item.version || item.version > format.version) errors.push(`恢复支持审计无效：${format.id}`)
    }
    const supportHistory = [
      ...breaks.filter(item => Number.isSafeInteger(item.version)).map(item => ({ at: item.at ?? '', floor: item.version })),
      ...restorations.map(item => ({ at: typeof item.at === 'string' ? item.at : '', floor: item.supportedFrom })),
    ].sort((a, b) => a.at.localeCompare(b.at))
    if (supportHistory.length && (previous.supportedFrom ?? 1) !== supportHistory.at(-1).floor) errors.push(`支持下限与审计不一致：${format.id}；请通过 --restore-support 补迁移恢复支持。`)
    const waived = new Set(breaks.flatMap(item => item.waivedFixtureVersions ?? []))
    for (let version = Math.max(1, previous.supportedFrom ?? 1); version <= format.version; version++) {
      if (!fixtures(format.id).includes(version) && !(version < format.version && waived.has(version))) errors.push(`缺少黄金样本：${format.id}/v${version}.*`)
    }
    for (const requirement of format.requiredFixtures ?? [{ extension: 'json' }]) {
      const owner = requirement.versionFormat ?? format.id
      const target = current.get(owner)
      const floor = baseline.formats[owner]?.supportedFrom ?? 1
      for (let version = floor; version <= (target?.version ?? format.version); version++) {
        if (!fixtures(format.id, requirement.extension).includes(version)) errors.push(`缺少必需黄金样本：${format.id}/v${version}.${requirement.extension}`)
      }
    }
    const floor = previous.supportedFrom ?? 1
    if (!Number.isSafeInteger(floor) || floor < 1 || floor > format.version) errors.push(`持久格式支持下限无效：${format.id}`)
    if (format.storage !== 'sqlite-ledger') for (let version = floor; version < format.version; version++) {
      if (!Object.hasOwn(format.migrations, version) || typeof format.migrations[version] !== 'function') errors.push(`缺少逐版本迁移：${format.id} v${version} → v${version + 1}`)
    }
  }
  return errors
}
function updateBaseline(formats, baseline, options, fixtures) {
  if (options.compatibilityStart) {
    if (baseline.releasedCompatibility || options.devBreak || options.restoreSupport || !options.reason?.trim()) throw new Error('兼容起点只能在首次正式启用前登记一次，须提供非空 --reason，且不能混用其他登记命令。')
    const start = { releasedCompatibility: true, compatibilityStart: { at: new Date().toISOString(), reason: options.reason.trim() }, formats: {}, devBreaks: [] }
    for (const format of formats) start.formats[format.id] = { version: format.version, fingerprint: format.fingerprint, supportedFrom: format.version, minReaderVersion: format.minReaderVersion ?? format.version }
    const errors = validateCompatibility(formats, start, fixtures)
    if (errors.length) throw new Error(errors.join('\n'))
    return start
  }
  const next = structuredClone(baseline)
  const adoption = options.frameworkAdoption === true
  const restorations = options.restoreSupport ?? []
  if (!Array.isArray(restorations)) throw new Error('--restore-support 必须指定 格式id:最低版本')
  if (restorations.length && (!options.reason?.trim() || options.devBreak || options.waiveBefore || options.init || adoption)) throw new Error('--restore-support 须提供非空 --reason，且不能混用 dev-break、样本豁免或初始化登记')
  const restoredFloors = new Map()
  if (baseline.compatibilityRestorations !== undefined && !Array.isArray(baseline.compatibilityRestorations)) throw new Error('恢复支持审计必须为数组')
  for (const spec of restorations) {
    const match = typeof spec === 'string' && /^([^:]+):([1-9]\d*)$/.exec(spec)
    if (!match) throw new Error('--restore-support 必须指定 格式id:最低版本')
    const [, id, version] = match
    const floor = Number(version)
    const previous = baseline.formats[id]
    const format = formats.find(item => item.id === id)
    if (!previous || !format) throw new Error(`恢复支持必须指定已登记且未退役的格式：${id}`)
    if (restoredFloors.has(id)) throw new Error(`重复恢复支持：${id}`)
    if (!Number.isSafeInteger(floor) || floor >= (previous.supportedFrom ?? 1)) throw new Error(`恢复支持必须降低支持下限：${id}`)
    if (format.storage === 'sqlite-ledger') throw new Error(`SQLite 支持范围由 SQL 账本负责，不能使用 --restore-support：${id}`)
    if (format.version !== previous.version || format.fingerprint !== previous.fingerprint) throw new Error(`恢复支持不能同时改变当前版本或结构：${id}`)
    restoredFloors.set(id, floor)
  }
  if (adoption && (baseline.releasedCompatibility || baseline.frameworkAdoption || !options.reason?.trim() || options.devBreak)) throw new Error('框架一次性登记仅允许首次发布前执行一次，须提供非空理由且不能混用 dev-break')
  const breaks = options.devBreak ? (Array.isArray(options.devBreak) ? options.devBreak : [options.devBreak]) : []
  if ((breaks.length || options.waiveBefore) && baseline.releasedCompatibility) throw new Error('已正式启用向后兼容，禁止 --dev-break 与 --waive-before；请升版本并写迁移和黄金样本。')
  if (breaks.length && (!options.reason?.trim() || breaks.some(id => !formats.some(format => format.id === id) && !baseline.formats[id]))) throw new Error('--dev-break 必须指定已登记格式与非空 --reason。')
  for (const format of formats) {
    const broken = breaks.includes(format.id)
    if (breaks.length && !broken && baseline.formats[format.id]) continue
    const previous = baseline.formats[format.id]
    if (previous && format.version < previous.version) throw new Error(`持久格式版本不能回退：${format.id}`)
    if (previous && format.version === previous.version && previous.fingerprint !== format.fingerprint && !broken && !options.frameworkAdoption) throw new Error(`改了持久格式 ${format.id}，请升版本并写迁移；开发期须显式 --dev-break。`)
    const adoption = options.init && format.version > 1
    const supportedFrom = restoredFloors.get(format.id) ?? (broken || adoption ? format.version : previous?.supportedFrom ?? 1)
    if (previous?.minReaderVersion !== undefined && (format.minReaderVersion ?? format.version) < previous.minReaderVersion) throw new Error(`最低可读版本不能降低：${format.id}`)
    next.formats[format.id] = { version: format.version, fingerprint: format.fingerprint, supportedFrom, minReaderVersion: format.minReaderVersion ?? format.version }
    if (restoredFloors.has(format.id)) {
      next.compatibilityRestorations ??= []
      next.compatibilityRestorations.push({ at: new Date().toISOString(), format: format.id, version: format.version,
        previousSupportedFrom: previous.supportedFrom, supportedFrom, reason: options.reason.trim(),
        previousFingerprint: previous.fingerprint, fingerprint: format.fingerprint,
        migrationVersions: Array.from({ length: format.version - supportedFrom }, (_, index) => supportedFrom + index) })
    }
    if (broken || adoption) next.devBreaks.push({ at: new Date().toISOString(), format: format.id, version: format.version, reason: options.reason.trim(), previousFingerprint: previous?.fingerprint ?? null, fingerprint: format.fingerprint,
      waivedFixtureVersions: options.waiveBefore || adoption ? Array.from({ length: format.version - 1 }, (_, i) => i + 1) : [] })
  }
  for (const id of breaks.filter(id => !formats.some(format => format.id === id))) {
    const previous = baseline.formats[id]
    next.devBreaks.push({ at: new Date().toISOString(), format: id, version: previous.version, reason: options.reason.trim(), previousFingerprint: previous.fingerprint, fingerprint: null, retired: true, waivedFixtureVersions: [] })
    delete next.formats[id]
  }
  if (adoption) next.frameworkAdoption = { at: new Date().toISOString(), reason: options.reason.trim(), formats: formats.filter(format => baseline.formats[format.id]).map(format => ({ format: format.id, version: format.version, supportedFrom: next.formats[format.id].supportedFrom, previousFingerprint: baseline.formats[format.id].fingerprint, fingerprint: format.fingerprint })) }
  const errors = validateCompatibility(formats, next, fixtures)
  if (errors.length) throw new Error(errors.join('\n'))
  return next
}
function main(argv = process.argv.slice(2)) {
  const flags = new Set(['--write', '--init', '--dev-break', '--restore-support', '--reason', '--waive-before', '--release-snapshot', '--framework-adoption', '--compatibility-start'])
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (!flags.has(flag)) throw new Error(`未知参数：${flag}`)
    if (flag === '--dev-break' || flag === '--restore-support' || flag === '--reason') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`${flag} 缺少参数`)
      const value = argv[++i]
      if (flag === '--dev-break') options.devBreak = [...(options.devBreak ?? []), value]
      else if (flag === '--restore-support') options.restoreSupport = [...(options.restoreSupport ?? []), value]
      else options.reason = value
    }
    else options[flag.slice(2)] = true
  }
  options.frameworkAdoption = options['framework-adoption']
  options.waiveBefore = options['waive-before']
  options.compatibilityStart = options['compatibility-start']
  if ((options.devBreak || options.restoreSupport || options.reason || options.waiveBefore || options.init || options.frameworkAdoption || options.compatibilityStart) && !options.write) throw new Error('登记命令必须通过 persistence:baseline 执行。')
  if (options.waiveBefore && !options.devBreak) throw new Error('--waive-before 只允许和 --dev-break、--reason 一起使用。')
  loadTypeScript('scripts/lib/frozenAuthorLibraries.ts').validateFrozenAuthorHistory(ROOT)
  const formats = snapshot()
  let baseline
  if (options.init) {
    if (fs.existsSync(BASELINE)) throw new Error('基线已存在，禁止重新初始化或清空历史。')
    if (!options.reason?.trim()) throw new Error('初始化基线须用 --reason 显式登记接入前历史样本豁免。')
    baseline = { releasedCompatibility: false, formats: {}, devBreaks: [] }
  } else baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
  if (baseline.releasedCompatibility && (options.devBreak || options.waiveBefore)) throw new Error('已正式启用向后兼容，禁止 --dev-break 与 --waive-before；请升版本并写迁移和黄金样本。')
  const fixtures = (id, extension) => fixtureVersions(ROOT, id, extension)
  const releasedPath = path.join(ROOT, RELEASED_PATH)
  const released = JSON.parse(fs.readFileSync(releasedPath, 'utf8'))
  if (typeof released.releasedCompatibility !== 'boolean' || !released.formats || !Array.isArray(released.devBreaks)
    || released.releasedCompatibility && !Object.keys(released.formats).length) throw new Error('发布兼容快照结构无效')
  const samples = id => sampleDigests(ROOT, id)
  const protectedRelease = readProtectedRelease(ROOT)
  const releaseErrors = [...validateReleaseHistory(protectedRelease, released), ...validateReleasedCompatibility(formats, baseline, released, samples)]
  if (releaseErrors.length) throw new Error(releaseErrors.join('\n'))
  if (baseline.releasedCompatibility && !released.releasedCompatibility && !options['release-snapshot']) throw new Error('发布开关已开启但缺少发布快照；运行 npm run persistence:release-snapshot。')
  if (options['release-snapshot']) {
    if (options.write) throw new Error('发布快照与开发基线更新必须分开执行')
    const errors = validateCompatibility(formats, baseline, fixtures)
    if (errors.length) throw new Error(errors.join('\n'))
    const next = createReleaseSnapshot(formats, baseline, released, samples)
    const temporary = `${releasedPath}.${crypto.randomUUID()}.tmp`
    try { fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' }); fs.renameSync(temporary, releasedPath) }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
    console.log('发布兼容快照已生成；请审查并提交到受保护分支。')
    return
  }
  if (options.write) {
    const next = updateBaseline(formats, baseline, options, fixtures)
    const errors = validateReleasedCompatibility(formats, next, released, samples)
    if (errors.length) throw new Error(errors.join('\n'))
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
