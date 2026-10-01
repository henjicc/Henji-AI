const { diffBuffers } = require('./canvasVisualDiff.cjs')
const { createVideoEditProbeScene } = require('./uiInspectionSceneVideoEditProbe.cjs')
const { createVideoEditScrubScene } = require('./uiInspectionSceneVideoEditScrub.cjs')
const { createVideoEditTimelineScene } = require('./uiInspectionSceneVideoEditTimeline.cjs')
const { createVideoEditMonitorScene } = require('./uiInspectionSceneVideoEditMonitor.cjs')
const { createVideoEditPictureGestureScene } = require('./uiInspectionSceneVideoEditPictureGesture.cjs')
const { createVideoEditLayoutScene } = require('./uiInspectionSceneVideoEditLayout.cjs')
const { createVideoEditProjectSourceScene } = require('./uiInspectionSceneVideoEditProjectSource.cjs')
const { createVideoEditCodeScene } = require('./uiInspectionSceneVideoEditCode.cjs')
const { createVideoEditCompositeScene } = require('./uiInspectionSceneVideoEditComposite.cjs')
const { createVideoEditCompositeEditScene } = require('./uiInspectionSceneVideoEditCompositeEdit.cjs')
const { createVideoEditAssetReferencesScene } = require('./uiInspectionSceneVideoEditAssetReferences.cjs')
const { createVideoEditOutputsScene } = require('./uiInspectionSceneVideoEditOutputs.cjs')
const { createVideoEditCodeAssetsScene } = require('./uiInspectionSceneVideoEditCodeAssets.cjs')
const { createVideoEditCreativeResultsScene } = require('./uiInspectionSceneVideoEditCreativeResults.cjs')
const { createVideoEditCodeProjectScene } = require('./uiInspectionSceneVideoEditCodeProject.cjs')
const { attachUiInspectionCommon } = require('./uiInspectionSceneCommon.cjs')
const { attachUiInspectionGeneration } = require('./uiInspectionSceneGeneration.cjs')
const { attachUiInspectionCanvasWorkspace } = require('./uiInspectionSceneCanvasWorkspace.cjs')
const { attachUiInspectionCanvasRelight } = require('./uiInspectionSceneCanvasRelight.cjs')
const { attachUiInspectionCanvasEnhance } = require('./uiInspectionSceneCanvasEnhance.cjs')
const { attachUiInspectionCanvasEditing } = require('./uiInspectionSceneCanvasEditing.cjs')
const { attachUiInspectionCanvasPanorama } = require('./uiInspectionSceneCanvasPanorama.cjs')
const { attachUiInspectionCanvasMedia } = require('./uiInspectionSceneCanvasMedia.cjs')
const { attachUiInspectionCanvasConnections } = require('./uiInspectionSceneCanvasConnections.cjs')
const { attachUiInspectionCanvasGpuFiveLayer } = require('./uiInspectionSceneCanvasGpuFiveLayer.cjs')
const {
  attachUiInspectionCanvasExistingMultiLayer,
} = require('./uiInspectionSceneCanvasExistingMultiLayer.cjs')
const { attachUiInspectionSupport } = require('./uiInspectionSceneSupport.cjs')
const { createGenerationSettingsScenes } = require('./uiInspectionSceneCatalogGeneration.cjs')
const { createCanvasScenes } = require('./uiInspectionSceneCatalogCanvas.cjs')
const { createToolboxScenes } = require('./uiInspectionSceneCatalogToolbox.cjs')
const {
  createCameraStagePlaybackScenes,
} = require('./uiInspectionSceneCatalogCameraStagePlayback.cjs')
const { createGpuRasterScenes } = require('./uiInspectionSceneCatalogGpuRaster.cjs')
const { createGpuExportScenes } = require('./uiInspectionSceneCatalogGpuExport.cjs')
const { createGpuBrushScenes } = require('./uiInspectionSceneCatalogGpuBrush.cjs')
const { createImageEditorWorkloadScenes } = require('./uiInspectionImageEditorWorkload.cjs')
const { createGpuBudgetScenes } = require('./uiInspectionSceneCatalogGpuBudget.cjs')
const { createGpuAnnotationScenes } = require('./uiInspectionSceneCatalogGpuAnnotation.cjs')
const { createSupportScenes } = require('./uiInspectionSceneCatalogSupport.cjs')
const { createMcpScenes } = require('./uiInspectionSceneMcp.cjs')
const { createEmbeddedAgentScenes } = require('./uiInspectionSceneEmbeddedAgent.cjs')
const { createMcpDomainScenes } = require('./uiInspectionSceneMcpDomains.cjs')
const { createMcpBackgroundDocumentScenes, createMcpResourceScenes } = require('./uiInspectionSceneMcpBackgroundDocument.cjs')
const { createMcpMediaChainScenes } = require('./uiInspectionSceneMcpMediaChain.cjs')
const { createNetworkScenes } = require('./uiInspectionSceneNetwork.cjs')
const { createGenerationPerformanceScenes } = require('./uiInspectionGenerationPerformance.cjs')
const { createGenerationVirtualizationScenes } = require('./uiInspectionGenerationVirtualization.cjs')
const { createCanvasScalePerformanceScenes } = require('./uiInspectionCanvasScalePerformance.cjs')

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
  attachUiInspectionCanvasGpuFiveLayer(context)
  attachUiInspectionCanvasExistingMultiLayer(context)
  attachUiInspectionSupport(context)

  return Object.freeze([
    createVideoEditProbeScene(),
    createVideoEditScrubScene(),
    createVideoEditTimelineScene(),
    createVideoEditMonitorScene(),
    createVideoEditPictureGestureScene(),
    createVideoEditLayoutScene(),
    createVideoEditProjectSourceScene(),
    createVideoEditCodeScene(),
    createVideoEditCompositeScene(),
    createVideoEditCompositeEditScene(),
    createVideoEditCompositeEditScene({ pressureOnly: true }),
    createVideoEditAssetReferencesScene(),
    createVideoEditOutputsScene(context),
    createVideoEditCodeAssetsScene(),
    createVideoEditCreativeResultsScene(context),
    createVideoEditCodeProjectScene(),
    createVideoEditCodeProjectScene({ controls: true }),
    ...createGenerationPerformanceScenes(context),
    ...createGenerationVirtualizationScenes(context),
    ...createCanvasScalePerformanceScenes(context),
    ...createNetworkScenes(),
    ...createEmbeddedAgentScenes(context),
    ...createMcpScenes(context),
    ...createMcpDomainScenes(context),
    ...createMcpBackgroundDocumentScenes(context),
    ...createMcpResourceScenes(context),
    ...createMcpMediaChainScenes(context),
    ...createGenerationSettingsScenes(context),
    ...createCanvasScenes(context),
    ...createToolboxScenes(context),
    ...createCameraStagePlaybackScenes(context),
    ...createGpuRasterScenes(context),
    ...createGpuExportScenes(context),
    ...createGpuBrushScenes(context),
    ...createImageEditorWorkloadScenes(context),
    ...createGpuBudgetScenes(context),
    ...createGpuAnnotationScenes(context),
    ...createSupportScenes(context),
  ])
}

module.exports = { createUiInspectionScenes }
