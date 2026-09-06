// 同一清单同时用于 Vitest 与门禁自检；GPU 算法测试不以设备缺失为由跳过。
const GPU_TEST_FILES = [
  'src/features/imageEdit/v3/gpu/imageEditorGpuColorPipelineV3.test.ts',
  'src/features/imageEdit/v3/gpu/imageEditorGpuExportMultiscaleV3.test.ts',
  'src/features/imageEdit/v3/gpu/imageEditorGpuExportResidualV3.test.ts',
  'src/features/imageEdit/v3/gpu/imageEditorGpuRasterCompositorV3.test.ts',
  'src/features/imageEdit/v3/gpu/imageEditorGpuRenderGraphV3.test.ts',
  'src/features/imageEdit/v3/gpu/imageEditorGpuSparseAnnotationV3.test.ts',
  'src/core/imageEdit/testing/vgpuImpulseProbe.gpu.test.ts',
]
const IMAGE_EXPORT_TEST_FILES = [
  'src/features/imageEdit/v3/export/renderExportSourceGeometryV3.test.ts',
]
const ALL_TEST_PATTERNS = ['src/**/*.test.{ts,tsx}', 'electron/**/*.test.ts', 'packages/*/**/*.test.ts']

function testSuiteForFile(file) {
  if (GPU_TEST_FILES.includes(file)) return 'gpu'
  if (IMAGE_EXPORT_TEST_FILES.includes(file)) return 'image-export'
  return 'unit'
}

function testSuiteOptions(mode, defaultExcludes = []) {
  if (mode === 'unit') return { include: ALL_TEST_PATTERNS, exclude: [...defaultExcludes, ...GPU_TEST_FILES, ...IMAGE_EXPORT_TEST_FILES] }
  // 原生 Dawn 不在多线程中并发初始化；重图测试独占 worker，避免全量单测争抢 CPU/内存。
  if (mode === 'gpu' || mode === 'image-export') return {
    include: mode === 'gpu' ? GPU_TEST_FILES : IMAGE_EXPORT_TEST_FILES,
    pool: 'forks', minWorkers: 1, maxWorkers: 1, fileParallelism: false,
  }
  return { include: ALL_TEST_PATTERNS }
}

module.exports = { GPU_TEST_FILES, IMAGE_EXPORT_TEST_FILES, ALL_TEST_PATTERNS, testSuiteForFile, testSuiteOptions }
