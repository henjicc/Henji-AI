const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

const RELEASED_PATH = 'src/core/persistence/releasedCompatibility.json'
const emptyRelease = () => ({ releasedCompatibility: false, formats: {}, devBreaks: [] })
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const requirements = format => format.requiredFixtures ?? [{ extension: 'json' }]
const retainsRequirements = (previous, next) => previous.every(requirement => next.some(candidate => same(requirement, candidate)))

function sampleDigests(root, id) {
  const directory = path.join(root, 'tests/fixtures/persistence', id)
  return Object.fromEntries(fs.readdirSync(directory).sort().filter(file => /^v[1-9]\d*\.[^.]+$/.test(file)).map(file =>
    [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, file))).digest('hex')]))
}

/** Compare against a separate, append-only published promise, never against today's editable baseline alone. */
function validateReleasedCompatibility(formats, baseline, released, samples) {
  if (!released.releasedCompatibility) return []
  const errors = []
  if (!baseline.releasedCompatibility) errors.push('已发布兼容开关禁止回退')
  if (!same(baseline.devBreaks, released.devBreaks)) errors.push('发布后禁止修改或追加开发期豁免')
  for (const [id, promise] of Object.entries(released.formats)) {
    const current = formats.find(format => format.id === id)
    const entry = baseline.formats[id]
    if (!current || !entry) { errors.push(`禁止删除已发布格式：${id}`); continue }
    if (!retainsRequirements(promise.requiredFixtures, requirements(current))) errors.push(`禁止删除已发布样本类型要求：${id}`)
    if ((entry.supportedFrom ?? 1) > promise.supportedFrom) errors.push(`禁止抬高已发布支持下限：${id}`)
    const versions = Object.keys(promise.versions).map(Number)
    if (current.version < Math.max(...versions)) errors.push(`禁止回退已发布版本：${id}`)
    if (promise.versions[current.version] && current.fingerprint !== promise.versions[current.version]) errors.push(`禁止改写已发布版本指纹：${id}/v${current.version}`)
    if (promise.readers?.[current.version] !== undefined && (current.minReaderVersion ?? current.version) !== promise.readers[current.version]) errors.push(`禁止改写已发布版本的最低可读版本：${id}/v${current.version}`)
    const actual = samples(id)
    for (const [file, digest] of Object.entries(promise.samples)) if (actual[file] !== digest) errors.push(`已发布黄金样本被修改或删除：${id}/${file}`)
  }
  return errors
}

function validateReleaseHistory(previous, next) {
  if (!previous.releasedCompatibility) return []
  const errors = []
  if (next.releasedCompatibility !== true) errors.push('受保护发布快照禁止回退或删除')
  if (!same(previous.devBreaks, next.devBreaks)) errors.push('受保护发布快照的豁免不可修改')
  for (const [id, old] of Object.entries(previous.formats)) {
    const current = next.formats[id]
    if (!current) { errors.push(`受保护发布格式不可删除：${id}`); continue }
    if (!retainsRequirements(old.requiredFixtures, current.requiredFixtures ?? [])) errors.push(`受保护样本类型不可删除：${id}`)
    if (current.supportedFrom > old.supportedFrom) errors.push(`受保护支持下限不可提高：${id}`)
    for (const section of ['versions', 'samples', 'readers']) for (const [key, value] of Object.entries(old[section] ?? {})) {
      if (current[section]?.[key] !== value) errors.push(`受保护发布快照不可改写：${id}/${section}/${key}`)
    }
  }
  return errors
}

function createReleaseSnapshot(formats, baseline, previous, samples) {
  if (!baseline.releasedCompatibility) throw new Error('发布操作须先显式将基线 releasedCompatibility 设为 true')
  const errors = validateReleasedCompatibility(formats, baseline, previous, samples)
  if (errors.length) throw new Error(errors.join('\n'))
  const next = structuredClone(previous)
  next.releasedCompatibility = true
  next.devBreaks = structuredClone(baseline.devBreaks)
  for (const format of formats) {
    const old = previous.formats[format.id]
    next.formats[format.id] = { supportedFrom: old?.supportedFrom ?? baseline.formats[format.id].supportedFrom ?? 1,
      requiredFixtures: structuredClone(requirements(format)),
      versions: { ...old?.versions, [format.version]: format.fingerprint }, readers: { ...old?.readers, [format.version]: format.minReaderVersion ?? format.version },
      samples: { ...old?.samples, ...samples(format.id) } }
  }
  return next
}

/** CI passes the immutable pre-change commit, local checks compare the committed HEAD. Read-only Git. */
function readProtectedRelease(root, ref = process.env.HENJI_PERSISTENCE_RELEASE_REF || 'HEAD') {
  const files = execFileSync('git', ['ls-tree', '--name-only', ref, '--', RELEASED_PATH], { cwd: root, encoding: 'utf8' }).trim()
  if (!files) return emptyRelease() // This framework did not exist before the first adoption commit.
  return JSON.parse(execFileSync('git', ['show', `${ref}:${RELEASED_PATH}`], { cwd: root, encoding: 'utf8' }))
}

module.exports = { RELEASED_PATH, emptyRelease, sampleDigests, validateReleasedCompatibility, validateReleaseHistory, createReleaseSnapshot, readProtectedRelease }
