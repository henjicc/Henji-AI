const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { GPU_TEST_FILES, IMAGE_EXPORT_TEST_FILES, ALL_TEST_PATTERNS, testSuiteOptions, testSuiteForFile } = require('./testSuites.cjs')

const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const workflow = read('.github/workflows/build.yml')
const scripts = JSON.parse(read('package.json')).scripts

function testFiles(directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist', 'out', '.git'].includes(entry.name)) return []
    const file = `${directory}/${entry.name}`
    return entry.isDirectory() ? testFiles(file) : /\.test\.tsx?$/.test(entry.name) ? [file] : []
  })
}

test('普通/真实 GPU/大图套件互斥且覆盖完整清单，默认 test 仍是全量', () => {
  const files = ['src', 'electron', 'packages'].flatMap(testFiles)
  const special = [...GPU_TEST_FILES, ...IMAGE_EXPORT_TEST_FILES]
  assert.equal(new Set(special).size, special.length, '专项测试不能重复归类')
  for (const file of special) assert.ok(files.includes(file), `专项文件不存在：${file}`)
  assert.deepEqual(testSuiteOptions('unit'), { include: ALL_TEST_PATTERNS, exclude: special })
  assert.deepEqual(testSuiteOptions('unit', ['**/node_modules/**']).exclude, ['**/node_modules/**', ...special])
  assert.deepEqual(testSuiteOptions('test'), { include: ALL_TEST_PATTERNS })
  assert.equal(scripts.test, 'vitest run')
  for (const file of files) {
    const matching = ['unit', 'gpu', 'image-export'].filter((suite) => {
      const options = testSuiteOptions(suite)
      return suite === 'unit' ? !options.exclude.includes(file) : options.include.includes(file)
    })
    assert.deepEqual(matching, [testSuiteForFile(file)], file)
  }
})

test('真实 vgpu/node 测试不能漏进普通单测，新增原生测试必须登记', () => {
  const actual = ['src', 'electron', 'packages'].flatMap(testFiles)
    .filter((file) => /(?:from\s*|import\s*\()\s*['"]vgpu\/node['"]/.test(read(file)))
  assert.deepEqual(actual.sort(), [...GPU_TEST_FILES].sort())
  const probe = read('src/core/imageEdit/testing/vgpuImpulseProbe.gpu.test.ts')
  assert.doesNotMatch(probe, /process\.env|\.skip\(/)
  assert.match(probe, /runVgpuHdrImpulseProbe\(gpu\)/)
})

test('CI 对每层执行明确命令，初始化失败不能自动跳过，发布依赖全部门禁', () => {
  for (const mode of ['unit', 'gpu', 'image-export']) {
    assert.equal(scripts[`test:${mode}`], `vitest run --mode ${mode}`)
    assert.ok(workflow.includes(`run: npm run test:${mode}`), `${mode} 未接入 CI`)
  }
  assert.match(workflow, /vgpu install-software-renderer/)
  assert.match(workflow, /vgpu doctor --pretty/)
  assert.match(workflow, /VGPU_ADAPTER: software/)
  assert.match(workflow, /needs: \[checks, gpu-tests, image-export-tests\]/)
  assert.match(workflow, /needs: quality-gate/)
  for (const result of ['CHECKS_RESULT', 'GPU_RESULT', 'IMAGE_EXPORT_RESULT']) {
    assert.ok(workflow.includes(`test "$${result}" = success`))
  }
  assert.doesNotMatch(workflow, /continue-on-error:\s*true|\|\|\s*true/)
  for (const mode of ['gpu', 'image-export']) {
    assert.equal(testSuiteOptions(mode).maxWorkers, 1)
    assert.equal(testSuiteOptions(mode).fileParallelism, false)
  }
})
