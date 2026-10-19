const { createOcrPrivacyScene } = require('./uiInspectionSceneOcrPrivacy.cjs')
const { createScreenAttentionScene } = require('./uiInspectionSceneScreenAttention.cjs')
const { createRecordingCursorScene } = require('./uiInspectionSceneRecordingCursor.cjs')
const { createVideoEditFirstFrameScene } = require('./uiInspectionSceneVideoEditFirstFrame.cjs')
/* eslint-disable @typescript-eslint/no-var-requires -- 正式 Electron 巡检启动器使用 CommonJS 场景工厂。 */
const { createImageEditDocumentSizeScene } = require('./uiInspectionSceneImageEditDocumentSize.cjs')
const { createF2UiScenes } = require('./uiInspectionSceneF2Ui.cjs')
const { createSuperKeyframePanelScenes } = require('./uiInspectionSceneSuperKeyframePanel.cjs')
const { createSurfaceGrammarScenes, createUiPolishScenes } = require('./uiInspectionSceneSurfaceGrammar.cjs')
const { createU8bUiScenes } = require('./uiInspectionSceneU8b.cjs')
const { createImageEditLayoutDraftScene } = require('./uiInspectionSceneImageEditLayoutDraft.cjs')
const { createImageEditCommonWorkflowsScene } = require('./uiInspectionSceneImageEditCommonWorkflows.cjs')
const { createImageEditCommonFeaturesScene, createImageEditQuickMosaicScene } = require('./uiInspectionSceneImageEditCommonFeatures.cjs')
const { createImageEditColorExportScene } = require('./uiInspectionSceneImageEditColorExport.cjs')
const { createImageEditVectorTextScene } = require('./uiInspectionSceneImageEditVectorText.cjs')
const { createImageEditPaintTargetsScene, createImageEditPaintParameterScene, createImageEditPaintCrossTilesScene } = require('./uiInspectionSceneImageEditPaintTargets.cjs')
const { createImageEditRetouchScene } = require('./uiInspectionSceneImageEditRetouch.cjs')
const { createImageEditAiWorkflowsScene } = require('./uiInspectionSceneImageEditAiWorkflows.cjs')
const { createImageEditTransformScene } = require('./uiInspectionSceneImageEditTransform.cjs')
const { createImageEditSelectionToolsScene } = require('./uiInspectionSceneImageEditSelectionTools.cjs')
const { createImageEditToolLifecycleScene, createImageEditRegistrationFailureScene, createImageEditQuickMarkViewerScene } = require('./uiInspectionSceneImageEditToolLifecycle.cjs')
const { createImageEditDockingScene, createImageEditLayoutFailureScene } = require('./uiInspectionSceneImageEditDocking.cjs')
const { createImageEditLayerPanelsScene } = require('./uiInspectionSceneImageEditLayerPanels.cjs')
const { createImageEditHistoryScene } = require('./uiInspectionSceneImageEditHistory.cjs')
const { createImageEditRegionHostsScene } = require('./uiInspectionSceneImageEditRegionHosts.cjs')
const { createImageEditFilterScopesScene, createImageEditFilterFailureScene } = require('./uiInspectionSceneImageEditFilterScopes.cjs')
const { createImageEditSmartContentScene } = require('./uiInspectionSceneImageEditSmartContent.cjs')
const { diffBuffers } = require('./canvasVisualDiff.cjs')
const { createVideoEditProbeScene } = require('./uiInspectionSceneVideoEditProbe.cjs')
const { createVideoEditScrubScene } = require('./uiInspectionSceneVideoEditScrub.cjs')
const { createVideoEditPlayStartScene } = require('./uiInspectionSceneVideoEditPlayStart.cjs')
const { createVideoEditFilmstripScene } = require('./uiInspectionSceneVideoEditFilmstrip.cjs')
const { createVideoEditTimelineScene } = require('./uiInspectionSceneVideoEditTimeline.cjs')
const { createVideoEditCaptionsScene } = require('./uiInspectionSceneVideoEditCaptions.cjs')
const { createVideoEditMotionDraftScene } = require('./uiInspectionSceneVideoEditMotionDraft.cjs')
const { createVideoEditExplanationScene } = require('./uiInspectionSceneVideoEditExplanation.cjs')
const { createVideoEditPrimitivesScene } = require('./uiInspectionSceneVideoEditPrimitives.cjs')
const { createVideoEditCaptionTextScene } = require('./uiInspectionSceneVideoEditCaptionText.cjs')
const { createVideoEditAnnotationRelativeScene } = require('./uiInspectionSceneVideoEditAnnotationRelative.cjs')
const { createVideoEditMonitorScene } = require('./uiInspectionSceneVideoEditMonitor.cjs')
const { createVideoEditPictureGestureScene } = require('./uiInspectionSceneVideoEditPictureGesture.cjs')
const { createVideoEditLayoutScene } = require('./uiInspectionSceneVideoEditLayout.cjs')
const { createVideoEditProjectSourceScene } = require('./uiInspectionSceneVideoEditProjectSource.cjs')
const { createVideoEditCodeScene } = require('./uiInspectionSceneVideoEditCode.cjs')
const { createVideoEditCodePerformanceScene } = require('./uiInspectionSceneVideoEditCodePerformance.cjs')
const { createVideoEditCompositeScene } = require('./uiInspectionSceneVideoEditComposite.cjs')
const { createVideoEditCompositeEditScene } = require('./uiInspectionSceneVideoEditCompositeEdit.cjs')
const { createVideoEditMaskScene } = require('./uiInspectionSceneVideoEditMask.cjs')
const { createVideoEditCodeAiScene } = require('./uiInspectionSceneVideoEditCodeAi.cjs')
const { createVideoEditAssetReferencesScene } = require('./uiInspectionSceneVideoEditAssetReferences.cjs')
const { createVideoEditOutputsScene } = require('./uiInspectionSceneVideoEditOutputs.cjs')
const { createVideoEditCodeAssetsScene } = require('./uiInspectionSceneVideoEditCodeAssets.cjs')
const { createVideoEditCreativeResultsScene } = require('./uiInspectionSceneVideoEditCreativeResults.cjs')
const { createVideoEditDockGesturesScene, createVideoEditPopoutScene } = require('./uiInspectionSceneVideoEditPopout.cjs')
const { createVideoEditAgentLoopScene } = require('./uiInspectionSceneVideoEditAgentLoop.cjs')
const { createVideoEditObservationScene } = require('./uiInspectionSceneVideoEditObservation.cjs')
const { createVideoEditPerformanceScene } = require('./uiInspectionSceneVideoEditPerformance.cjs')
const { createVideoEditCodeProjectScene } = require('./uiInspectionSceneVideoEditCodeProject.cjs')
const { createVideoFramesScene } = require('./uiInspectionSceneVideoFrames.cjs')
const { createVideoEditMediaProbeScene } = require('./uiInspectionSceneVideoEditMediaProbe.cjs')
const { createVideoEditNativeAudioScene } = require('./uiInspectionSceneVideoEditNativeAudio.cjs')
const { createVideoEditHighPrecisionScene } = require('./uiInspectionSceneVideoEditHighPrecision.cjs')
const { createVideoDecodeScene } = require('./uiInspectionSceneVideoDecode.cjs')
const { createVideoEditLinksScene } = require('./uiInspectionSceneVideoEditLinks.cjs')
const { createVideoEditMultitrackScene } = require('./uiInspectionSceneVideoEditMultitrack.cjs')
const { createVideoEditExportNativeScene } = require('./uiInspectionSceneVideoEditExportNative.cjs')
const { createVideoEditNativeFaultsScene } = require('./uiInspectionSceneVideoEditNativeFaults.cjs')
const { createVideoEditNativeSoakScene } = require('./uiInspectionSceneVideoEditNativeSoak.cjs')
const { createVideoEditFormatMatrixScene } = require('./uiInspectionSceneVideoEditFormatMatrix.cjs')
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
const { createSelectionFeedbackScenes } = require('./uiInspectionSceneSelectionFeedback.cjs')
const { createToolboxScenes } = require('./uiInspectionSceneCatalogToolbox.cjs')
const {
  createCameraStagePlaybackScenes,
} = require('./uiInspectionSceneCatalogCameraStagePlayback.cjs')
const { createGpuRasterScenes } = require('./uiInspectionSceneCatalogGpuRaster.cjs')
const { createGpuExportScenes } = require('./uiInspectionSceneCatalogGpuExport.cjs')
const { createGpuBrushScenes } = require('./uiInspectionSceneCatalogGpuBrush.cjs')
const { createImageEditorWorkloadScenes } = require('./uiInspectionImageEditorWorkload.cjs')
const { createGpuBudgetScenes } = require('./uiInspectionSceneCatalogGpuBudget.cjs')
const { createImageEditCompositeScene } = require('./uiInspectionSceneImageEditComposite.cjs')
const { createGpuAnnotationScenes } = require('./uiInspectionSceneCatalogGpuAnnotation.cjs')
const { createSupportScenes } = require('./uiInspectionSceneCatalogSupport.cjs')
const { createRecordingControlScene, createRecordingEventsScene } = require('./uiInspectionSceneRecordingControl.cjs')
const { createRecordingTracksScene } = require('./uiInspectionSceneRecordingTracks.cjs')
const { createRecordingSessionScene } = require('./uiInspectionSceneRecordingSession.cjs')
const { createRecordingMovieScene } = require('./uiInspectionSceneRecordingMovie.cjs')
const { createRecordingQuickScene } = require('./uiInspectionSceneRecordingQuick.cjs')
const { createRecordingSyncScene } = require('./uiInspectionSceneRecordingSync.cjs')
const { createRecordingOverlayScene } = require('./uiInspectionSceneRecordingOverlay.cjs')
const { createRecordingProductsScene } = require('./uiInspectionSceneRecordingProducts.cjs')
const { createScreenCaptureScene } = require('./uiInspectionSceneScreenCapture.cjs')
const { createMcpScenes } = require('./uiInspectionSceneMcp.cjs')
const { createMcpExpiryScene } = require('./uiInspectionSceneMcpExpiry.cjs')
const { createEmbeddedAgentScenes } = require('./uiInspectionSceneEmbeddedAgent.cjs')
const { createMcpDomainScenes } = require('./uiInspectionSceneMcpDomains.cjs')
const { createMcpBackgroundDocumentScenes, createMcpResourceScenes } = require('./uiInspectionSceneMcpBackgroundDocument.cjs')
const { createMcpMediaChainScenes } = require('./uiInspectionSceneMcpMediaChain.cjs')
const { createNetworkScenes } = require('./uiInspectionSceneNetwork.cjs')
const { createGenerationPerformanceScenes } = require('./uiInspectionGenerationPerformance.cjs')
const { createGenerationVirtualizationScenes } = require('./uiInspectionGenerationVirtualization.cjs')
const { createGenerationReviewScenes } = require('./uiInspectionSceneGenerationReview.cjs')
const { createCanvasScalePerformanceScenes } = require('./uiInspectionCanvasScalePerformance.cjs')

const TAB_NAMES = Object.freeze({
  generation: /^(生成|Generation)$/i,
  canvas: /^(画布|Canvas)$/i,
  toolbox: /^(工具|Tools)$/i,
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
    ...(process.env.HENJI_PREMIERE_MIGRATION_DOCUMENT ? [require('./uiInspectionScenePremiereMigration.cjs').createPremiereMigrationScene()] : []),
    ...createSurfaceGrammarScenes(context),
    ...createU8bUiScenes(context),
    ...createUiPolishScenes(context),
    ...createSuperKeyframePanelScenes(context),
    createVideoEditProbeScene(),
    createVideoEditScrubScene(),
    createVideoEditFirstFrameScene(),
    createRecordingCursorScene(),
    createScreenAttentionScene(),
    createVideoEditPlayStartScene(),
    createVideoEditFilmstripScene(),
    createVideoEditTimelineScene(),
    createVideoEditCaptionsScene(),
    createVideoEditMotionDraftScene(),
    createVideoEditExplanationScene(),
    createVideoEditPrimitivesScene(),
    createVideoEditCaptionTextScene(),
    createVideoEditAnnotationRelativeScene(),
    createVideoEditMonitorScene(),
    createVideoEditPictureGestureScene(),
    createVideoEditLayoutScene(),
    createVideoEditProjectSourceScene(),
    createVideoEditCodeScene(),
    createVideoEditCodePerformanceScene(),
    createVideoEditCompositeScene(),
    createVideoEditCompositeEditScene(),
    createVideoEditCompositeEditScene({ pressureOnly: true }),
    createVideoEditMaskScene(),
    createVideoEditCodeAiScene(),
    createVideoEditAssetReferencesScene(),
    createVideoEditOutputsScene(context),
    createVideoEditCodeAssetsScene(),
    createVideoEditCreativeResultsScene(context),
    createVideoEditPopoutScene(),
    createVideoEditDockGesturesScene(),
    createVideoEditAgentLoopScene(),
    createVideoEditObservationScene(),
    createVideoEditPerformanceScene(),
    createVideoEditCodeProjectScene(),
    createVideoEditCodeProjectScene({ controls: true }),
    createVideoFramesScene(),
    createVideoEditMediaProbeScene(),
    createVideoEditNativeAudioScene(),
    createVideoEditHighPrecisionScene(),
    createVideoDecodeScene(),
    createVideoEditLinksScene(),
    createVideoEditMultitrackScene(),
    createVideoEditExportNativeScene(),
    createVideoEditNativeFaultsScene(),
    createVideoEditNativeSoakScene(),
    createVideoEditFormatMatrixScene(),
    ...createGenerationPerformanceScenes(context),
    ...createGenerationVirtualizationScenes(context),
    ...createCanvasScalePerformanceScenes(context),
    ...createNetworkScenes(),
    ...createEmbeddedAgentScenes(context),
    ...createMcpScenes(context),
    createMcpExpiryScene(context),
    ...createMcpDomainScenes(context),
    ...createMcpBackgroundDocumentScenes(context),
    ...createMcpResourceScenes(context),
    ...createMcpMediaChainScenes(context),
    ...createGenerationSettingsScenes(context),
    ...createGenerationReviewScenes(context),
    ...createCanvasScenes(context),
    ...createSelectionFeedbackScenes(context),
    ...createToolboxScenes(context),
    createImageEditToolLifecycleScene(context),
    createImageEditRegistrationFailureScene(),
    createImageEditQuickMarkViewerScene(context),
    createImageEditDockingScene(context),
    createImageEditHistoryScene(context),
    createImageEditLayerPanelsScene(context),
    createImageEditLayoutFailureScene(context),
    createImageEditRegionHostsScene(context),
    ...createF2UiScenes(context),
    createImageEditDocumentSizeScene(context),
    createImageEditLayoutDraftScene(context),
    require('./uiInspectionSceneCanvasTidy.cjs').createCanvasTidyScene(context),
    createImageEditLayoutDraftScene(context, true),
    createImageEditLayoutDraftScene(context, false, true),
    createImageEditLayoutDraftScene(context, true, true),
    ...[false, true].map(canvas => createImageEditLayoutDraftScene(context, canvas, false, true)),
    ...[false, true].map(canvas => createImageEditLayoutDraftScene(context, canvas, false, false, true)),
    createImageEditCommonWorkflowsScene(context),
    createImageEditCommonFeaturesScene(context),
    createImageEditCommonFeaturesScene(context, true),
    createImageEditQuickMosaicScene(context),
    createImageEditCommonWorkflowsScene(context, true),
    createImageEditCommonWorkflowsScene(context, false, true),
    createImageEditCommonWorkflowsScene(context, true, true),
    createImageEditColorExportScene(context),
    createImageEditDocumentSizeScene(context, true),
    createImageEditTransformScene(context),
    createImageEditTransformScene(context,true),
    createImageEditSelectionToolsScene(context),
    createImageEditPaintTargetsScene(context),
    createImageEditPaintCrossTilesScene(context),
    createImageEditPaintParameterScene(context),
    createImageEditRetouchScene(context),
    createImageEditAiWorkflowsScene(context),
    createImageEditFilterScopesScene(context),
    createImageEditSmartContentScene(context),
    createImageEditVectorTextScene(context),
    createImageEditFilterFailureScene(context),
    ...createCameraStagePlaybackScenes(context),
    ...createGpuRasterScenes(context),
    ...createGpuExportScenes(context),
    ...createGpuBrushScenes(context),
    ...createImageEditorWorkloadScenes(context),
    ...createGpuBudgetScenes(context),
    createImageEditCompositeScene(context),
    ...createGpuAnnotationScenes(context),
    ...createSupportScenes(context),
    createRecordingControlScene(),
    createScreenCaptureScene(),
    createRecordingEventsScene(context),
    createRecordingTracksScene(),
    createRecordingSessionScene(),
    createRecordingMovieScene(),
    createRecordingQuickScene(),
    createRecordingSyncScene(),
    createRecordingOverlayScene(),
    require('./uiInspectionSceneRecordingReplay.cjs').createRecordingReplayScene(),
    require('./uiInspectionSceneRecordingDirector.cjs').createRecordingDirectorScene(),
    createOcrPrivacyScene(),
    createRecordingProductsScene(),
  ])
}

module.exports = { createUiInspectionScenes }
