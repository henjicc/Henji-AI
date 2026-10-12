const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validateCompatibility, updateBaseline } = require('./check-persistence-compat.cjs')
const { emptyRelease, createReleaseSnapshot, validateReleasedCompatibility, validateReleaseHistory } = require('./lib/releasedCompatibility.cjs')

const format = { id: 'test', name: '剪辑', version: 1, fingerprint: 'old', storage: 'file', migrations: {} }
const baseline = () => ({ releasedCompatibility: false, formats: { test: { version: 1, fingerprint: 'old', supportedFrom: 1 } }, devBreaks: [] })
test('同版本结构改变被拒绝，正常基线更新也不能绕过', () => {
  const changed = { ...format, fingerprint: 'changed' }
  assert.match(validateCompatibility([changed], baseline(), () => [1]).join(''), /改了持久格式/)
  assert.throws(() => updateBaseline([changed], baseline(), {}, () => [1]), /请升版本/)
})
test('升版本必须有连续迁移及完整样本', () => {
  const next = { ...format, version: 3, fingerprint: 'new', migrations: { 1: () => ({}) } }
  assert.throws(() => updateBaseline([next], baseline(), {}, () => [1, 3]), /缺少黄金样本.*v2|缺少逐版本迁移/)
  assert.throws(() => updateBaseline([next], baseline(), {}, () => [1, 2, 3]), /v2 → v3/)
  assert.doesNotThrow(() => updateBaseline([{ ...next, migrations: { 1: () => ({}), 2: () => ({}) } }], baseline(), {}, () => [1, 2, 3]))
})
test('开发期显式登记破坏，必须有理由且不能豁免当前版本样本', () => {
  const changed = { ...format, version: 2, fingerprint: 'new' }
  assert.throws(() => updateBaseline([changed], baseline(), { devBreak: 'test' }, () => [2]), /非空/)
  assert.throws(() => updateBaseline([changed], baseline(), { devBreak: 'missing', reason: 'x' }, () => [2]), /已登记格式/)
  const registered = updateBaseline([changed], baseline(), { devBreak: 'test', reason: '开发期格式调整', waiveBefore: true }, () => [2])
  assert.deepEqual(registered.devBreaks[0].waivedFixtureVersions, [1]); assert.equal(registered.formats.test.supportedFrom, 2)
  assert.match(registered.devBreaks[0].at, /^\d{4}-/)
  assert.throws(() => updateBaseline([changed], baseline(), { devBreak: 'test', reason: 'x', waiveBefore: true }, () => []), /v2/)
})
test('发布开关拒绝dev-break；接入前豁免可保留，未来版本仍须迁移', () => {
  const state = baseline(); state.releasedCompatibility = true
  assert.throws(() => updateBaseline([format], state, { devBreak: 'test', reason: 'no' }, () => [1]), /正式发布后禁止/)
  const adopted = { ...state, formats: { test: { version: 2, fingerprint: 'old', supportedFrom: 2 } }, devBreaks: [{ format: 'test', version: 2, reason: '接入前版本', waivedFixtureVersions: [1] }] }
  assert.deepEqual(validateCompatibility([{ ...format, version: 2 }], adopted, () => [2]), [])
  assert.throws(() => updateBaseline([{ ...format, version: 3 }], adopted, {}, () => [2, 3]), /v2 → v3/)
})
test('格式移除与版本回退不能静默改写基线', () => {
  assert.match(validateCompatibility([], baseline(), () => []).join(''), /登记被删除/)
  assert.throws(() => updateBaseline([{ ...format, version: 0 }], baseline(), {}, () => []), /不能回退/)
})

test('多个格式一起变化须分别登记；开发期删除已知格式也有显式审计，发布后禁止', () => {
  const state = baseline(); state.formats.other = { version: 1, fingerprint: 'old', supportedFrom: 1 }
  const formats = [{ ...format, fingerprint: 'new' }, { ...format, id: 'other', fingerprint: 'new' }]
  assert.throws(() => updateBaseline(formats, state, { devBreak: 'test', reason: '只登记一个' }, () => [1]), /改了持久格式 other/)
  const updated = updateBaseline(formats, state, { devBreak: ['test', 'other'], reason: '显式登记两种开发期结构变更' }, () => [1])
  assert.equal(updated.devBreaks.length, 2)
  const retired = updateBaseline([], baseline(), { devBreak: 'test', reason: '删除未发布的开发功能' }, () => [])
  assert.deepEqual(retired.formats, {}); assert.equal(retired.devBreaks[0].retired, true)
  assert.throws(() => updateBaseline([], { ...baseline(), releasedCompatibility: true }, { devBreak: 'test', reason: '删除' }, () => []), /正式发布后禁止/)
})

test('发布快照阻止开关回退、支持下限抬高、新豁免、格式删除、版本指纹及样本改写', () => {
  const state = { ...baseline(), releasedCompatibility: true }
  const samples = () => ({ 'v1.json': 'digest' })
  const released = createReleaseSnapshot([format], state, emptyRelease(), samples)
  assert.deepEqual(validateReleasedCompatibility([format], state, released, samples), [])
  const reject = (next, formats = [format], read = samples) => assert.ok(validateReleasedCompatibility(formats, next, released, read).length)
  reject({ ...state, releasedCompatibility: false })
  reject({ ...state, formats: { test: { ...state.formats.test, supportedFrom: 2 } } })
  reject({ ...state, devBreaks: [{ format: 'test', waivedFixtureVersions: [1] }] })
  reject({ ...state, formats: {} }, [])
  reject(state, [{ ...format, fingerprint: 'changed' }])
  reject(state, [format], () => ({ 'v1.json': 'tampered' }))
  reject(state, [format], () => ({}))
  assert.ok(validateReleaseHistory(released, emptyRelease()).length)
  const tampered = structuredClone(released); tampered.formats.test.versions[1] = 'changed'
  assert.ok(validateReleaseHistory(released, tampered).length)
  const nextFormat = { ...format, version: 2, fingerprint: 'next', migrations: { 1: value => value } }
  const nextState = updateBaseline([nextFormat], state, {}, () => [1, 2])
  const next = createReleaseSnapshot([nextFormat], nextState, released, () => ({ ...samples(), 'v2.json': 'next-digest' }))
  assert.deepEqual(validateReleaseHistory(released, next), [])
  assert.deepEqual(next.formats.test.versions, { 1: 'old', 2: 'next' })
})

test('JSON 不能代替归档，包版本与文档头版本独立枚举', () => {
  const archive = { ...format, requiredFixtures: [{ extension: 'json' }, { extension: 'henjiimg' }] }
  assert.match(validateCompatibility([archive], baseline(), (_id, ext) => ext === 'henjiimg' ? [] : [1]).join(''), /v1.henjiimg/)
  const owner = { ...format, id: 'package', version: 3, migrations: { 1: x => x, 2: x => x } }
  const header = { ...format, requiredFixtures: [{ extension: 'henjiimg', versionFormat: 'package' }] }
  const state = baseline(); state.formats.package = { version: 3, fingerprint: 'old', supportedFrom: 2 }
  state.devBreaks.push({ format: 'package', waivedFixtureVersions: [1] })
  assert.match(validateCompatibility([header, owner], state, (_id, ext) => ext === 'henjiimg' ? [3] : [1, 2, 3]).join(''), /test\/v2.henjiimg/)
})

test('框架首发登记保留支持下限与历史，不能重复或在发布后执行', () => {
  const state = baseline()
  const options = { frameworkAdoption: true, reason: '首发前独立外壳与记录版本，不改变内容支持范围' }
  const registered = updateBaseline([{ ...format, fingerprint: 'new' }], state, options, () => [1])
  assert.equal(registered.formats.test.supportedFrom, 1)
  assert.deepEqual(registered.devBreaks, state.devBreaks)
  assert.equal(registered.frameworkAdoption.formats[0].previousFingerprint, 'old')
  assert.throws(() => updateBaseline([format], registered, options, () => [1]), /仅允许/)
  assert.throws(() => updateBaseline([format], { ...state, releasedCompatibility: true }, options, () => [1]), /仅允许/)
})
