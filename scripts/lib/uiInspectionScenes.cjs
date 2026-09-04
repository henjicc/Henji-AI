const { diffBuffers } = require('./canvasVisualDiff.cjs')
const { attachUiInspectionCommon } = require('./uiInspectionSceneCommon.cjs')
const { attachUiInspectionGeneration } = require('./uiInspectionSceneGeneration.cjs')
const { attachUiInspectionCanvasWorkspace } = require('./uiInspectionSceneCanvasWorkspace.cjs')
const { attachUiInspectionCanvasRelight } = require('./uiInspectionSceneCanvasRelight.cjs')
const { attachUiInspectionCanvasEnhance } = require('./uiInspectionSceneCanvasEnhance.cjs')
const { attachUiInspectionCanvasEditing } = require('./uiInspectionSceneCanvasEditing.cjs')
const { attachUiInspectionCanvasPanorama } = require('./uiInspectionSceneCanvasPanorama.cjs')
const { attachUiInspectionCanvasMedia } = require('./uiInspectionSceneCanvasMedia.cjs')
const { attachUiInspectionCanvasConnections } = require('./uiInspectionSceneCanvasConnections.cjs')
const { attachUiInspectionSupport } = require('./uiInspectionSceneSupport.cjs')
const { createGenerationSettingsScenes } = require('./uiInspectionSceneCatalogGeneration.cjs')
const { createCanvasScenes } = require('./uiInspectionSceneCatalogCanvas.cjs')
const { createToolboxScenes } = require('./uiInspectionSceneCatalogToolbox.cjs')
const { createGpuRasterScenes } = require('./uiInspectionSceneCatalogGpuRaster.cjs')
const { createGpuExportScenes } = require('./uiInspectionSceneCatalogGpuExport.cjs')
const { createGpuBrushScenes } = require('./uiInspectionSceneCatalogGpuBrush.cjs')
const { createGpuBudgetScenes } = require('./uiInspectionSceneCatalogGpuBudget.cjs')
const { createGpuAnnotationScenes } = require('./uiInspectionSceneCatalogGpuAnnotation.cjs')
const { createSupportScenes } = require('./uiInspectionSceneCatalogSupport.cjs')

const TAB_NAMES = Object.freeze({
  generation: /^(生成|Generation)$/i,
  canvas: /^(画布|Canvas)$/i,
  toolbox: /^(工具箱|Toolbox)$/i,
  assets: /^(资产|Assets)$/i,
})

const REFERENCE_FIXTURE_IMAGE = `${process.cwd()}/resources/icons/icon.png`

function createUiInspectionScenes({ canvasFixtureProjectId, settlePage }) {
  const context = {
    canvasFixtureProjectId,
    diffBuffers,
    REFERENCE_FIXTURE_IMAGE,
    settlePage,
    TAB_NAMES,
  }
  attachUiInspectionCommon(context)
  attachUiInspectionGeneration(context)
  attachUiInspectionCanvasWorkspace(context)
  attachUiInspectionCanvasRelight(context)
  attachUiInspectionCanvasEnhance(context)
  attachUiInspectionCanvasEditing(context)
  attachUiInspectionCanvasPanorama(context)
  attachUiInspectionCanvasMedia(context)
  attachUiInspectionCanvasConnections(context)
  attachUiInspectionSupport(context)

  return Object.freeze([
    ...createGenerationSettingsScenes(context),
    ...createCanvasScenes(context),
    ...createToolboxScenes(context),
    ...createGpuRasterScenes(context),
    ...createGpuExportScenes(context),
    ...createGpuBrushScenes(context),
    ...createGpuBudgetScenes(context),
    ...createGpuAnnotationScenes(context),
    ...createSupportScenes(context),
  ])
}

module.exports = { createUiInspectionScenes }
