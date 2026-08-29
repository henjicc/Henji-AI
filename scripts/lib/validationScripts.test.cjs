const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '..', '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

test('electron:bundle 只生成运行产物，不暗中执行完整质量门禁', () => {
  const script = packageJson.scripts['electron:bundle']
  assert.equal(script, 'node scripts/run-electron-bundle.cjs')
  assert.doesNotMatch(script, /check:|vitest|\btsc\b|\blint\b|electron:build/)
})

test('发布构建仍保留完整静态与助手能力门禁', () => {
  const script = packageJson.scripts['electron:build']
  assert.match(script, /check:assistant-capabilities/)
  assert.match(script, /check:sdk/)
  assert.match(script, /tsc -p tsconfig\.electron\.json/)
  assert.match(script, /electron-vite build/)
})
