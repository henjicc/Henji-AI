const { diffColorBuffers } = require('./canvasVisualDiff.cjs')
const { UI_AUDIT_RULES } = require('./uiAuditDom.cjs')
const GALLERY_DIFF_RATIO = 0.001
// 深浅各一套：四预设共用同一套组件，结构回归在一套里就会暴露，其余预设的颜色差异由对比度审计覆盖。
const GALLERY_PRESETS = ['graphite', 'paper']
async function compareGalleryImages(a, b) {
  const result = await diffColorBuffers(a, b)
  return { ...result, passed: result.changedPixels / result.pixelCount <= GALLERY_DIFF_RATIO }
}
function expectedGalleryCaptures(config) {
  const names = config.steps.filter(step => step.capture).map(step => typeof step.capture === 'string' ? step.capture : step.capture.name)
  if (!names.length || new Set(names).size !== names.length || names.some(name => !/^[a-z0-9-]+$/.test(name))) throw new Error('捕获清单缺失、重复或无效')
  return GALLERY_PRESETS.flatMap(preset => names.map(name => `${preset}/1440x900-review-ui-gallery-${name}.png`))
}
function validateGalleryRun(audit, evidence, preset, suffixes) {
  if (audit.metadata?.themePreset !== preset || evidence.metadata?.themePreset !== preset || !Array.isArray(audit.metadata.failures) || audit.metadata.failures.length) throw new Error(`${preset}: 缺少成功的正式审计`)
  for (const result of [...Object.values(audit.scenes || {}), audit.crossScene || {}]) {
    if (UI_AUDIT_RULES.some(rule => result[rule.key]?.length) || result.gallerySamples?.some(sample => !sample.passed)) throw new Error(`${preset}: 审计仍有问题，不能写成基线`)
  }
  const windows = Object.values(evidence.scenes || {}).map(scene => scene.window).filter(window => window?.completed?.outer?.width === 1440 && window.completed.outer.height === 900)
  if (windows.length !== 1 || !Number.isFinite(windows[0].completed.nativeScaleFactor) || !Number.isFinite(windows[0].completed.zoomFactor) || !Number.isFinite(windows[0].completed.renderer?.dpr)) throw new Error(`${preset}: 缺少唯一的 1440×900 窗口尺寸证据`)
  const window = windows[0]
  const captured = new Set(window.captures.map(capture => capture.suffix))
  if (suffixes.some(suffix => !captured.has(suffix))) throw new Error(`${preset}: 正式证据缺少捕获步骤`)
  return window.completed
}
module.exports = { compareGalleryImages, expectedGalleryCaptures, validateGalleryRun, GALLERY_DIFF_RATIO, GALLERY_PRESETS }
