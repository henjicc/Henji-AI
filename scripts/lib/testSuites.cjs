// 同一清单同时用于 Vitest 与门禁自检；GPU 算法测试不以设备缺失为由跳过。
const GPU_TEST_FILES = [
  'src/features/imageEdit/v3/gpu/imageEditorGpuColorPipelineV3.test.ts',
  'src/features/imageEdit/v3/gpu/imageEditorGpuExportMultiscaleV3.test.ts',
  'src/features/imageEdit/v3/gpu/imageEditorGpuExportResidualV3.test.ts',
  'src/features/imageEdit/v3/gpu/imageEditorGpuRasterCompositorV3.test.ts',
  'src/features/imageEdit/v3/gpu/imageEditorGpuRenderGraphV3.test.ts',
  'src/features/imageEdit/v3/gpu/imageEditorGpuGraphSourceGeometryV3.test.ts',
  'src/features/imageEdit/v3/gpu/imageEditorGpuBrushHistoryV3.test.ts',
  'src/features/imageEdit/v3/gpu/imageEditorGpuSparseAnnotationV3.test.ts',
  'src/core/imageEdit/testing/vgpuImpulseProbe.gpu.test.ts',
]
const IMAGE_EXPORT_TEST_FILES = [
  'src/features/imageEdit/v3/export/renderExportSourceGeometryV3.test.ts',
]
// 唯一原生 SQLite 清单：运行器与分层门禁共同消费，不以条件 skip 代替真实执行。
const NATIVE_TEST_FILES = [
  'electron/main/services/application-runtime/operationStore.test.ts',
  'electron/main/services/application-runtime/mediaResources.native.test.ts',
  'electron/main/services/ai-runtime/generation-submissions.test.ts',
  'src/features/application-control/mcpWriteIntegration.test.ts',
  'electron/main/services/assistant/memory-store.test.ts',
  'electron/main/services/logging/agent-trace-store.test.ts',
  'electron/main/services/storyboard-projects.storage.test.ts',
  'src/stores/projectPersistenceQueue.storage.test.ts',
]
// 这两个文件在用例内起真实本机 HTTP 服务，并让 SSE 连接被客户端中止。放在默认 threads 池里，
// worker 线程会带着尚未释放的 socket 句柄被池收尾终止，Windows 上稳定以 0xC0000005 段错误结束
// 整个进程：全部用例都已通过，崩在池收尾之后，所以它不是断言失败，而是门禁本身不可信。
// 用独立进程跑这两个文件即可正常退出，理由与 GPU/大图/原生清单用 forks 相同。
const FORK_POOL_TEST_FILES = [
  'electron/main/services/embedded-agent/piEngine.test.ts',
  'electron/main/services/embedded-agent/servicePi.test.ts',
]
const FORK_POOL_MATCH_GLOBS = FORK_POOL_TEST_FILES.map((file) => [`**/${file}`, 'forks'])
const ALL_TEST_PATTERNS = ['src/**/*.test.{ts,tsx}', 'electron/**/*.test.ts', 'packages/*/**/*.test.ts']

function testSuiteForFile(file) {
  if (GPU_TEST_FILES.includes(file)) return 'gpu'
  if (IMAGE_EXPORT_TEST_FILES.includes(file)) return 'image-export'
  if (NATIVE_TEST_FILES.includes(file)) return 'native'
  return 'unit'
}

function testSuiteOptions(mode, defaultExcludes = []) {
  if (mode === 'unit') return { include: ALL_TEST_PATTERNS, exclude: [...defaultExcludes, ...GPU_TEST_FILES, ...IMAGE_EXPORT_TEST_FILES, ...NATIVE_TEST_FILES], poolMatchGlobs: FORK_POOL_MATCH_GLOBS }
  // 原生 Dawn 不在多线程中并发初始化；重图测试独占 worker，避免全量单测争抢 CPU/内存。
  if (mode === 'gpu' || mode === 'image-export' || mode === 'native') return {
    include: mode === 'gpu' ? GPU_TEST_FILES : mode === 'native' ? NATIVE_TEST_FILES : IMAGE_EXPORT_TEST_FILES,
    pool: 'forks', minWorkers: 1, maxWorkers: 1, fileParallelism: false,
  }
  return { include: ALL_TEST_PATTERNS, poolMatchGlobs: FORK_POOL_MATCH_GLOBS }
}

module.exports = { GPU_TEST_FILES, IMAGE_EXPORT_TEST_FILES, NATIVE_TEST_FILES, FORK_POOL_TEST_FILES, FORK_POOL_MATCH_GLOBS, ALL_TEST_PATTERNS, testSuiteForFile, testSuiteOptions }
