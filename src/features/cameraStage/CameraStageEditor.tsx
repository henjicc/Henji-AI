import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Camera, Clipboard, Film, LayoutDashboard, Save, Undo2, X } from 'lucide-react'
import { Dropdown, PanelTrigger, UiButton, UiCheckbox, UiIconButton, UiOptionButton, UiToolbar } from '@/components/ui'
import { ICON_ASSET_LIBRARY as AssetLibraryIcon } from '@/core/theme/icons'
import { createLogger } from '@/core/logging'
import type { AssetLibraryRecord } from '@/platform/contracts/assetLibrary'
import {
  collectCameraStageAsset,
  readCameraStageAssetTarget,
  resolveCameraStageAssetTarget,
  writeCameraStageAssetTarget,
  type CameraStageAssetTarget,
} from '@/features/assets/services/cameraStageAssetCollection'
import { cancelVideoFrameExport } from '@/commands/video'
import { areCameraAspectRatiosConsistent, getCameraObjects } from './domain/cameraUtils'
import { buildRenderCameraSchedule } from './domain/renderCameraSchedule'
import { captureCameraStageImageDataUrl } from './export/cameraStageImage'
import { copySceneScreenshotToClipboard, exportSceneScreenshot, persistSceneScreenshot } from './export/cameraStageScreenshot'
import {
  exportCameraStageVideo,
  waitForCameraStageRender,
  type CameraStageVideoExportResult,
  type CameraStageVideoExportProgress,
  type CameraStageVideoResolutionPreset,
} from './export/cameraStageVideo'
import { useCameraStageAutosave } from './hooks/useCameraStageAutosave'
import { updateCameraStageProjectCover } from './projects/cameraStageProjectCover'
import { useCameraStageShortcuts } from './hooks/useCameraStageShortcuts'
import CameraStageDock from './layout/CameraStageDock'
import type { CameraStageDockHandle } from './layout/CameraStageDock'
import type { StageCaptureFn } from './scene/StageCaptureBridge'
import { useCameraStageSessionStore } from './store/cameraStageSessionStore'
import { useCameraStageStore } from './store/cameraStageStore'
import { useCameraStageHistory } from './store/useCameraStageHistory'
import QuickAddGroup from './toolbar/QuickAddGroup'
import StagePathContextBar from './toolbar/StagePathContextBar'
import StageViewportToolbar from './toolbar/StageViewportToolbar'

/**
 * 3D 镜头参考编辑器编排容器：顶部控制栏 + 停靠式面板工作区（视口/资源管理器/属性）。
 * 只做布局与接线，不承载业务实现；面板布局由 CameraStageDock（dockview）管理。
 */

const VIDEO_RESOLUTION_OPTIONS: Array<{ label: string; value: CameraStageVideoResolutionPreset }> = [
  { label: '720p', value: '720p' },
  { label: '1080p', value: '1080p' },
]

const logger = createLogger('cameraStage.editor')

interface CameraStageEditorProps {
  /** 返回镜头参考列表（离开当前文档；草稿会先询问保存，取消时留在编辑器） */
  onBackToList?: () => Promise<void> | void
  backLabel?: string
  autoExportVideoRequest?: number
  embeddedOutput?: {
    onFrame: (result: { mediaUrl: string; selectedTimeSec: number; aspectRatio: string }) => void
    onVideo: (result: CameraStageVideoExportResult) => void
    onProgress: (progress: number | null) => void
    onOutputKindChange: (kind: 'image' | 'video') => void
    assetTarget?: CameraStageAssetTarget
    onAssetTargetChange?: (target: CameraStageAssetTarget) => void
  }
}

const CameraStageEditor: React.FC<CameraStageEditorProps> = ({
  onBackToList,
  backLabel = '返回镜头参考列表',
  autoExportVideoRequest,
  embeddedOutput,
}) => {
  const objects = useCameraStageStore((state) => state.objects)
  const selectedId = useCameraStageStore((state) => state.selectedId)
  const viewMode = useCameraStageStore((state) => state.viewMode)
  const activeCameraId = useCameraStageStore((state) => state.activeCameraId)
  const setGizmoMode = useCameraStageStore((state) => state.setGizmoMode)
  const currentProjectId = useCameraStageStore((state) => state.currentProjectId)
  const removeObject = useCameraStageStore((state) => state.removeObject)
  const duplicateObject = useCameraStageStore((state) => state.duplicateObject)
  const requestFocusSelected = useCameraStageStore((state) => state.requestFocusSelected)
  const projectName = useCameraStageStore((state) => state.currentProjectName)
  const setSessionDocumentId = useCameraStageSessionStore((state) => state.setLastDocumentId)
  const setSessionViewMode = useCameraStageSessionStore((state) => state.setStageViewMode)
  const animation = useCameraStageStore((state) => state.animation)
  const stateKeyframeCount = useCameraStageStore((state) => state.stateKeyframes.length)
  const cameras = getCameraObjects(objects)
  const activeCamera = cameras.find((item) => item.id === activeCameraId) ?? cameras[0]

  const { canUndo, undo, redo } = useCameraStageHistory()
  const { saveState } = useCameraStageAutosave()

  const [stateKeyframeHint, setStateKeyframeHint] = useState<string | null>(null)
  const [stateKeyframeAction, setStateKeyframeAction] = useState<'save' | 'copy' | null>(null)
  const [videoPreset, setVideoPreset] = useState<CameraStageVideoResolutionPreset>('720p')
  const [videoProgress, setVideoProgress] = useState<CameraStageVideoExportProgress | null>(null)
  const [assetTarget, setAssetTarget] = useState<CameraStageAssetTarget>(
    embeddedOutput?.assetTarget ?? readCameraStageAssetTarget(),
  )
  const [assetLibraries, setAssetLibraries] = useState<AssetLibraryRecord[]>([])
  const captureRef = useRef<StageCaptureFn | null>(null)
  const dockRef = useRef<CameraStageDockHandle>(null)
  const videoSessionRef = useRef<string | null>(null)
  const videoCancelRef = useRef(false)
  const handledAutoExportRequestRef = useRef(0)
  const embeddedOutputRef = useRef(embeddedOutput)
  embeddedOutputRef.current = embeddedOutput

  const outputKind = stateKeyframeCount > 1 ? 'video' : 'image'
  const canScreenshot = viewMode === 'camera' && !!activeCamera
  const canExportVideo = outputKind === 'video'
    && canScreenshot
    && animation.duration > 0
    && animation.fps > 0

  useEffect(() => {
    embeddedOutput?.onOutputKindChange(outputKind)
  }, [embeddedOutput, outputKind])

  useEffect(() => {
    let cancelled = false
    const initialOutput = embeddedOutputRef.current
    void resolveCameraStageAssetTarget(initialOutput?.assetTarget ?? readCameraStageAssetTarget())
      .then(({ target, libraries }) => {
        if (cancelled) return
        setAssetTarget(target)
        setAssetLibraries(libraries)
        initialOutput?.onAssetTargetChange?.(target)
      })
    return () => { cancelled = true }
  }, [])

  const updateAssetTarget = useCallback((next: CameraStageAssetTarget): void => {
    setAssetTarget(next)
    writeCameraStageAssetTarget(next)
    embeddedOutputRef.current?.onAssetTargetChange?.(next)
  }, [])

  const prepareScreenshotDataUrl = useCallback(async (): Promise<string | null> => {
    const capture = captureRef.current
    if (!capture || !activeCamera) {
      setStateKeyframeHint('截图失败：未获取到画面')
      return null
    }
    const result = await captureCameraStageImageDataUrl(capture, activeCamera.aspectRatio.ratio)
    return result.dataUrl
  }, [activeCamera])

  const handleSaveScreenshot = useCallback(async (): Promise<void> => {
    setStateKeyframeAction('save')
    try {
      const dataUrl = await prepareScreenshotDataUrl()
      if (!dataUrl) return

      const result = await exportSceneScreenshot(
        dataUrl,
        useCameraStageStore.getState().currentProjectName,
      )
      if (!result) return
      const collected = await collectCameraStageAsset({
        filePath: result.mediaPath,
        mediaType: 'image',
        displayName: `${useCameraStageStore.getState().currentProjectName}-当前帧`,
        target: assetTarget,
      })
      const { savedPath, saveMode } = result
      const fileName = savedPath.split(/[\\/]/).pop() ?? savedPath
      const collectedHint = assetTarget.enabled ? (collected ? '，已加入资产库' : '，资产收录失败') : ''
      setStateKeyframeHint(`${saveMode === 'quick' ? '已快速保存' : '已保存'}：${fileName}${collectedHint}`)
    } catch (error) {
      logger.error('3D 镜头截图导出失败', error, { event: 'camera_stage.screenshot.failed' })
      setStateKeyframeHint('截图导出失败')
    } finally {
      setStateKeyframeAction(null)
    }
  }, [assetTarget, prepareScreenshotDataUrl])

  const handleUpdateCanvasFrame = useCallback(async (): Promise<void> => {
    if (!embeddedOutput) return
    setStateKeyframeAction('save')
    try {
      const dataUrl = await prepareScreenshotDataUrl()
      if (!dataUrl || !activeCamera) return
      const result = await persistSceneScreenshot(dataUrl)
      embeddedOutput.onFrame({ mediaUrl: result.mediaUrl, selectedTimeSec: useCameraStageStore.getState().playback.currentTime, aspectRatio: activeCamera.aspectRatio.preset })
      const collected = await collectCameraStageAsset({
        filePath: result.mediaPath,
        mediaType: 'image',
        displayName: `${useCameraStageStore.getState().currentProjectName}-当前帧`,
        target: assetTarget,
      })
      setStateKeyframeHint(assetTarget.enabled && !collected ? '当前帧已更新到画布，资产收录失败' : '当前帧已更新到画布')
    } catch (error) {
      logger.error('3D 镜头当前帧更新失败', error, { event: 'camera_stage.canvas_frame.failed' })
      setStateKeyframeHint('当前帧更新失败')
    } finally { setStateKeyframeAction(null) }
  }, [activeCamera, assetTarget, embeddedOutput, prepareScreenshotDataUrl])

  const handleCopyScreenshot = useCallback(async (): Promise<void> => {
    setStateKeyframeAction('copy')
    try {
      const dataUrl = await prepareScreenshotDataUrl()
      if (!dataUrl) return

      await copySceneScreenshotToClipboard(dataUrl)
      setStateKeyframeHint('已复制到剪贴板')
    } catch (error) {
      logger.error('3D 镜头截图复制失败', error, { event: 'camera_stage.screenshot_copy.failed' })
      setStateKeyframeHint('截图复制失败')
    } finally {
      setStateKeyframeAction(null)
    }
  }, [prepareScreenshotDataUrl])

  const handleExportVideo = useCallback(async (): Promise<void> => {
    if (!activeCamera || !captureRef.current || videoProgress) return
    const exportState = useCameraStageStore.getState()
    const exportCameras = getCameraObjects(exportState.objects)
    const exportCamera = exportCameras[0]
    if (!exportCamera) return
    const renderCameraSchedule = buildRenderCameraSchedule(exportState.stateKeyframes, exportState.activeCameraId)
    const renderCameraIds = new Set(
      (renderCameraSchedule.length > 0
        ? renderCameraSchedule.map((entry) => entry.cameraId)
        : [exportState.activeCameraId]
      ).filter((cameraId): cameraId is string => !!cameraId),
    )
    const renderCameras = exportCameras.filter((camera) => renderCameraIds.has(camera.id))
    const hasInconsistentCameraAspectRatio = !areCameraAspectRatiosConsistent(renderCameras)
    if (hasInconsistentCameraAspectRatio) {
      setStateKeyframeHint('检测到机位画幅不一致，将按首摄像机画幅导出')
    }

    const previousPlayback = exportState.playback
    videoCancelRef.current = false
    setVideoProgress({
      phase: 'rendering',
      doneFrames: 0,
      totalFrames: Math.max(1, Math.round(exportState.animation.duration * exportState.animation.fps)),
    })

    if (previousPlayback.playing) {
      useCameraStageStore.getState().pause()
      await waitForCameraStageRender()
    }

    try {
      const result = await exportCameraStageVideo({
        projectName: exportState.currentProjectName,
        // 重要记录 007：首摄像机的画幅是工程级最终导出画幅，所有后续机位必须与其保持一致。
        cameraRatio: exportCamera.aspectRatio.ratio,
        renderCameraCount: renderCameras.length,
        isMultiCamera: renderCameras.length > 1,
        hasInconsistentCameraAspectRatio,
        fps: exportState.animation.fps,
        durationSeconds: exportState.animation.duration,
        resolutionPreset: videoPreset,
        renderStyle: exportState.sceneSettings.render.style,
        captureFrame: async (targetSize) => captureRef.current?.(targetSize) ?? null,
        disposeCaptureFrame: () => captureRef.current?.disposeOffscreen(),
        seekFrame: async (time) => {
          useCameraStageStore.getState().seek(time)
          await waitForCameraStageRender(1)
        },
        onProgress: (progress) => {
          setVideoProgress(progress)
          embeddedOutput?.onProgress(progress.totalFrames > 0 ? progress.doneFrames / progress.totalFrames : 0)
        },
        onSession: (sessionId) => {
          videoSessionRef.current = sessionId
        },
        isCancelled: () => videoCancelRef.current,
        saveToLocal: !embeddedOutput,
      })
      if (!result) {
        if (videoCancelRef.current) {
          setStateKeyframeHint('已取消视频导出')
        }
      } else {
        if (embeddedOutput) embeddedOutput.onVideo(result)
        const collected = await collectCameraStageAsset({
          filePath: result.mediaPath,
          mediaType: 'video',
          displayName: `${exportState.currentProjectName}-视频`,
          target: assetTarget,
        })
        const fileName = result.savedPath.split(/[\\/]/).pop() ?? result.savedPath
        setStateKeyframeHint(assetTarget.enabled && !collected ? `视频已导出：${fileName}，资产收录失败` : `视频已导出：${fileName}`)
      }
    } catch {
      setStateKeyframeHint('视频导出失败')
    } finally {
      const latest = useCameraStageStore.getState()
      latest.seek(Math.min(previousPlayback.currentTime, latest.animation.duration))
      if (previousPlayback.playing && !videoCancelRef.current) {
        useCameraStageStore.getState().play()
      }
      videoSessionRef.current = null
      videoCancelRef.current = false
      setVideoProgress(null)
      embeddedOutput?.onProgress(null)
    }
  }, [activeCamera, assetTarget, embeddedOutput, videoPreset, videoProgress])

  useEffect(() => {
    if (!autoExportVideoRequest
      || autoExportVideoRequest <= handledAutoExportRequestRef.current) return
    let cancelled = false
    void (async () => {
      for (let attempt = 0; attempt < 10 && !captureRef.current; attempt += 1) {
        await waitForCameraStageRender()
      }
      if (cancelled || !captureRef.current) return
      handledAutoExportRequestRef.current = autoExportVideoRequest
      await handleExportVideo()
    })()
    return () => { cancelled = true }
  }, [autoExportVideoRequest, handleExportVideo])

  const handleCancelVideoExport = useCallback((): void => {
    videoCancelRef.current = true
    const sessionId = videoSessionRef.current
    if (sessionId) {
      void cancelVideoFrameExport(sessionId)
    }
  }, [])

  // 截图提示 3s 后消失
  useEffect(() => {
    if (!stateKeyframeHint) return
    const timer = window.setTimeout(() => setStateKeyframeHint(null), 3000)
    return () => window.clearTimeout(timer)
  }, [stateKeyframeHint])

  useEffect(() => {
    if (currentProjectId) setSessionDocumentId(currentProjectId)
  }, [currentProjectId, setSessionDocumentId])

  useEffect(() => {
    setSessionViewMode(viewMode)
  }, [setSessionViewMode, viewMode])

  // 编辑器作用域快捷键：W/E/R 切 gizmo、F 聚焦选中对象、Delete 删除、Ctrl+D 复制、
  // Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z / Ctrl+Y 重做
  useCameraStageShortcuts({
    selectedId,
    setGizmoMode,
    removeObject,
    duplicateObject,
    requestFocusSelected,
    undo,
    redo,
  })

  /** 离开前先把当前摄像机视图落成列表封面（Canvas 卸载后就截不到了），再离开文档；封面失败不阻塞返回。 */
  const handleBackToList = useCallback(async (): Promise<void> => {
    const documentId = useCameraStageStore.getState().currentProjectId
    const capture = captureRef.current
    if (documentId && capture) await updateCameraStageProjectCover(documentId, () => capture())
    await onBackToList?.()
  }, [onBackToList])

  const autosaveErrorLabel = saveState?.status === 'failed' ? '自动保存失败' : null
  const videoProgressLabel = videoProgress
    ? videoProgress.phase === 'encoding'
      ? `编码 ${videoProgress.doneFrames}/${videoProgress.totalFrames}`
      : `导出 ${videoProgress.doneFrames}/${videoProgress.totalFrames}`
    : null

  // 输出动作：当前输出类型（单帧 → 截图/更新图片，多个状态关键帧 → 视频）是这条命令带唯一的主动作，
  // 另一种输出降为次级；资产收录与重置布局是低频设置，图标化。
  const imagePrimary = outputKind === 'image'
  const assetTargetLabel = `导出后加入资产库：${assetTarget.enabled ? '开启' : '关闭'}`
  const outputActions = (
    <>
      {embeddedOutput && outputKind === 'image' ? (
        <UiButton variant="primary" onClick={() => void handleUpdateCanvasFrame()} disabled={!canScreenshot || !!stateKeyframeAction}>
          <Camera size={14} className="mr-1.5" />{stateKeyframeAction ? '处理中…' : '更新图片'}
        </UiButton>
      ) : !embeddedOutput ? <PanelTrigger
        disabled={!canScreenshot || !!stateKeyframeAction}
        panelWidth={156}
        closeOnPanelClick
        panelPadding="menu"
        renderPanel={() => (
          <div className="flex flex-col gap-0.5" role="menu" aria-label="截图">
            <UiOptionButton
              role="menuitem"
              variant="menu"
              size="md"
              disabled={!!stateKeyframeAction}
              onClick={() => void handleSaveScreenshot()}
              className="w-full gap-2"
            >
              <Save size={14} />
              保存到本地
            </UiOptionButton>
            <UiOptionButton
              role="menuitem"
              variant="menu"
              size="md"
              disabled={!!stateKeyframeAction}
              onClick={() => void handleCopyScreenshot()}
              className="w-full gap-2"
            >
              <Clipboard size={14} />
              复制到剪贴板
            </UiOptionButton>
          </div>
        )}
      >
        {({ open, togglePanel }) => (
          <UiButton
            variant={imagePrimary ? 'primary' : 'secondary'}
            onClick={togglePanel}
            disabled={!canScreenshot || !!stateKeyframeAction}
            title={canScreenshot ? '当前摄像机取景截图' : '切换到摄像机视角后可截图'}
            aria-haspopup="menu"
            aria-expanded={open}
            data-panel-trigger-button
          >
            <Camera size={14} className="mr-1.5" />
            {stateKeyframeAction ? '处理中…' : '截图'}
          </UiButton>
        )}
      </PanelTrigger> : null}
      {videoProgress ? (
        <UiButton variant="secondary" onClick={handleCancelVideoExport}>
          <X size={14} className="mr-1.5" />
          取消导出
        </UiButton>
      ) : embeddedOutput && outputKind === 'video' ? (
        <UiButton variant="primary" onClick={() => void handleExportVideo()} disabled={!canExportVideo}>
          <Film size={14} className="mr-1.5" />渲染视频
        </UiButton>
      ) : !embeddedOutput ? (
        <PanelTrigger
          disabled={!canExportVideo}
          panelWidth={176}
          panelPadding="content"
          renderPanel={() => (
            <div className="flex flex-col gap-2">
              <Dropdown<CameraStageVideoResolutionPreset>
                value={videoPreset}
                display={videoPreset}
                options={VIDEO_RESOLUTION_OPTIONS}
                onSelect={setVideoPreset}
                className="w-full"
                size="sm"
                minWidthStrategy="none"
              />
              <UiButton
                variant="primary"
                size="sm"
                onClick={() => void handleExportVideo()}
                className="w-full gap-1.5"
              >
                <Film size={14} />
                导出 MP4
              </UiButton>
            </div>
          )}
        >
          {({ open, togglePanel }) => (
            <UiButton
              variant={imagePrimary ? 'secondary' : 'primary'}
              onClick={togglePanel}
              disabled={!canExportVideo}
              title={canExportVideo ? '导出当前摄像机动画为 MP4' : '切换到摄像机视角、并有两个以上状态关键帧后可导出视频'}
              aria-expanded={open}
              data-panel-trigger-button
            >
              <Film size={14} className="mr-1.5" />
              导出视频
            </UiButton>
          )}
        </PanelTrigger>
      ) : null}
    </>
  )

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-window">
      <UiToolbar
        variant="command"
        center={<StagePathContextBar />}
        trailing={(
          <>
            {videoProgressLabel && (
              <span role="status" className="max-w-28 truncate text-xs tabular-nums text-text2" title={videoProgressLabel}>
                {videoProgressLabel}
              </span>
            )}
            {stateKeyframeHint && <span role="status" className="max-w-64 truncate text-xs text-text2" title={stateKeyframeHint}>{stateKeyframeHint}</span>}
            {autosaveErrorLabel && (
              <span role="alert" className="max-w-28 truncate text-xs text-danger-text" title={autosaveErrorLabel}>
                {autosaveErrorLabel}
              </span>
            )}
            <PanelTrigger
              panelWidth={208}
              panelPadding="content"
              renderPanel={() => (
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-xs text-text2">
                    <UiCheckbox
                      checked={assetTarget.enabled}
                      onCheckedChange={(enabled) => updateAssetTarget({ ...assetTarget, enabled })}
                    />
                    导出后加入资产库
                  </label>
                  <Dropdown<string>
                    value={assetTarget.libraryId ?? '__uncategorized__'}
                    display={assetLibraries.find((item) => item.id === assetTarget.libraryId)?.name ?? '未分类'}
                    options={[
                      { label: '未分类', value: '__uncategorized__' },
                      ...assetLibraries.map((item) => ({ label: item.name, value: item.id })),
                    ]}
                    onSelect={(value) => updateAssetTarget({
                      ...assetTarget,
                      libraryId: value === '__uncategorized__' ? null : value,
                    })}
                    disabled={!assetTarget.enabled}
                    className="w-full"
                    size="sm"
                    minWidthStrategy="none"
                  />
                </div>
              )}
            >
              {({ open, togglePanel }) => (
                <UiIconButton
                  size="lg"
                  on={assetTarget.enabled}
                  onClick={togglePanel}
                  aria-expanded={open}
                  aria-label={assetTargetLabel}
                  title={assetTargetLabel}
                  data-panel-trigger-button
                >
                  <AssetLibraryIcon size={16} />
                </UiIconButton>
              )}
            </PanelTrigger>
            <UiIconButton
              size="lg"
              onClick={() => dockRef.current?.resetLayout()}
              aria-label="重置布局"
              title="恢复默认面板布局"
            >
              <LayoutDashboard size={16} />
            </UiIconButton>
            <span className="ml-1 flex items-center gap-1.5">{outputActions}</span>
          </>
        )}
      >
        {onBackToList && (
          <UiIconButton
            size="lg"
            aria-label={backLabel}
            title={backLabel}
            onClick={() => void handleBackToList()}
          >
            <ArrowLeft size={16} />
          </UiIconButton>
        )}
        <span className="min-w-0 max-w-40 truncate text-13 font-medium text-text1" title={projectName}>
          {projectName}
        </span>
        <UiIconButton
          size="lg"
          disabled={!canUndo}
          aria-label="撤销"
          title="撤销 (Ctrl+Z)"
          onClick={() => undo()}
        >
          <Undo2 size={16} />
        </UiIconButton>
        <QuickAddGroup />
        {/* 一条带只有这一条分隔线：左侧是“立刻添加”的动作，右侧是“接下来怎么操作”的变换模式 */}
        <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-line" />
        <StageViewportToolbar />
      </UiToolbar>

      <div className="relative min-h-0 flex-1">
        <CameraStageDock ref={dockRef} captureRef={captureRef} />
      </div>
    </div>
  )
}

export default CameraStageEditor
