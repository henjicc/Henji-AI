const { diffColorBuffers } = require('./canvasVisualDiff.cjs')
const { UI_AUDIT_RULES } = require('./uiAuditDom.cjs')
// 2026-10-14 实测同机两轮最大噪声 326 像素（约 0.011%，转圈等动画）；0.03% ≈ 880 像素，留约 2.7 倍余量，能拦下按钮大小的改动。
const GALLERY_DIFF_RATIO = 0.0003
// 深浅各一套：四预设共用同一套组件，结构回归在一套里就会暴露，其余预设的颜色差异由对比度审计覆盖。
const GALLERY_PRESETS = ['graphite', 'paper']
async function compareGalleryImages(a, b) {
  const result = await diffColorBuffers(a, b)
  return { ...result, passed: result.changedPixels / result.pixelCount <= GALLERY_DIFF_RATIO }
}
/**
 * 捕获清单：固定捕获按配置；逐屏截图（scrollCapture）截几屏由内容高度与窗口决定，按本次运行 1440×900 证据里
 * 实际截到的 name-1、name-2……展开（`captured` 为各预设的捕获后缀）。漏截由巡检的滚动覆盖检查拦下。
 */
function expectedGalleryCaptures(config, captured = {}) {
  return GALLERY_PRESETS.flatMap(preset => {
    const suffixes = captured[preset] || []
    const names = config.steps.flatMap(step => {
      if (step.capture) return [typeof step.capture === 'string' ? step.capture : step.capture.name]
      if (!step.scrollCapture) return []
      const pattern = new RegExp(`^${step.scrollCapture.name}-([0-9]+)$`)
      return suffixes.filter(suffix => pattern.test(suffix)).sort((a, b) => Number(pattern.exec(a)[1]) - Number(pattern.exec(b)[1]))
    })
    if (!names.length || new Set(names).size !== names.length || names.some(name => !/^[a-z0-9-]+$/.test(name))) throw new Error('捕获清单缺失、重复或无效')
    return names.map(name => `${preset}/1440x900-review-ui-gallery-${name}.png`)
  })
}
/** 正式证据里唯一 1440×900 窗口截到的全部后缀（逐屏截图的屏数从这里取） */
function galleryRunSuffixes(evidence) {
  const windows = Object.values(evidence.scenes || {}).map(scene => scene.window).filter(window => window?.completed && window.requestedOuter?.width === 1440 && window.requestedOuter.height === 900)
  return windows.length === 1 ? windows[0].captures.map(capture => capture.suffix) : []
}
function validateGalleryRun(audit, evidence, preset, suffixes) {
  if (audit.metadata?.themePreset !== preset || evidence.metadata?.themePreset !== preset || !Array.isArray(audit.metadata.failures) || audit.metadata.failures.length) throw new Error(`${preset}: 缺少成功的正式审计`)
  for (const result of [...Object.values(audit.scenes || {}), audit.crossScene || {}]) {
    if (UI_AUDIT_RULES.some(rule => result[rule.key]?.length) || result.gallerySamples?.some(sample => !sample.passed)) throw new Error(`${preset}: 审计仍有问题，不能写成基线`)
  }
  // 按请求尺寸筛选：Windows 外框含不可见缩放边（实测 1442×902），实际外框、DPI、缩放写进 manifest 逐项比对。
  const windows = Object.values(evidence.scenes || {}).map(scene => scene.window).filter(window => window?.completed && window.requestedOuter?.width === 1440 && window.requestedOuter.height === 900)
  if (windows.length !== 1 || !Number.isFinite(windows[0].completed.nativeScaleFactor) || !Number.isFinite(windows[0].completed.zoomFactor) || !Number.isFinite(windows[0].completed.renderer?.dpr)) throw new Error(`${preset}: 缺少唯一的 1440×900 窗口尺寸证据`)
  const window = windows[0]
  const captured = new Set(window.captures.map(capture => capture.suffix))
  if (suffixes.some(suffix => !captured.has(suffix))) throw new Error(`${preset}: 正式证据缺少捕获步骤`)
  return window.completed
}
module.exports = { compareGalleryImages, expectedGalleryCaptures, galleryRunSuffixes, validateGalleryRun, GALLERY_DIFF_RATIO, GALLERY_PRESETS }
