const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validateCompatibility, updateBaseline, main } = require('./check-persistence-compat.cjs')
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
  assert.throws(() => updateBaseline([format], state, { devBreak: 'test', reason: 'no' }, () => [1]), /已正式启用向后兼容/)
  const adopted = { ...state, formats: { test: { version: 2, fingerprint: 'old', supportedFrom: 2 } }, devBreaks: [{ format: 'test', version: 2, reason: '接入前版本', waivedFixtureVersions: [1] }] }
  assert.deepEqual(validateCompatibility([{ ...format, version: 2 }], adopted, () => [2]), [])
  assert.throws(() => updateBaseline([{ ...format, version: 3 }], adopted, {}, () => [2, 3]), /v2 → v3/)
})
test('最低可读版本：同版本不得改变，升版本可提高不可降低', () => {
  const state = baseline(); state.formats.test.minReaderVersion = 1
  assert.match(validateCompatibility([{ ...format, version: 1, minReaderVersion: 2 }], state, () => [1]).join(''), /最低可读版本与基线不一致/)
  const optional = { ...format, version: 2, fingerprint: 'new', minReaderVersion: 1, migrations: { 1: () => ({}) } }
  assert.equal(updateBaseline([optional], state, {}, () => [1, 2]).formats.test.minReaderVersion, 1)
  const raised = updateBaseline([{ ...optional, minReaderVersion: 2 }], state, {}, () => [1, 2])
  assert.equal(raised.formats.test.minReaderVersion, 2)
  assert.match(validateCompatibility([{ ...optional, version: 3, minReaderVersion: 1 }], raised, () => [1, 2, 3]).join(''), /不能降低/)
})
test('兼容起点一次性登记：当前版本为支持下限，清空开发期豁免，之后拒绝 dev-break', () => {
  const dev = { ...baseline(), devBreaks: [{ format: 'test', version: 1, reason: '开发期' }] }
  const current = { ...format, version: 2, fingerprint: 'new', migrations: {} }
  assert.throws(() => updateBaseline([current], dev, { compatibilityStart: true }, () => [2]), /非空 --reason/)
  const start = updateBaseline([current], dev, { compatibilityStart: true, reason: '正式启用' }, () => [2])
  assert.deepEqual(start.formats.test, { version: 2, fingerprint: 'new', supportedFrom: 2, minReaderVersion: 2 })
  assert.equal(start.releasedCompatibility, true); assert.deepEqual(start.devBreaks, [])
  assert.deepEqual(validateCompatibility([current], start, () => [2]), [])
  assert.throws(() => updateBaseline([current], start, { compatibilityStart: true, reason: '再来' }, () => [2]), /只能在首次/)
  assert.throws(() => updateBaseline([current], start, { devBreak: 'test', reason: 'x' }, () => [2]), /已正式启用向后兼容/)
  assert.throws(() => updateBaseline([current], start, { waiveBefore: true }, () => [2]), /已正式启用向后兼容/)
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
  assert.throws(() => updateBaseline([], { ...baseline(), releasedCompatibility: true }, { devBreak: 'test', reason: '删除' }, () => []), /已正式启用向后兼容/)
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

function restorationCase() {
  const current = { ...format, version: 3, migrations: { 1: value => value, 2: value => value } }
  const state = { ...baseline(), formats: { test: { version: 3, fingerprint: 'old', supportedFrom: 3 } },
    devBreaks: [{ format: 'test', version: 3, reason: '历史中断', waivedFixtureVersions: [1, 2] }],
    compatibilityRestorations: [{ at: '2026-10-14T00:00:00.000Z', format: 'retired-other', version: 2, previousSupportedFrom: 2, supportedFrom: 1, reason: '既有记录' }] }
  const options = { restoreSupport: ['test:1'], reason: '补齐无损迁移恢复用户数据读取' }
  return { current, state, options }
}

test('补迁移恢复支持保留历史和指纹，登记完整审计且普通刷新不重复登记', () => {
  const { current, state, options } = restorationCase()
  const original = structuredClone(state)
  const next = updateBaseline([current], state, options, () => [1, 2, 3])
  assert.deepEqual(state, original)
  assert.deepEqual(next.devBreaks, state.devBreaks)
  assert.equal(next.compatibilityRestorations.length, 2)
  assert.deepEqual(next.compatibilityRestorations[0], state.compatibilityRestorations[0])
  const audit = next.compatibilityRestorations[1]
  assert.match(audit.at, /^\d{4}-/)
  assert.deepEqual({ ...audit, at: undefined }, { at: undefined, format: 'test', version: 3,
    previousSupportedFrom: 3, supportedFrom: 1, reason: options.reason,
    previousFingerprint: 'old', fingerprint: 'old', migrationVersions: [1, 2] })
  assert.equal(next.formats.test.supportedFrom, 1)
  assert.deepEqual(validateCompatibility([current], next, () => [1, 2, 3]), [])
  assert.deepEqual(updateBaseline([current], next, {}, () => [1, 2, 3]), next)
  assert.throws(() => updateBaseline([current], next, options, () => [1, 2, 3]), /降低支持下限/)
})

test('恢复范围不能沿用样本豁免，缺步、非函数步骤和缺归档均拒绝且不改变原基线', () => {
  const { current, state, options } = restorationCase()
  const original = structuredClone(state)
  for (const migrations of [{ 1: value => value }, { 1: value => value, 2: null }]) {
    assert.throws(() => updateBaseline([{ ...current, migrations }], state, options, () => [1, 2, 3]), /缺少逐版本迁移/)
  }
  assert.throws(() => updateBaseline([current], state, options, () => [3]), /缺少必需黄金样本/)
  const archive = { ...current, requiredFixtures: [{ extension: 'json' }, { extension: 'henjipack' }] }
  assert.throws(() => updateBaseline([archive], state, options, (_id, ext) => ext === 'henjipack' ? [3] : [1, 2, 3]), /v1.henjipack/)
  assert.deepEqual(state, original)
})

test('手改下限而不追加恢复审计会被检查和普通基线刷新拒绝', () => {
  const { current, state } = restorationCase()
  state.formats.test.supportedFrom = 1
  assert.match(validateCompatibility([current], state, () => [1, 2, 3]).join(''), /支持下限与审计不一致/)
  assert.throws(() => updateBaseline([current], state, {}, () => [1, 2, 3]), /支持下限与审计不一致/)
})

test('恢复登记拒绝错格式、错下限、空理由、重复项、破坏性混用及同版本结构变化', () => {
  const { current, state, options } = restorationCase()
  for (const spec of ['missing:1', 'test:0', 'test:-1', 'test:1.5', 'test:3', 'test:4', 'test:9007199254740992', 'test', 'test:1:2']) {
    assert.throws(() => updateBaseline([current], state, { ...options, restoreSupport: [spec] }, () => [1, 2, 3]))
  }
  for (const extra of [{ reason: ' ' }, { devBreak: 'test' }, { waiveBefore: true }, { init: true }, { frameworkAdoption: true }, { restoreSupport: ['test:1', 'test:2'] }]) {
    assert.throws(() => updateBaseline([current], state, { ...options, ...extra }, () => [1, 2, 3]))
  }
  for (const extra of [{ version: 4 }, { fingerprint: 'changed' }, { storage: 'sqlite-ledger' }]) {
    assert.throws(() => updateBaseline([{ ...current, ...extra }], state, options, () => [1, 2, 3, 4]))
  }
  assert.throws(() => main(['--restore-support']), /缺少参数/)
  assert.throws(() => main(['--restore-support', 'test:1', '--reason', '恢复']), /persistence:baseline/)
})

test('可一次恢复多个格式；正式发布后也允许扩大支持且不改写发布快照', () => {
  const { current, state, options } = restorationCase()
  state.releasedCompatibility = true
  state.formats.other = { ...state.formats.test }
  const formats = [current, { ...current, id: 'other' }]
  const samples = () => ({ 'v3.json': 'immutable' })
  const released = createReleaseSnapshot(formats, state, emptyRelease(), samples)
  const original = structuredClone(released)
  const next = updateBaseline(formats, state, { ...options, restoreSupport: ['test:1', 'other:2'] }, () => [1, 2, 3])
  assert.equal(next.formats.test.supportedFrom, 1)
  assert.equal(next.formats.other.supportedFrom, 2)
  assert.deepEqual(validateReleasedCompatibility(formats, next, released, () => ({ ...samples(), 'v1.json': 'first', 'v2.json': 'second' })), [])
  assert.deepEqual(released, original)
})
