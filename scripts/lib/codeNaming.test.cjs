const assert = require('node:assert/strict')
const { test } = require('node:test')
const { hasIterationName, hasNumberedComment, inspectSource, productExceptions, fingerprintComment, compareNaming, scanNamingFacts, protectAllowlist, allowlistAdditions, formatAllowlistAdditions } = require('./codeNaming.cjs')

const empty = () => ({ directories: [], files: [], exports: [], comments: [] })

test('分词识别版本与相对命名，AST 不把字符串、正则和模板当注释', () => {
  for (const name of ['ImageMarkToolV3Host', 'old-source', 'legacyStyles', 'StyleNew', 'foo_new', 'work_v2']) assert.equal(hasIterationName(name), true, name)
  for (const name of ['preview', 'renewal', 'av1', 'pp-ocrv6_tiny_det.onnx', 'Nv12', 'NEW_STYLE', 'TIMELINE_NEW_TRACK_ZONE', 'newEmbeddedConversation']) assert.equal(hasIterationName(name), false, name)
  assert.equal(hasIterationName('newEmbeddedConversation', ['oldEmbeddedConversation']), true)
  assert.equal(hasIterationName('TIMELINE_NEW_TRACK_ZONE', ['TIMELINE_OLD_TRACK_ZONE']), true)
  const code = [
    'const text = "// 任务 3.2"',
    'const template = `/* 重要记录 008 */ ${text} // 任务 4.2`',
    'const pattern = /\\/\\/任务 3.2/',
    '/** 任务 3.2 */',
    'export const { value: toolV2 } = { value: true }',
    'export { toolV2 as LegacyTool }',
    'module.exports = { NewTool: toolV2 }',
    'exports.OldTool = toolV2',
    'const element = <div>{/* 实施方案 2.4 */}</div>',
    'const label = <div>// 任务 8.2</div>',
    'function close() { /* t123 */ }',
  ].join('\n')
  const facts = inspectSource('src/example.tsx', code)
  assert.deepEqual(facts.names.sort(), ['LegacyTool', 'NewTool', 'OldTool', 'toolV2'])
  assert.deepEqual(facts.comments.map(comment => comment.text), ['/** 任务 3.2 */', '/* 实施方案 2.4 */', '/* t123 */'])
})

test('注释编号依赖任务、阶段、清单或括号说明上下文，数值与版本不命中', () => {
  for (const comment of ['任务 3', '任务 3.2', '任务 3.2.1', '阶段 2.3.4', '实施方案 2.4.1', '本任务（2.4）', '（3.5 图片文档）', '（3.5图片文档）', '镜头参考（3.2）',
    '3.4 第 17 项', '阶段 2.3', '3.5 阶段', '2.2 已经执行', '2.3 之前的工程表', '4.1 起来源统一', '重要记录 008', '实施方案 2.4', 't123',
    '阈值（1.3 定稿）', '记录 010 的实算基于石墨种子', '（4.3 只对标准档断言；5.11 组合测试）',
    '口播 IPC（3.3 口播接入）', 'Escape（5.6 第二批 B-43）', '全局 store（5.3 建 store，5.4 加 revision）']) {
    assert.equal(hasNumberedComment(comment), true, comment)
    assert.equal(scanNamingFacts([inspectSource('src/a.ts', `/* ${comment} */`)], { version: 1, entries: [] }, () => '').naming.comments.length, 1, comment)
  }
  for (const comment of ['版本号 3.5', '版本 3.5', '版本（3.5）', '版本号（3.5）', '版本 3.5 之前', '版本 v3.5 起支持', 'V3.5 起支持', 'version 3.5 起支持', '1.3.5 起支持', '版本 3.5 第 17 项', '尺寸（3.5）', '3.5 秒', '耗时（3.5 秒）', '任务 3.5 秒完成',
    '任务 3 次', '任务 30个', '任务 3 路', '阶段 3 条', '阶段 3 帧', '阶段 3 秒', '任务（3.5个）', '任务 3 组', '阶段 3 步',
    'Electron 42.0 起支持', 'Node 20.11 之后可用', 'Node（20.11 之后）', 'gamma 2.2 已经校正', 'Electron 42.0 第 17 项', '记录 100条结果',
    '（0.5 以下视为静音）', '（0.85 默认）', '（5.1 环绕）', '（2.2 伽马）',
    '1.0 已经是上限', '小于 0.1 之后截断', '帧率 29.97 之后',
    '第 3 帧', '1920×1080', '尺寸 3.5 × 2.4', '宽度（3.5）', '错动约 1px（4.1）', '数据库版本 15：删除工程表']) assert.equal(hasNumberedComment(comment), false, comment)
})

test('目录残留单独登记，既有目录可继续使用，新目录与成对命名不能借存量通过', () => {
  const scan = texts => scanNamingFacts(Object.entries(texts).map(([file, text]) => inspectSource(file, text)), { version: 1, entries: [] }, () => '').naming
  const baseline = scan({ 'src/fooV2/a.ts': '', 'src/legacy/b.ts': '', 'src/newTool/create.ts': '' })
  assert.deepEqual(baseline.directories, ['src/fooV2', 'src/legacy'])
  assert.deepEqual(compareNaming(scan({ 'src/fooV2/a.ts': '', 'src/fooV2/extra.ts': '', 'src/legacy/b.ts': '' }), baseline, baseline), [])
  const added = scan({ 'src/fooV2/a.ts': '', 'src/barV2/b.ts': '' })
  assert.match(compareNaming(added, baseline, baseline).join('\n'), /新增命名残留：directory:src\/barV2/)
  const paired = scan({ 'src/newTool/a.ts': '', 'src/oldTool/b.ts': '', 'src/newTool.ts': '', 'src/oldTool.ts': '',
    'src/exports.ts': 'export const newTool = 1; export const oldTool = 2' })
  assert.deepEqual(paired.directories, ['src/newTool', 'src/oldTool'])
  assert.deepEqual(paired.files, ['src/newTool.ts', 'src/oldTool.ts'])
  assert.equal(paired.exports.length, 2)
})

test('白名单过期须删除，已有文件、目录、导出基线不能转成长期例外', () => {
  const entry = { category: 'migration', file: 'src/a.ts', name: 'ToolV2', reason: '读取指定历史格式' }
  for (const facts of [[], [inspectSource('src/a.ts', 'export const tool = 1')]]) {
    assert.throws(() => scanNamingFacts(facts, { version: 1, entries: [entry] }, () => ''), /过期命名白名单/)
  }
  assert.throws(() => scanNamingFacts([inspectSource('src/a.ts', 'export const newTool = 1')], {
    version: 1, entries: [{ ...entry, name: 'newTool' }],
  }, () => ''), /过期命名白名单/)
  const baseline = { ...empty(), exports: [{ file: entry.file, name: entry.name }], files: ['src/aV2.ts'], directories: ['src/legacy'] }
  const entries = [entry, { ...entry, file: 'src/aV2.ts', name: 'aV2.ts' }, { ...entry, file: 'src/legacy', name: 'legacy' }]
  assert.equal(protectAllowlist({ entries }, baseline).length, 3)
  assert.match(protectAllowlist({ entries: [{ ...entry, file: 'src/moved.ts' }] }, baseline)[0], /不得转入白名单/)
  assert.match(protectAllowlist({ entries: [{ ...entry, name: 'ToolV3' }] }, baseline)[0], /不得转入白名单/)
  assert.match(protectAllowlist({ entries: [{ ...entry, file: 'src/moved.ts', name: 'ToolV3' }] }, baseline)[0], /不得转入白名单/)
  assert.match(protectAllowlist({ entries: [{ ...entry, file: 'src/moved-tool-v3.ts', name: 'tool-v3.ts' }] }, baseline)[0], /不得转入白名单/)
  assert.deepEqual(protectAllowlist({ entries: [{ ...entry, name: 'OtherV1' }] }, baseline), [])
  assert.deepEqual(protectAllowlist({ entries }, undefined), [])
})

test('新增白名单逐条列出完整内容，保留已有条目不重复报告', () => {
  const existing = { category: 'migration', file: 'src/a.ts', name: 'DataV1', reason: '读取指定格式' }
  const added = { ...existing, file: 'src/b.ts', name: 'OtherV1' }
  const entries = allowlistAdditions({ entries: [existing, added] }, { entries: [existing] })
  assert.deepEqual(entries, [added])
  assert.deepEqual(formatAllowlistAdditions(entries), [`新增命名白名单：${JSON.stringify(added)}`])
  assert.equal(allowlistAdditions({ entries: [existing, added] }, undefined).length, 2)
})

test('指纹不依赖行号，注释改写与复制不能借存量额度通过，基线只能缩减', () => {
  const hash = fingerprintComment('/* 任务 3.2 */')
  assert.equal(fingerprintComment('  /* 任务 3.2 */\r\n'), fingerprintComment('/* 任务 3.2 */\n'))
  const baseline = { ...empty(), comments: [{ file: 'src/example.ts', fingerprint: hash, count: 1 }] }
  const moved = inspectSource('src/example.ts', '\n\n/* 任务 3.2 */\nexport const tool = true')
  assert.equal(moved.comments[0].fingerprint, hash)
  assert.deepEqual(compareNaming(baseline, baseline, baseline), [])
  const copied = { ...empty(), comments: [{ ...baseline.comments[0], count: 2 }] }
  assert.match(compareNaming(copied, baseline, baseline).join('\n'), /新增命名残留/)
  assert.match(compareNaming(copied, copied, baseline).join('\n'), /只许减少/)
  assert.match(compareNaming(empty(), baseline, baseline).join('\n'), /过期命名基线/)
  assert.deepEqual(compareNaming(empty(), baseline, baseline, true), [])
  const edited = { ...empty(), comments: [{ ...baseline.comments[0], fingerprint: fingerprintComment('/* 任务 3.2：原因 */') }] }
  assert.match(compareNaming(edited, baseline, baseline).join('\n'), /新增命名残留/)
})

test('产品例外来自正式登记及对应入口，不放宽同目录的其他版本命名', () => {
  const texts = {
    'packages/ai-sdk/src/catalog/demo/product-v2.model.ts': "export const productV2 = defineModel({ meta: { id: 'product-v2' } })",
    'packages/ai-sdk/src/packs/models/demo/product-v2.ts': "import model from '../../../catalog/demo/product-v2.model'; export { model }",
    'packages/ai-sdk/src/catalog/demo/ToolV2.ts': 'export const ToolV2 = true',
  }
  const keys = productExceptions(Object.entries(texts).map(([file, text]) => inspectSource(file, text)), file => texts[file])
  assert.ok(keys.has('packages/ai-sdk/src/catalog/demo/product-v2.model.ts:productV2'))
  assert.ok(keys.has('packages/ai-sdk/src/packs/models/demo/product-v2.ts:product-v2.ts'))
  assert.ok(!keys.has('packages/ai-sdk/src/catalog/demo/ToolV2.ts:ToolV2'))
})

test('精确白名单不放过同文件的其他版本符号，编号注释不能登记为长期例外', () => {
  const facts = [inspectSource('src/migration.ts', 'export class LayerStackV1ImportError extends Error {}\nexport const toolV2 = true\n/* 任务 3.2 */')]
  const result = scanNamingFacts(facts, { version: 1, entries: [
    { category: 'migration', file: 'src/migration.ts', name: 'LayerStackV1ImportError', reason: '读取指定历史图层格式的迁移错误' },
  ] }, () => '')
  assert.equal(result.exempt, 1)
  assert.deepEqual(result.naming.exports, [{ file: 'src/migration.ts', name: 'toolV2' }])
  assert.equal(result.naming.comments.length, 1)
  assert.throws(() => scanNamingFacts(facts, { version: 1, entries: [
    { category: 'migration', file: 'src/*', name: 'toolV2', reason: '不应放宽目录' },
  ] }, () => ''), /精确路径/)
})
