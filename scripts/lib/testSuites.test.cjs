const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { GPU_TEST_FILES, IMAGE_EXPORT_TEST_FILES, NATIVE_TEST_FILES, FFMPEG_CLI_TEST_FILES, FORK_POOL_TEST_FILES, FORK_POOL_MATCH_GLOBS, ALL_TEST_PATTERNS, testSuiteOptions, testSuiteForFile } = require('./testSuites.cjs')

const root = path.resolve(__dirname, '../..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const workflow = read('.github/workflows/build.yml')
const scripts = JSON.parse(read('package.json')).scripts

/** 取 workflow 中某个 job 的完整文本：从 `  <id>:` 到下一个同级 job，不依赖 job 的先后顺序。 */
function workflowJob(id) {
  const lines = workflow.split(/\r?\n/)
  const start = lines.indexOf(`  ${id}:`)
  if (start < 0) return null
  const end = lines.findIndex((line, index) => index > start && /^ {2}[A-Za-z0-9_-]+:\s*$/.test(line))
  const block = lines.slice(start, end < 0 ? undefined : end)
  // 下一个 job 前的空行与同级注释属于下一个 job 的说明，不算进本 job。
  while (block.length > 1 && /^\s*$|^ {2}#/.test(block.at(-1))) block.pop()
  return block.join('\n')
}

function testFiles(directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist', 'out', '.git'].includes(entry.name)) return []
    const file = `${directory}/${entry.name}`
    return entry.isDirectory() ? testFiles(file) : /\.test\.tsx?$/.test(entry.name) ? [file] : []
  })
}

test('普通/真实 GPU/大图/原生 SQLite/FFmpeg CLI 互斥且覆盖完整清单，默认 test 仍是全量', () => {
  const files = ['src', 'electron', 'packages'].flatMap(testFiles)
  const special = [...GPU_TEST_FILES, ...IMAGE_EXPORT_TEST_FILES, ...NATIVE_TEST_FILES, ...FFMPEG_CLI_TEST_FILES]
  assert.equal(new Set(special).size, special.length, '专项测试不能重复归类')
  for (const file of special) assert.ok(files.includes(file), `专项文件不存在：${file}`)
  assert.deepEqual(testSuiteOptions('unit'), { include: ALL_TEST_PATTERNS, exclude: special, poolMatchGlobs: FORK_POOL_MATCH_GLOBS })
  assert.deepEqual(testSuiteOptions('unit', ['**/node_modules/**']).exclude, ['**/node_modules/**', ...special])
  assert.deepEqual(testSuiteOptions('test'), { include: ALL_TEST_PATTERNS, poolMatchGlobs: FORK_POOL_MATCH_GLOBS })
  assert.equal(scripts.test, 'vitest run')
  for (const file of files) {
    const matching = ['unit', 'gpu', 'image-export', 'native', 'ffmpeg-cli'].filter((suite) => {
      const options = testSuiteOptions(suite)
      return suite === 'unit' ? !options.exclude.includes(file) : options.include.includes(file)
    })
    assert.deepEqual(matching, [testSuiteForFile(file)], file)
  }
  // forks 清单只改池、不改归属：文件必须真实存在，且仍留在普通层里跑，
  // 否则会出现"以为它跑了、实际被踢出清单"的静默漏测。
  for (const file of FORK_POOL_TEST_FILES) {
    assert.ok(files.includes(file), `forks 清单文件不存在：${file}`)
    assert.equal(testSuiteForFile(file), 'unit', `forks 清单只改执行池，不得改变归属：${file}`)
    assert.ok(!testSuiteOptions('unit').exclude.includes(file), `forks 清单文件不得被普通层排除：${file}`)
  }
})

test('全部 Electron 条件 SQLite 文件必须进入唯一原生清单，不混入独立基准开关', () => {
  // 当前显式 Electron 条件均是 SQLite 边界；将来其他 Electron 专项需另行分类，
  // 不能据此推断所有 Electron 测试都属于 SQLite，也不能默默留在普通 Node 中跳过。
  const actual = ['src', 'electron', 'packages'].flatMap(testFiles)
    .filter((file) => /process\.versions\.electron/.test(read(file)))
  assert.deepEqual(actual.sort(), [...NATIVE_TEST_FILES].sort())
  assert.ok(!NATIVE_TEST_FILES.includes('electron/main/services/image/diffusion-fallback.benchmark.test.ts'))
  assert.match(read('scripts/test-assistant-persistence.cjs'), /require\('\.\/lib\/testSuites\.cjs'\)/)
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
  for (const mode of ['unit', 'gpu', 'image-export', 'ffmpeg-cli']) {
    assert.equal(scripts[`test:${mode}`], `vitest run --mode ${mode}`)
    assert.ok(workflow.includes(`run: npm run test:${mode}`), `${mode} 未接入 CI`)
  }
  assert.match(workflow, /vgpu install-software-renderer/)
  assert.match(workflow, /vgpu doctor --pretty/)
  assert.match(workflow, /VGPU_ADAPTER: software/)
  assert.match(workflow, /needs: \[checks, unit-tests, gpu-tests, image-export-tests, native-tests, video-decoder-tests\]/)
  assert.match(workflow, /needs: quality-gate/)
  const gate = workflowJob('quality-gate')
  assert.ok(gate, '需要聚合质量门禁 job')
  for (const [result, job] of [['CHECKS_RESULT', 'checks'], ['UNIT_RESULT', 'unit-tests'], ['GPU_RESULT', 'gpu-tests'], ['IMAGE_EXPORT_RESULT', 'image-export-tests'], ['NATIVE_RESULT', 'native-tests'], ['VIDEO_DECODER_RESULT', 'video-decoder-tests']]) {
    assert.ok(gate.includes(`${result}: \${{ needs.${job}.result }}`), `${result} 必须取自 ${job}`)
    assert.ok(gate.includes(`test "$${result}" = success`), `${result} 必须为 success`)
  }
  assert.doesNotMatch(workflow, /continue-on-error:\s*true|\|\|\s*true/)
  for (const mode of ['gpu', 'image-export', 'native']) {
    assert.equal(testSuiteOptions(mode).maxWorkers, 1)
    assert.equal(testSuiteOptions(mode).fileParallelism, false)
  }
  assert.equal(scripts['test:assistant-persistence'], 'node scripts/test-assistant-persistence.cjs')
  const nativeJob = workflowJob('native-tests')
  assert.ok(nativeJob, '原生 SQLite 需要独立 Electron ABI job')
  assert.match(nativeJob, /npm run electron:rebuild/)
  assert.match(nativeJob, /node --test scripts\/lib\/nativePersistenceRunner\.test\.cjs/)
  assert.match(nativeJob, /npm run test:assistant-persistence/)
  assert.ok(nativeJob.indexOf('npm run electron:rebuild') < nativeJob.indexOf('npm run test:assistant-persistence'))
  assert.doesNotMatch(nativeJob, /video-decoder/, 'native-tests 切分不能吞进相邻 job')

  // 原生视频解码服务层：Windows runner 上固定版本 FFmpeg 获取校验 → cargo test → release 构建，均走同一脚本入口。
  const decoderJob = workflowJob('video-decoder-tests')
  assert.ok(decoderJob, '原生视频解码服务需要独立 Windows job')
  assert.match(decoderJob, /runs-on: windows-latest/)
  assert.match(decoderJob, /dtolnay\/rust-toolchain@stable/)
  const steps = ['node scripts/video-decoder-ffmpeg.cjs ensure', 'node scripts/video-decoder-ffmpeg.cjs test --locked', 'node scripts/video-decoder-ffmpeg.cjs build']
  for (const step of steps) assert.ok(decoderJob.includes(step), `video-decoder-tests 缺少：${step}`)
  assert.ok(steps.every((step, index) => index === 0 || decoderJob.indexOf(steps[index - 1]) < decoderJob.indexOf(step)), '必须先获取校验 FFmpeg，再测试与构建')
  // FFmpeg CLI 兼容层只在已获取固定版本 FFmpeg 的 Windows job 跑，必须排在 ensure 之后。
  assert.ok(decoderJob.indexOf('npm run test:ffmpeg-cli') > decoderJob.indexOf(steps[0]), 'test:ffmpeg-cli 必须在获取校验 FFmpeg 之后执行')
  assert.ok(decoderJob.indexOf('run: npm ci') > 0 && decoderJob.indexOf('run: npm ci') < decoderJob.indexOf('npm run test:ffmpeg-cli'), 'test:ffmpeg-cli 前需要安装依赖')
})
