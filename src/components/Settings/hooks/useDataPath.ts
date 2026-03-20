import { createLogger } from '@/core/logging'
import { useEffect, useState } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { path } from '@tauri-apps/api'
import {

  getDataRoot,
  getDefaultDataRoot,
  hasExistingData,
  migrateData,
  resetToDefaultDataRoot,
  setCustomDataRoot
} from '../../../utils/dataPath'

const logger = createLogger('components.Settings.hooks.useDataPath')

type AlertType = 'success' | 'error' | 'warning'

export type AlertMessage = {
  key: string
  params?: Record<string, string | number>
}

export interface AlertState {
  open: boolean
  type: AlertType
  message: AlertMessage
}

export interface MigrationProgress {
  current: number
  total: number
  file: string
}

export interface ConflictState {
  open: boolean
  targetPath: string
}

export interface UseDataPathResult {
  currentPath: string
  defaultPath: string
  isMigrating: boolean
  progress: MigrationProgress
  showProgress: boolean
  alert: AlertState
  conflict: ConflictState
  confirmResetOpen: boolean
  selectDirectory: () => Promise<void>
  openResetConfirm: () => void
  closeResetConfirm: () => void
  resolveConflict: (action: 'merge' | 'overwrite' | 'cancel') => Promise<void>
  resetToDefault: () => Promise<void>
  closeAlert: () => void
  closeConflict: () => void
}

const EMPTY_PROGRESS: MigrationProgress = { current: 0, total: 0, file: '' }

export function useDataPath(): UseDataPathResult {
  const [currentPath, setCurrentPath] = useState<string>('')
  const [defaultPath, setDefaultPath] = useState<string>('')
  const [isMigrating, setIsMigrating] = useState(false)
  const [progress, setProgress] = useState<MigrationProgress>(EMPTY_PROGRESS)
  const [showProgress, setShowProgress] = useState(false)
  const [alert, setAlert] = useState<AlertState>({
    open: false,
    type: 'success',
    message: { key: '' }
  })
  const [conflict, setConflict] = useState<ConflictState>({
    open: false,
    targetPath: ''
  })
  const [confirmResetOpen, setConfirmResetOpen] = useState(false)

  useEffect(() => {
    const loadPaths = async () => {
      try {
        const [current, defaultRoot] = await Promise.all([
          getDataRoot(),
          getDefaultDataRoot()
        ])
        setCurrentPath(current)
        setDefaultPath(defaultRoot)
      } catch (error) {
        logger.error('加载数据路径失败:', error)
      }
    }
    loadPaths()
  }, [])

  const setAlertState = (type: AlertType, key: string, params?: Record<string, string | number>) => {
    setAlert({ open: true, type, message: { key, params } })
  }

  const closeAlert = () => {
    setAlert(prev => ({ ...prev, open: false }))
  }

  const closeConflict = () => {
    setConflict({ open: false, targetPath: '' })
  }

  const openResetConfirm = () => {
    setConfirmResetOpen(true)
  }

  const closeResetConfirm = () => {
    setConfirmResetOpen(false)
  }

  const performMigration = async (
    oldPath: string,
    newPath: string,
    mode: 'normal' | 'merge' | 'overwrite',
    applyDefault: boolean
  ) => {
    setIsMigrating(true)
    setShowProgress(true)
    setProgress(EMPTY_PROGRESS)
    try {
      await migrateData(oldPath, newPath, (current, total, file) => {
        setProgress({ current, total, file })
      }, mode)
      if (applyDefault) {
        await resetToDefaultDataRoot()
      } else {
        await setCustomDataRoot(newPath)
      }
      setCurrentPath(newPath)
      window.dispatchEvent(new Event('dataPathChanged'))
      setAlertState('success', 'alerts.migrationSuccess')
    } catch (error) {
      logger.error('数据迁移失败:', error)
      const message = error instanceof Error ? error.message : 'UnknownError'
      setAlertState('error', 'alerts.migrationFailed', { message })
    } finally {
      setIsMigrating(false)
      setShowProgress(false)
    }
  }

  const selectDirectory = async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false
    })
    if (!selected || Array.isArray(selected)) {
      return
    }
    const targetPath = await path.join(selected, 'Henji-AI')
    const hasData = await hasExistingData(targetPath)
    if (hasData) {
      setConflict({ open: true, targetPath })
      return
    }
    if (!currentPath) {
      return
    }
    await performMigration(currentPath, targetPath, 'normal', false)
  }

  const resolveConflict = async (action: 'merge' | 'overwrite' | 'cancel') => {
    if (action === 'cancel') {
      closeConflict()
      return
    }
    const targetPath = conflict.targetPath
    closeConflict()
    if (!currentPath || !targetPath) {
      return
    }
    await performMigration(currentPath, targetPath, action, false)
  }

  const resetToDefault = async () => {
    closeResetConfirm()
    if (!currentPath || !defaultPath) {
      return
    }
    await performMigration(currentPath, defaultPath, 'normal', true)
  }

  return {
    currentPath,
    defaultPath,
    isMigrating,
    progress,
    showProgress,
    alert,
    conflict,
    confirmResetOpen,
    selectDirectory,
    openResetConfirm,
    closeResetConfirm,
    resolveConflict,
    resetToDefault,
    closeAlert,
    closeConflict
  }
}

