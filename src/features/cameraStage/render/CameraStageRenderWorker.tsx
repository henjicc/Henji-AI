import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { flushSync } from '@react-three/fiber'
import {
  notifyCameraStageRenderWorkerReady,
  onCameraStageRenderWorkerCancel,
  onCameraStageRenderWorkerJob,
  reportCameraStageRenderWorkerEvent,
} from '@/commands/cameraStageRender'
import { createLogger } from '@/core/logging'
import type { CameraStageRenderRequest } from '@/platform/contracts/cameraStageRender'
import { areCameraAspectRatiosConsistent, getCameraObjects } from '../domain/cameraUtils'
import { buildRenderCameraSchedule } from '../domain/renderCameraSchedule'
import { exportCameraStageVideo } from '../export/cameraStageVideo'
import { loadProjectIntoScene } from '../projects/cameraStageProjectService'
import StageScene from '../scene/StageScene'
import type { StageCaptureFn } from '../scene/StageCaptureBridge'
import { useCameraStageStore } from '../store/cameraStageStore'

const logger = createLogger('cameraStage.backgroundRenderWorker')

function mapExportProgress(phase: 'rendering' | 'encoding', done: number, total: number): number {
  const ratio = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0
  return phase === 'rendering' ? ratio * 0.85 : 0.85 + ratio * 0.15
}

async function waitForCaptureBridge(captureRef: MutableRefObject<StageCaptureFn | null>): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (captureRef.current) return
    await new Promise<void>((resolve) => setTimeout(resolve, 16))
  }
  throw new Error('后台渲染场景初始化超时')
}

async function waitForSceneCommit(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 32))
}

export default function CameraStageRenderWorker(): JSX.Element {
  const captureRef = useRef<StageCaptureFn | null>(null)
  const cancelRef = useRef(false)
  const runningRequestIdRef = useRef<string | null>(null)
  const [request, setRequest] = useState<CameraStageRenderRequest | null>(null)
  const [sceneRequestId, setSceneRequestId] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribeJob = onCameraStageRenderWorkerJob((nextRequest) => {
      if (runningRequestIdRef.current) return
      cancelRef.current = false
      setRequest(nextRequest)
    })
    const unsubscribeCancel = onCameraStageRenderWorkerCancel((requestId) => {
      if (runningRequestIdRef.current === requestId) cancelRef.current = true
    })
    void notifyCameraStageRenderWorkerReady()
    return () => {
      unsubscribeJob()
      unsubscribeCancel()
    }
  }, [])

  useEffect(() => {
    if (!request || runningRequestIdRef.current) return
    let disposed = false
    runningRequestIdRef.current = request.requestId

    const reportFailure = async (error: unknown): Promise<void> => {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('后台 3D 视频渲染失败', error, {
        event: 'camera_stage.background_worker.failed',
        requestId: request.requestId,
        context: { nodeId: request.nodeId, projectId: request.projectId },
      })
      await reportCameraStageRenderWorkerEvent({
        type: 'failed',
        requestId: request.requestId,
        nodeId: request.nodeId,
        message,
      })
    }

    void (async () => {
      try {
        await reportCameraStageRenderWorkerEvent({
          type: 'progress',
          requestId: request.requestId,
          nodeId: request.nodeId,
          phase: 'preparing',
          progress: 0.02,
        })
        const loaded = await loadProjectIntoScene(request.projectId, { updateSession: false })
        if (!loaded) throw new Error('未找到需要渲染的 3D 镜头参考工程')
        if (cancelRef.current) {
          await reportCameraStageRenderWorkerEvent({
            type: 'cancelled',
            requestId: request.requestId,
            nodeId: request.nodeId,
          })
          return
        }

        const loadedState = useCameraStageStore.getState()
        const cameras = getCameraObjects(loadedState.objects)
        const exportCamera = cameras[0]
        if (!exportCamera) throw new Error('3D 镜头参考工程中没有可用摄像机')
        loadedState.pause()
        const activeCameraId = cameras.some((camera) => camera.id === loadedState.activeCameraId)
          ? loadedState.activeCameraId
          : exportCamera.id
        loadedState.setActiveCameraId(activeCameraId)
        loadedState.setViewMode('camera')
        loadedState.seek(0)
        setSceneRequestId(request.requestId)
        await waitForCaptureBridge(captureRef)
        await waitForSceneCommit()

        const exportState = useCameraStageStore.getState()
        const renderSchedule = buildRenderCameraSchedule(exportState.stateKeyframes, exportState.activeCameraId)
        const renderCameraIds = new Set(
          (renderSchedule.length > 0
            ? renderSchedule.map((entry) => entry.cameraId)
            : [exportState.activeCameraId]
          ).filter((cameraId): cameraId is string => !!cameraId),
        )
        const renderCameras = cameras.filter((camera) => renderCameraIds.has(camera.id))

        logger.info('后台 3D 视频渲染开始', {
          event: 'camera_stage.background_worker.start',
          requestId: request.requestId,
          context: {
            nodeId: request.nodeId,
            projectId: request.projectId,
            frameCount: Math.max(1, Math.round(exportState.animation.duration * exportState.animation.fps)),
          },
        })
        const result = await exportCameraStageVideo({
          projectName: exportState.currentProjectName,
          cameraRatio: exportCamera.aspectRatio.ratio,
          renderCameraCount: renderCameras.length,
          isMultiCamera: renderCameras.length > 1,
          hasInconsistentCameraAspectRatio: !areCameraAspectRatiosConsistent(renderCameras),
          fps: exportState.animation.fps,
          durationSeconds: exportState.animation.duration,
          resolutionPreset: request.resolutionPreset,
          captureFrame: async (targetSize) => captureRef.current?.(targetSize) ?? null,
          disposeCaptureFrame: () => captureRef.current?.disposeOffscreen(),
          seekFrame: (time) => {
            // 隐藏窗口的 RAF 会被 Chromium 节流到约 1fps；使用 R3F 自身的同步提交，
            // 保证对象、摄像机、FOV 与注视方向全部落到当前帧后立即抓取。
            flushSync(() => {
              useCameraStageStore.getState().seek(time)
            })
            return Promise.resolve()
          },
          onProgress: (progress) => {
            void reportCameraStageRenderWorkerEvent({
              type: 'progress',
              requestId: request.requestId,
              nodeId: request.nodeId,
              phase: progress.phase,
              progress: mapExportProgress(progress.phase, progress.doneFrames, progress.totalFrames),
            })
          },
          onSession: () => undefined,
          isCancelled: () => cancelRef.current,
          saveToLocal: false,
        })
        if (disposed) return
        if (!result || cancelRef.current) {
          await reportCameraStageRenderWorkerEvent({
            type: 'cancelled',
            requestId: request.requestId,
            nodeId: request.nodeId,
          })
          return
        }
        await reportCameraStageRenderWorkerEvent({
          type: 'completed',
          requestId: request.requestId,
          nodeId: request.nodeId,
          result,
        })
        logger.info('后台 3D 视频渲染完成', {
          event: 'camera_stage.background_worker.completed',
          requestId: request.requestId,
          context: { nodeId: request.nodeId, projectId: request.projectId, frameCount: result.frameCount },
        })
      } catch (error) {
        if (!disposed) await reportFailure(error)
      } finally {
        if (!disposed) {
          captureRef.current?.disposeOffscreen()
          runningRequestIdRef.current = null
          cancelRef.current = false
          setRequest(null)
          setSceneRequestId(null)
          void notifyCameraStageRenderWorkerReady()
        }
      }
    })()

    return () => {
      disposed = true
    }
  }, [request])

  return (
    <div className="h-screen w-screen overflow-hidden bg-app">
      {sceneRequestId && (
        <StageScene
          key={sceneRequestId}
          captureRef={captureRef}
          interactive={false}
          primary
        />
      )}
    </div>
  )
}
