import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createCurrentProjectDraft,
  saveProjectDraft,
  type CameraStageProjectDraft,
} from '../projects/cameraStageProjectService'
import { useCameraStageStore } from '../store/cameraStageStore'

export type CameraStageAutosaveState = 'idle' | 'saving' | 'saved' | 'error'

interface UseCameraStageAutosaveResult {
  saveState: CameraStageAutosaveState
  flushAutosave: () => Promise<void>
}

const AUTOSAVE_DEBOUNCE_MS = 700
const AUTOSAVE_STATE_RESET_MS = 1600

export function useCameraStageAutosave(): UseCameraStageAutosaveResult {
  const currentProjectId = useCameraStageStore((state) => state.currentProjectId)
  const currentProjectName = useCameraStageStore((state) => state.currentProjectName)
  const objects = useCameraStageStore((state) => state.objects)
  const activeCameraId = useCameraStageStore((state) => state.activeCameraId)
  const animation = useCameraStageStore((state) => state.animation)
  const sceneSettings = useCameraStageStore((state) => state.sceneSettings)
  const [saveState, setSaveState] = useState<CameraStageAutosaveState>('idle')

  const mountedRef = useRef(true)
  const initializedRef = useRef(false)
  const timerRef = useRef<number | null>(null)
  const saveInFlightRef = useRef(false)
  const resaveRequestedRef = useRef(false)
  const lastSavedFingerprintRef = useRef<string | null>(null)
  const flushAutosaveRef = useRef<(() => Promise<void>) | null>(null)

  const clearTimer = useCallback((): void => {
    if (timerRef.current === null) return
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const persistDraft = useCallback(
    async (draft: CameraStageProjectDraft): Promise<void> => {
      if (saveInFlightRef.current) {
        resaveRequestedRef.current = true
        return
      }

      saveInFlightRef.current = true
      if (mountedRef.current) {
        setSaveState('saving')
      }

      try {
        await saveProjectDraft(draft, false)
        lastSavedFingerprintRef.current = draft.fingerprint
        if (mountedRef.current) {
          setSaveState('saved')
        }
      } catch {
        if (mountedRef.current) {
          setSaveState('error')
        }
      } finally {
        saveInFlightRef.current = false
        if (resaveRequestedRef.current) {
          resaveRequestedRef.current = false
          await flushAutosaveRef.current?.()
        }
      }
    },
    [],
  )

  const flushAutosave = useCallback(async (): Promise<void> => {
    clearTimer()

    // Autosave 只更新已绑定工程，绝不能复用手动保存的“无 id 则新建”语义。
    // 工程恢复/错误边界重挂载期间会短暂出现未绑定空场景，若此时卸载 flush，
    // createCurrentProjectDraft 会生成 UUID 并制造一个 0 对象的幽灵工程。
    if (!useCameraStageStore.getState().currentProjectId) return
    const draft = createCurrentProjectDraft()
    if (!initializedRef.current) {
      initializedRef.current = true
      lastSavedFingerprintRef.current = draft.fingerprint
      return
    }
    if (draft.fingerprint === lastSavedFingerprintRef.current) {
      return
    }
    await persistDraft(draft)
  }, [clearTimer, persistDraft])

  flushAutosaveRef.current = flushAutosave

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (saveState !== 'saved' && saveState !== 'error') return
    const timer = window.setTimeout(() => {
      if (mountedRef.current) {
        setSaveState('idle')
      }
    }, AUTOSAVE_STATE_RESET_MS)
    return () => window.clearTimeout(timer)
  }, [saveState])

  useEffect(() => {
    if (!currentProjectId) {
      clearTimer()
      return clearTimer
    }
    const draft = createCurrentProjectDraft()
    if (!initializedRef.current) {
      initializedRef.current = true
      lastSavedFingerprintRef.current = draft.fingerprint
      return
    }

    clearTimer()
    timerRef.current = window.setTimeout(() => {
      void flushAutosave()
    }, AUTOSAVE_DEBOUNCE_MS)

    return clearTimer
  }, [
    activeCameraId,
    animation,
    clearTimer,
    currentProjectId,
    currentProjectName,
    flushAutosave,
    objects,
    sceneSettings,
  ])

  useEffect(() => {
    return () => {
      clearTimer()
      if (initializedRef.current) {
        void flushAutosave()
      }
    }
  }, [clearTimer, flushAutosave])

  return { saveState, flushAutosave }
}
