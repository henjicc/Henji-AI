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
  'electron/main/services/agent-runtime/persistence/permission-audit-store.test.ts',
  'electron/main/services/agent-runtime/persistence/artifact-store.test.ts',
  'electron/main/services/agent-runtime/persistence/store.test.ts',
  'electron/main/services/agent-runtime/persistence/migration-13.test.ts',
  'electron/main/services/agent-runtime/persistence/session-store.test.ts',
  'electron/main/services/agent-runtime/persistence/external-wait-store.test.ts',
  'electron/main/services/assistant/memory-store.test.ts',
  'electron/main/services/logging/agent-trace-store.test.ts',
  'electron/main/services/storyboard-projects.storage.test.ts',
  'src/stores/projectPersistenceQueue.storage.test.ts',
]
const ALL_TEST_PATTERNS = ['src/**/*.test.{ts,tsx}', 'electron/**/*.test.ts', 'packages/*/**/*.test.ts']

function testSuiteForFile(file) {
  if (GPU_TEST_FILES.includes(file)) return 'gpu'
  if (IMAGE_EXPORT_TEST_FILES.includes(file)) return 'image-export'
  if (NATIVE_TEST_FILES.includes(file)) return 'native'
  return 'unit'
}

function testSuiteOptions(mode, defaultExcludes = []) {
  if (mode === 'unit') return { include: ALL_TEST_PATTERNS, exclude: [...defaultExcludes, ...GPU_TEST_FILES, ...IMAGE_EXPORT_TEST_FILES, ...NATIVE_TEST_FILES] }
  // 原生 Dawn 不在多线程中并发初始化；重图测试独占 worker，避免全量单测争抢 CPU/内存。
  if (mode === 'gpu' || mode === 'image-export' || mode === 'native') return {
    include: mode === 'gpu' ? GPU_TEST_FILES : mode === 'native' ? NATIVE_TEST_FILES : IMAGE_EXPORT_TEST_FILES,
    pool: 'forks', minWorkers: 1, maxWorkers: 1, fileParallelism: false,
  }
  return { include: ALL_TEST_PATTERNS }
}

module.exports = { GPU_TEST_FILES, IMAGE_EXPORT_TEST_FILES, NATIVE_TEST_FILES, ALL_TEST_PATTERNS, testSuiteForFile, testSuiteOptions }
