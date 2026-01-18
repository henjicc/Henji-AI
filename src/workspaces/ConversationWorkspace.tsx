import React, { useState, useEffect, useRef, useCallback } from 'react'
import { apiService } from '../services/api'
import MediaGenerator from '../components/MediaGenerator'
import SettingsModal from '../components/SettingsModal'
import ContextMenu from '../components/ContextMenu'
import { taskQueueManager } from '../services/taskQueue'
import { MediaResult } from '../types'
import { isDesktop, saveImageFromUrl, saveAudioFromUrl, fileToBlobSrc, fileToDataUrl, readJsonFromAppData, writeJsonToAppData, downloadMediaFile, quickDownloadMediaFile, deleteWaveformCacheForAudio, saveBase64ToUploads, dataUrlToBlob, ensureCompressedJpegBytesWithPica, saveBytesToUploads } from '../utils/save'
import { initializeDataDirectory, getDataRoot, convertPathString, convertPathArray } from '../utils/dataPath'
import { convertFileSrc } from '@tauri-apps/api/core'
import { invoke } from '@tauri-apps/api/core'
import AudioPlayer from '../components/AudioPlayer'
import { remove } from '@tauri-apps/plugin-fs'
import { useDragDrop } from '../contexts/DragDropContext'
import { useContextMenu, MenuItem } from '../hooks/useContextMenu'
import { providers } from '../config/providers'
import { ProgressBar } from '../components/ui/ProgressBar'
import { calculateProgress } from '../utils/progress'
import { loadPresets } from '../utils/preset'
import { canDeleteFile } from '../utils/fileRefCount'
import { getMediaDimensions, getMediaDurationFormatted } from '../utils/mediaDimensions'
import { migrateAllData } from '../utils/parameterMigration'
import TestModeIndicator from '../components/TestModeIndicator'
import TestModePanel from '../components/TestModePanel'
import TestModeParamsDisplay from '../components/TestModeParamsDisplay'
import { shouldSkipRequest, logRequestParams } from '../utils/testMode'
import { logError, logWarning, logInfo } from '../utils/errorLogger'
import { shouldCheckForUpdates, updateLastCheckTime, isVersionIgnored } from '../utils/updateConfig'
import { checkForUpdates, getCurrentVersion } from '../services/updateChecker'
import UpdateDialog from '../components/UpdateDialog'
import { ImageEditor, ImageEditState } from '../components/ImageEditor'
import { saveEditState, loadEditState, deleteEditState } from '../utils/editStatePersistence'

/**
 * 格式化模型显示名称
 * @param modelId 模型ID
 * @returns 格式化后的显示名称，格式为"供应商：模型名称"
 */
const formatModelDisplayName = (modelId: string): string => {
  // 遍历所有供应商
  for (const provider of providers) {
    // 在当前供应商的模型列表中查找匹配的模型
    const model = provider.models.find(m => m.id === modelId)
    if (model) {
      return `${provider.name}：${model.name}`
    }
  }
  // 如果找不到，返回原始 ID
  return modelId
}

// 定义生成任务类型
interface GenerationTask {
  id: string
  type: 'image' | 'video' | 'audio'
  prompt: string
  model: string  // 保存使用的模型
  provider?: string  // 保存供应商信息（用于继续查询）
  images?: string[]  // 上传的图片（用于显示）
  videos?: string[]  // 上传的视频（用于显示）
  size?: string
  dimensions?: string  // 实际媒体尺寸（从文件中提取）
  duration?: string  // 实际媒体时长（从文件中提取，格式化后的字符串如 "1:23"）
  status: 'queued' | 'pending' | 'generating' | 'success' | 'error' | 'timeout'  // 添加 queued 排队状态
  result?: MediaResult
  error?: string
  uploadedFilePaths?: string[]  // 上传的图片文件路径
  uploadedVideoFilePaths?: string[]  // 上传的视频文件路径
  progress?: number
  requestId?: string
  modelId?: string
  message?: string
  options?: any
  serverTaskId?: string
  timedOut?: boolean
}

const ConversationWorkspace: React.FC = () => {
  const { startDrag } = useDragDrop()
  const isDraggingRef = useRef(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [tasks, setTasks] = useState<GenerationTask[]>([])
  // 独立的进度状态 - 不触发任务列表重新渲染
  const [taskProgress, setTaskProgress] = useState<Record<string, number>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false) // 是否有任务正在生成
  const [error, setError] = useState<string | null>(null)
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' } | null>(null)
  const [notificationVisible, setNotificationVisible] = useState(false)
  const notificationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false)

  const [currentImage, setCurrentImage] = useState('')
  const [currentImageList, setCurrentImageList] = useState<string[]>([])
  const [currentFilePathList, setCurrentFilePathList] = useState<string[]>([])
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0 })

  const [isTasksLoaded, setIsTasksLoaded] = useState(false)
  const [isUserAtBottom, setIsUserAtBottom] = useState(true)
  const [viewerOpacity, setViewerOpacity] = useState(0)
  const [isConfirmClearOpen, setIsConfirmClearOpen] = useState(false)
  const [confirmOpacity, setConfirmOpacity] = useState(0)
  const [needsClearAllConfirm, setNeedsClearAllConfirm] = useState(false)
  const tasksEndRef = React.useRef<HTMLDivElement>(null)
  const listContainerRef = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const imageViewerRef = React.useRef<HTMLImageElement>(null)
  const imageViewerContainerRef = React.useRef<HTMLDivElement>(null)
  const cssScaleRef = React.useRef<number>(1) // 存储CSS缩放比例（相对于原始尺寸）
  const imageScaleRef = React.useRef(1)
  const imagePositionRef = React.useRef({ x: 0, y: 0 })
  const [isVideoViewerOpen, setIsVideoViewerOpen] = useState(false)
  const [videoViewerOpacity, setVideoViewerOpacity] = useState(0)
  const [currentVideoUrl, setCurrentVideoUrl] = useState('')
  const [currentVideoPath, setCurrentVideoPath] = useState('')
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  const [videoDuration, setVideoDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [loop, setLoop] = useState(false)
  const [isBuffering, setIsBuffering] = useState(false)
  const [isSpeedMenuOpen, setIsSpeedMenuOpen] = useState(false)
  const [isControlsVisible, setIsControlsVisible] = useState(true)
  const [showVolumeIndicator, setShowVolumeIndicator] = useState(false)
  const volumeIndicatorTimer = React.useRef<number | null>(null)

  // 测试模式状态
  const [isTestPanelOpen, setIsTestPanelOpen] = useState(false)
  const controlsHideTimer = React.useRef<number | null>(null)
  const [isVolumeMenuOpen, setIsVolumeMenuOpen] = useState(false)
  const progressBarRef = React.useRef<HTMLDivElement>(null)
  const progressFillRef = React.useRef<HTMLDivElement>(null)
  const rafIdRef = React.useRef<number | null>(null)
  const [isDraggingProgress, setIsDraggingProgress] = useState(false)
  const targetScaleRef = React.useRef(1)
  const targetPositionRef = React.useRef({ x: 0, y: 0 })
  const animationFrameRef = React.useRef<number | null>(null)
  const scaleDisplayRef = React.useRef<HTMLDivElement>(null)

  // 图片编辑器状态
  const [isEditorMode, setIsEditorMode] = useState(false)
  const [isFromUploadArea, setIsFromUploadArea] = useState(false)  // 标识图片是否来自上传区域
  const imageEditStatesRef = React.useRef<Map<string, ImageEditState>>(new Map())
  const setUploadedImagesRef = React.useRef<React.Dispatch<React.SetStateAction<string[]>> | null>(null)
  const setUploadedFilePathsRef = React.useRef<React.Dispatch<React.SetStateAction<string[]>> | null>(null)

  const speedDisplayRef = React.useRef<HTMLDivElement>(null)
  const speedMenuRef = React.useRef<HTMLDivElement>(null)
  const volumeDisplayRef = React.useRef<HTMLDivElement>(null)
  const volumeMenuRef = React.useRef<HTMLDivElement>(null)

  const controlsContainerRef = React.useRef<HTMLDivElement>(null)
  const [autoPlayOnOpen, setAutoPlayOnOpen] = useState(false)
  const inputContainerRef = React.useRef<HTMLDivElement>(null)
  const [inputPadding, setInputPadding] = useState<number>(400)
  const [isReady, setIsReady] = useState(false)

  // 智能折叠相关状态
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false)
  const [isCollapsing, setIsCollapsing] = useState(false) // 动画进行中
  const [enableAutoCollapse, setEnableAutoCollapse] = useState(true)
  const [collapseDelay, setCollapseDelay] = useState(500)
  const [collapseOnScrollOnly, setCollapseOnScrollOnly] = useState(true)
  const [currentModelName, setCurrentModelName] = useState('')
  const [currentPrompt, setCurrentPrompt] = useState('')
  const collapseTimerRef = React.useRef<number | null>(null)
  const isPanelHoveredRef = React.useRef(false)
  const collapseAnimationRef = React.useRef<number | null>(null)
  const lastScrollTopRef = React.useRef(0)
  const isProgrammaticScrollRef = React.useRef(false) // 标记是否为程序调整滚动

  // 图片拖动状态 - 用于动态调整底部面板 z-index
  const [isImageDragging, setIsImageDragging] = useState(false)

  // 追踪最后一次右键点击时间，用于防止触摸板双指右击后意外触发拖动
  const lastContextMenuTimeRef = React.useRef<number>(0)

  // 更新检测相关状态
  const [showUpdateDialog, setShowUpdateDialog] = useState(false)
  const [updateReleaseInfo, setUpdateReleaseInfo] = useState<any>(null)

  // 数据迁移 - 在应用启动时执行一次
  useEffect(() => {
    migrateAllData()
  }, [])

  // 初始化数据目录
  useEffect(() => {
    const init = async () => {
      if (!isDesktop()) return
      try {
        const dataRoot = await getDataRoot()
        await initializeDataDirectory(dataRoot)
        logInfo('[App] 数据目录已初始化:', dataRoot)
      } catch (error) {
        logError('[App] 初始化数据目录失败:', error)
      }
    }
    init()
  }, [])

  // 应用启动时检查更新
  useEffect(() => {
    const checkUpdate = async () => {
      // 检查是否应该进行更新检测
      if (!shouldCheckForUpdates()) {
        return
      }

      try {
        logInfo('[App]', '开始检查更新...')
        const result = await checkForUpdates()

        // 更新最后检查时间
        updateLastCheckTime()

        if (result.hasUpdate && result.releaseInfo) {
          const latestVersion = result.latestVersion || ''

          // 检查该版本是否被用户忽略
          if (isVersionIgnored(latestVersion)) {
            logInfo('[App]', `版本 ${latestVersion} 已被用户忽略`)
            return
          }

          logInfo('[App]', `发现新版本: ${latestVersion}`)
          setUpdateReleaseInfo(result.releaseInfo)
          setShowUpdateDialog(true)
        } else {
          logInfo('[App]', '当前已是最新版本')
        }
      } catch (error) {
        logError('[App] 检查更新失败:', error)
      }
    }

    // 延迟 2 秒后检查更新，避免影响应用启动速度
    const timer = setTimeout(() => {
      checkUpdate()
    }, 2000)

    return () => clearTimeout(timer)
  }, [])

  // 监听数据路径变更事件
  useEffect(() => {
    const handlePathChange = async () => {
      if (!isDesktop()) return
      logInfo('', '[App] 检测到数据路径变更，重新加载历史记录')
      try {
        const fileHistory = await readJsonFromAppData<any[]>('history.json')
        if (fileHistory) {
          const loaded = fileHistory.map((task: any) => {
            let result = task.result
            if (result && result.filePath) {
              try {
                if (typeof result.filePath === 'string' && result.filePath.includes('|||')) {
                  const paths = result.filePath.split('|||')
                  const display = paths.map((p: string) => convertFileSrc(p)).join('|||')
                  result = { ...result, url: display }
                } else {
                  result = { ...result, url: convertFileSrc(result.filePath) }
                }
              } catch { }
            }

            // 处理视频字段：将文件路径转换为可访问的 URL
            let videos = task.videos
            if (task.uploadedVideoFilePaths && task.uploadedVideoFilePaths.length > 0) {
              videos = task.uploadedVideoFilePaths.map((p: string) => convertFileSrc(p))
            }

            return {
              ...task,
              videos,
              result: result ? { ...result, createdAt: result.createdAt ? new Date(result.createdAt) : new Date() } : undefined
            }
          })
          setTasks(loaded)
          logInfo('', '[App] 历史记录已重新加载')
        }
      } catch (error) {
        logError('[App] 重新加载历史记录失败:', error)
      }
    }

    window.addEventListener('dataPathChanged', handlePathChange)
    return () => window.removeEventListener('dataPathChanged', handlePathChange)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsReady(true)
    }, 100)
    return () => clearTimeout(timer)
  }, [])

  // 测试模式快捷键监听 (Ctrl+Alt+Shift+T 和 F12)
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      // Ctrl+Alt+Shift+T - 打开测试模式面板
      if (e.ctrlKey && e.altKey && e.shiftKey && e.key === 'T') {
        e.preventDefault()
        setIsTestPanelOpen(prev => !prev)
      }

      // F12 - 打开开发者工具
      if (e.key === 'F12') {
        // 开发环境：始终允许打开开发者工具
        if (import.meta.env.DEV) {
          e.preventDefault()
          try {
            const { invoke } = await import('@tauri-apps/api/core')
            await invoke('toggle_devtools')
            logInfo('', '[DevTools] 开发者工具已切换')
          } catch (error) {
            logError('[DevTools] 打开开发者工具失败:', error)
          }
          return
        }

        // 生产环境：需要测试模式授权
        e.preventDefault() // 阻止默认行为

        const { getTestModeState } = await import('@/utils/testMode')
        const testMode = getTestModeState()

        if (testMode.enabled && testMode.options.enableDevTools) {
          // 调用 Tauri 命令打开开发者工具
          try {
            const { invoke } = await import('@tauri-apps/api/core')
            await invoke('toggle_devtools')
            logInfo('', '[DevTools] 开发者工具已切换')
          } catch (error) {
            logError('[DevTools] 打开开发者工具失败:', error)
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // 初始化时监听首次鼠标交互
  useEffect(() => {
    let isInitialized = false

    const handleFirstInteraction = (e: MouseEvent) => {
      if (isInitialized) return
      isInitialized = true

      const panel = inputContainerRef.current
      if (!panel) return

      const rect = panel.getBoundingClientRect()
      const isInside = (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      )

      isPanelHoveredRef.current = isInside
    }

    // 监听多种交互事件
    document.addEventListener('mousemove', handleFirstInteraction, { once: true, passive: true })
    document.addEventListener('mousedown', handleFirstInteraction, { once: true, passive: true })
    document.addEventListener('wheel', handleFirstInteraction, { once: true, passive: true })

    return () => {
      document.removeEventListener('mousemove', handleFirstInteraction)
      document.removeEventListener('mousedown', handleFirstInteraction)
      document.removeEventListener('wheel', handleFirstInteraction)
    }
  }, [])

  // 持续监测鼠标位置，确保状态同步
  useEffect(() => {
    let lastMouseX = 0
    let lastMouseY = 0

    const checkMousePosition = () => {
      const panel = inputContainerRef.current
      if (!panel) return

      // 使用 document.elementsFromPoint 获取鼠标下的所有元素
      const elements = document.elementsFromPoint(lastMouseX, lastMouseY)
      const isInside = elements.some(el => panel.contains(el))

      if (isPanelHoveredRef.current !== isInside) {
        isPanelHoveredRef.current = isInside
      }
    }

    // 全局跟踪鼠标位置
    const trackMousePosition = (e: MouseEvent) => {
      lastMouseX = e.clientX
      lastMouseY = e.clientY
    }

    document.addEventListener('mousemove', trackMousePosition, { passive: true })

    // 定期检查鼠标位置（每500ms）
    const interval = setInterval(checkMousePosition, 500)

    return () => {
      document.removeEventListener('mousemove', trackMousePosition)
      clearInterval(interval)
    }
  }, [])

  // 从 localStorage 加载折叠设置
  useEffect(() => {
    const savedAutoCollapse = localStorage.getItem('enable_auto_collapse')
    setEnableAutoCollapse(savedAutoCollapse !== 'false')
    const savedCollapseDelay = parseInt(localStorage.getItem('collapse_delay') || '500', 10)
    setCollapseDelay(savedCollapseDelay)
    const savedCollapseOnScrollOnly = localStorage.getItem('collapse_on_scroll_only')
    setCollapseOnScrollOnly(savedCollapseOnScrollOnly !== 'false')

    // 监听设置变化
    const handleSettingChange = () => {
      const newAutoCollapse = localStorage.getItem('enable_auto_collapse')
      setEnableAutoCollapse(newAutoCollapse !== 'false')
      const newDelay = parseInt(localStorage.getItem('collapse_delay') || '500', 10)
      setCollapseDelay(newDelay)
      const newCollapseOnScrollOnly = localStorage.getItem('collapse_on_scroll_only')
      setCollapseOnScrollOnly(newCollapseOnScrollOnly !== 'false')
    }
    window.addEventListener('collapseSettingChanged', handleSettingChange)
    return () => window.removeEventListener('collapseSettingChanged', handleSettingChange)
  }, [])

  // 监听 MediaGenerator 状态变化
  useEffect(() => {
    const handleStateChange = (e: Event) => {
      const customEvent = e as CustomEvent
      const { modelName, prompt } = customEvent.detail
      setCurrentModelName(modelName)
      setCurrentPrompt(prompt)
    }
    window.addEventListener('generatorStateChanged', handleStateChange)
    return () => window.removeEventListener('generatorStateChanged', handleStateChange)
  }, [])

  // 监听图片拖动状态变化
  useEffect(() => {
    const handleDragStateChange = (e: Event) => {
      const customEvent = e as CustomEvent
      const { isDragging } = customEvent.detail
      setIsImageDragging(isDragging)
    }
    window.addEventListener('imageDragStateChanged', handleDragStateChange)
    return () => window.removeEventListener('imageDragStateChanged', handleDragStateChange)
  }, [])

  // 清除历史确认对话框动画
  useEffect(() => {
    if (isConfirmClearOpen) {
      requestAnimationFrame(() => setConfirmOpacity(1))
    }
  }, [isConfirmClearOpen])

  // 初始化右键菜单
  const { menuVisible, menuPosition, menuItems, showMenu, hideMenu } = useContextMenu()

  const scrollToBottom = () => {
    const el = listContainerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }

  const updateBottomState = () => {
    const el = listContainerRef.current
    if (!el) return
    const threshold = 8
    const atBottom = el.scrollHeight - el.clientHeight - el.scrollTop <= threshold
    setIsUserAtBottom(atBottom)
  }

  useEffect(() => {
    const el = listContainerRef.current
    if (!el) return
    updateBottomState()
    const handler = () => updateBottomState()
    el.addEventListener('scroll', handler)
    return () => { el.removeEventListener('scroll', handler) }
  }, [])

  useEffect(() => {
    const contentEl = contentRef.current
    if (!contentEl) return
    const ro = new ResizeObserver(() => {
      if (isUserAtBottom) scrollToBottom()
    })
    ro.observe(contentEl)
    return () => { ro.disconnect() }
  }, [isUserAtBottom])

  useEffect(() => {
    const inputEl = inputContainerRef.current
    const listEl = listContainerRef.current
    if (!inputEl || !listEl) return

    const update = () => {
      const h = inputEl.offsetHeight || 0
      // 折叠时使用固定的小高度，展开时使用实际高度
      // 关键修改：当正在折叠动画进行中时，也要使用展开后的高度
      const actualHeight = (isPanelCollapsed && !isCollapsing) ? 60 : h
      setInputPadding(actualHeight + 24)

      const newPadding = actualHeight + 24
      const oldPadding = parseInt(listEl.style.paddingBottom) || 0
      const paddingDiff = newPadding - oldPadding

      // 关键：如果 padding 增加且用户在底部，调整 scrollTop
      const threshold = 8
      const atBottom = listEl.scrollHeight - listEl.clientHeight - listEl.scrollTop <= threshold

      listEl.style.paddingBottom = `${newPadding}px`

      // 如果用户在底部且 padding 增加，自动调整滚动位置
      if (atBottom && paddingDiff > 0) {
        isProgrammaticScrollRef.current = true
        listEl.scrollTop += paddingDiff
        requestAnimationFrame(() => {
          isProgrammaticScrollRef.current = false
        })
      }
    }

    update()
    const ro = new ResizeObserver(update)
    ro.observe(inputEl)
    return () => { ro.disconnect() }
  }, [isPanelCollapsed, isCollapsing])

  const finalizeInitialScroll = async () => {
    const el = listContainerRef.current
    if (!el) return
    const imgs = Array.from(el.querySelectorAll('img')) as HTMLImageElement[]
    const pending = imgs.filter(img => !img.complete)
    if (pending.length) {
      await Promise.all(pending.map(img => new Promise<void>(resolve => {
        img.addEventListener('load', () => resolve(), { once: true })
        img.addEventListener('error', () => resolve(), { once: true })
      })))
    }
    scrollToBottom()
  }

  // 智能折叠逻辑：监听滚动和鼠标事件
  useEffect(() => {
    if (!enableAutoCollapse) {
      expandPanelSmooth()
      return
    }

    const el = listContainerRef.current
    if (!el) return

    // 初始化滚动位置
    lastScrollTopRef.current = el.scrollTop

    const handleScroll = () => {
      // 关键：忽略程序触发的滚动事件
      if (isProgrammaticScrollRef.current) {
        return
      }

      const threshold = 8
      const currentScrollTop = el.scrollTop
      const atBottom = el.scrollHeight - el.clientHeight - el.scrollTop <= threshold
      // const isScrollingUp = currentScrollTop > lastScrollTopRef.current
      const scrollDelta = Math.abs(currentScrollTop - lastScrollTopRef.current)

      // 关键修改：检查最新一条历史记录是否在可视区域内
      const lastTaskElement = el.querySelector('.space-y-6 > div:last-child')
      let isLastTaskVisible = false

      if (lastTaskElement) {
        const taskRect = lastTaskElement.getBoundingClientRect()
        const containerRect = el.getBoundingClientRect()
        // 最新记录的底部是否在容器的可视区域内（留一些余量）
        isLastTaskVisible = taskRect.bottom > containerRect.top && taskRect.top < containerRect.bottom
      }

      // 更新最后滚动位置
      lastScrollTopRef.current = currentScrollTop

      // 如果用户滚动到底部，立即展开面板
      if (atBottom) {
        if (collapseTimerRef.current) {
          clearTimeout(collapseTimerRef.current)
          collapseTimerRef.current = null
        }
        expandPanelSmooth()
        return
      }

      // 关键修改：只有当最新记录完全离开可视区域时才折叠
      // 条件：
      // 1. 不在底部
      // 2. 滚动距离足够（避免微小抖动）
      // 3. 鼠标不在面板上
      // 4. 最新记录已经不可见（完全滚出视图）
      if (scrollDelta > 3 && !isPanelHoveredRef.current && !isLastTaskVisible) {
        if (collapseTimerRef.current) {
          clearTimeout(collapseTimerRef.current)
          collapseTimerRef.current = null
        }
        collapsePanelSmooth()
      }
    }

    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', handleScroll)
      if (collapseTimerRef.current) {
        clearTimeout(collapseTimerRef.current)
      }
      if (collapseAnimationRef.current) {
        clearTimeout(collapseAnimationRef.current)
      }
    }
  }, [enableAutoCollapse, collapseDelay, isPanelCollapsed, isCollapsing])

  // 平滑折叠面板
  const collapsePanelSmooth = () => {
    if (isPanelCollapsed || isCollapsing) return
    setIsCollapsing(true)
    // 先触发折叠动画
    requestAnimationFrame(() => {
      // 等待动画完成后更新状态
      collapseAnimationRef.current = window.setTimeout(() => {
        setIsPanelCollapsed(true)
        setIsCollapsing(false)
      }, 500) // 延长到 500ms
    })
  }

  // 平滑展开面板
  const expandPanelSmooth = () => {
    if (!isPanelCollapsed && !isCollapsing) return
    if (collapseAnimationRef.current) {
      clearTimeout(collapseAnimationRef.current)
      collapseAnimationRef.current = null
    }

    // 先更新 isCollapsing 状态，触发 paddingBottom 立即调整
    // padding 的调整和 scrollTop 的补偿现在在 useEffect 中处理
    setIsCollapsing(true)

    // 然后在下一帧开始展开动画
    requestAnimationFrame(() => {
      setIsPanelCollapsed(false)
      setIsCollapsing(false)
    })
  }

  // 处理面板鼠标进入/离开事件
  const handlePanelMouseEnter = () => {
    isPanelHoveredRef.current = true
    if (collapseTimerRef.current) {
      clearTimeout(collapseTimerRef.current)
      collapseTimerRef.current = null
    }
    expandPanelSmooth()
  }

  const handlePanelMouseLeave = () => {
    isPanelHoveredRef.current = false

    if (!enableAutoCollapse) return

    // 如果开启了"仅滚动时折叠"，则鼠标移开时不折叠
    if (collapseOnScrollOnly) return

    // 鼠标离开后，立即检查当前状态
    const el = listContainerRef.current
    if (!el) return

    const threshold = 8
    const atBottom = el.scrollHeight - el.clientHeight - el.scrollTop <= threshold

    // 检查最新记录是否可见
    const lastTaskElement = el.querySelector('.space-y-6 > div:last-child')
    let isLastTaskVisible = false
    if (lastTaskElement) {
      const taskRect = lastTaskElement.getBoundingClientRect()
      const containerRect = el.getBoundingClientRect()
      isLastTaskVisible = taskRect.bottom > containerRect.top && taskRect.top < containerRect.bottom
    }

    // 如果不在底部且最新记录不可见，使用延迟折叠
    if (!atBottom && !isLastTaskVisible) {
      if (collapseTimerRef.current) {
        clearTimeout(collapseTimerRef.current)
      }
      collapseTimerRef.current = window.setTimeout(() => {
        // 再次确认鼠标确实不在面板上
        if (!isPanelHoveredRef.current) {
          collapsePanelSmooth()
        }
      }, collapseDelay)
    }
  }

  // 持续同步鼠标位置状态
  const handlePanelMouseMove = () => {
    // 确保鼠标在面板内时状态始终为 true
    if (!isPanelHoveredRef.current) {
      isPanelHoveredRef.current = true
    }
  }

  // 图片查看器打开时的动画
  useEffect(() => {
    if (isImageViewerOpen) {
      requestAnimationFrame(() => {
        setViewerOpacity(1)
      })
      // 动画完成后，调用 updateImageTransform 接管 transform 控制
      setTimeout(() => {
        updateImageTransform()
      }, 250)
    }
  }, [isImageViewerOpen])

  // 视频查看器打开时的动画
  useEffect(() => {
    if (isVideoViewerOpen) {
      requestAnimationFrame(() => {
        setVideoViewerOpacity(1)
      })
    }
  }, [isVideoViewerOpen])

  const updateImageTransform = () => {
    if (!imageViewerRef.current) return
    const scale = imageScaleRef.current
    const pos = imagePositionRef.current
    imageViewerRef.current.style.transform = `scale(${scale}) translate(${pos.x / scale}px, ${pos.y / scale}px)`
    if (scaleDisplayRef.current) {
      // 总缩放比例 = CSS缩放比例 × Transform缩放比例
      const totalScale = cssScaleRef.current * scale
      scaleDisplayRef.current.innerText = `${Math.round(totalScale * 100)}%`
    }
  }

  // 图片查看器滚轮缩放（使用原生事件避免 passive 警告）
  useEffect(() => {
    const container = imageViewerContainerRef.current
    if (!container || !isImageViewerOpen) return

    const handleWheel = (e: WheelEvent) => {
      // 检查鼠标是否在实际图片内容上
      if (!isPositionOnImageContent(e.clientX, e.clientY)) {
        // 不在图片内容上，不执行缩放
        return
      }

      e.preventDefault()

      // 如果没有正在进行的动画，初始化目标状态为当前状态
      if (!animationFrameRef.current) {
        targetScaleRef.current = imageScaleRef.current
        targetPositionRef.current = imagePositionRef.current
      }

      const currentScale = targetScaleRef.current
      const currentPos = targetPositionRef.current

      // Windows 照片风格：滚轮向上放大，向下缩小
      // 使用乘法因子实现平滑缩放
      const zoom = e.deltaY > 0 ? (1 / 1.1) : 1.1
      let newScale = currentScale * zoom

      // 限制缩放范围
      newScale = Math.max(0.1, Math.min(10, newScale))

      // 计算鼠标相对于容器中心的位置
      const rect = container.getBoundingClientRect()
      const centerX = rect.width / 2
      const centerY = rect.height / 2
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      const mouseFromCenter = {
        x: mouseX - centerX,
        y: mouseY - centerY
      }

      // 计算新的偏移量，保持鼠标指向的图片点不动
      const k = newScale / currentScale

      const newPos = {
        x: mouseFromCenter.x * (1 - k) + currentPos.x * k,
        y: mouseFromCenter.y * (1 - k) + currentPos.y * k
      }

      // 更新目标状态
      targetScaleRef.current = newScale
      targetPositionRef.current = newPos

      // 启动平滑动画循环
      if (!animationFrameRef.current) {
        const loop = () => {
          const targetScale = targetScaleRef.current
          const targetPos = targetPositionRef.current
          const currentScale = imageScaleRef.current
          const currentPos = imagePositionRef.current

          // 线性插值 (Lerp) 实现平滑效果
          const factor = 0.3

          const nextScale = currentScale + (targetScale - currentScale) * factor
          const nextPos = {
            x: currentPos.x + (targetPos.x - currentPos.x) * factor,
            y: currentPos.y + (targetPos.y - currentPos.y) * factor
          }

          // 更新 Refs
          imageScaleRef.current = nextScale
          imagePositionRef.current = nextPos

          // 直接更新 DOM
          updateImageTransform()

          // 检查是否足够接近目标
          if (Math.abs(nextScale - targetScale) < 0.001 &&
            Math.abs(nextPos.x - targetPos.x) < 0.1 &&
            Math.abs(nextPos.y - targetPos.y) < 0.1) {
            imageScaleRef.current = targetScale
            imagePositionRef.current = targetPos
            updateImageTransform()
            animationFrameRef.current = null
          } else {
            animationFrameRef.current = requestAnimationFrame(loop)
          }
        }
        animationFrameRef.current = requestAnimationFrame(loop)
      }
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      container.removeEventListener('wheel', handleWheel)
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [isImageViewerOpen])

  // 键盘导航
  useEffect(() => {
    if (!isImageViewerOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        navigateImage('prev')
      } else if (e.key === 'ArrowRight') {
        navigateImage('next')
      } else if (e.key === 'Escape') {
        closeImageViewer()
      } else if (e.key === ' ') {
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isImageViewerOpen])

  // 视频播放器键盘控制
  useEffect(() => {
    if (!isVideoViewerOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeVideoViewer()
      } else if (e.key === ' ') {
        e.preventDefault()
        if (videoRef.current) {
          if (isVideoPlaying) videoRef.current.pause()
          else videoRef.current.play()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isVideoViewerOpen, isVideoPlaying])

  useEffect(() => {
    if (isVideoViewerOpen && autoPlayOnOpen && videoRef.current) {
      videoRef.current.play().catch(() => { })
      setAutoPlayOnOpen(false)
    }
  }, [isVideoViewerOpen, autoPlayOnOpen])

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume
  }, [volume])
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted
  }, [muted])
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate
  }, [playbackRate])
  useEffect(() => {
    if (videoRef.current) videoRef.current.loop = loop
  }, [loop])

  useEffect(() => {
    if (!isSpeedMenuOpen) return
    const handler = (e: MouseEvent) => {
      const d = speedDisplayRef.current
      const m = speedMenuRef.current
      const t = e.target as Node
      if (d && m && t && !d.contains(t) && !m.contains(t)) setIsSpeedMenuOpen(false)
    }
    document.addEventListener('click', handler)
    return () => { document.removeEventListener('click', handler) }
  }, [isSpeedMenuOpen])



  useEffect(() => {
    if (!isVideoViewerOpen) {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
      return
    }
    if (!isVideoPlaying) {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
      return
    }
    const tick = () => {
      const v = videoRef.current
      if (v) {
        const dur = v.duration || 0
        const cur = v.currentTime || 0
        setCurrentTime(cur)
        if (progressFillRef.current) {
          const percent = dur ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0
          progressFillRef.current.style.width = `${percent}%`
        }
      }
      rafIdRef.current = requestAnimationFrame(tick)
    }
    rafIdRef.current = requestAnimationFrame(tick)
    return () => { if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current) }
  }, [isVideoViewerOpen, isVideoPlaying])

  useEffect(() => {
    if (!isVideoViewerOpen && controlsHideTimer.current) {
      clearTimeout(controlsHideTimer.current)
      controlsHideTimer.current = null
      setIsControlsVisible(true)
    }
  }, [isVideoViewerOpen])

  // 视频播放器键盘快捷键
  useEffect(() => {
    if (!isVideoViewerOpen) return
    // 存储估算的帧间隔（默认1/30秒）
    let frameInterval = 1 / 30
    let lastMediaTime = 0
    let frameCount = 0

    // 尝试使用requestVideoFrameCallback估算帧率
    const v = videoRef.current
    if (v && 'requestVideoFrameCallback' in v) {
      const estimateFrameRate = (_: DOMHighResTimeStamp, metadata: { mediaTime: number }) => {
        if (lastMediaTime > 0 && metadata.mediaTime > lastMediaTime) {
          frameCount++
          if (frameCount >= 5) {
            // 取平均帧间隔
            frameInterval = (metadata.mediaTime - lastMediaTime) / frameCount
            frameCount = 0
            lastMediaTime = metadata.mediaTime
          }
        } else {
          lastMediaTime = metadata.mediaTime
        }
        if (isVideoViewerOpen) {
          (v as any).requestVideoFrameCallback(estimateFrameRate)
        }
      }
      (v as any).requestVideoFrameCallback(estimateFrameRate)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const v = videoRef.current
      if (!v) return
      // 左右方向键：快进/快退
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        // Ctrl或Cmd(Mac)时步进1帧，否则1秒
        const step = (e.ctrlKey || e.metaKey) ? frameInterval : 1
        const newTime = e.key === 'ArrowLeft'
          ? Math.max(0, v.currentTime - step)
          : Math.min(v.duration || 0, v.currentTime + step)
        v.currentTime = newTime
        setCurrentTime(newTime)
      }
      // 上下方向键：调整音量
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault()
        const step = 0.05 // 5%
        const newVolume = e.key === 'ArrowUp'
          ? Math.min(1, volume + step)
          : Math.max(0, volume - step)
        setMuted(false)
        setVolume(newVolume)
        // 显示音量指示器
        setShowVolumeIndicator(true)
        if (volumeIndicatorTimer.current) clearTimeout(volumeIndicatorTimer.current)
        volumeIndicatorTimer.current = window.setTimeout(() => setShowVolumeIndicator(false), 1000)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isVideoViewerOpen, volume])

  // 处理进度条拖动时的全局鼠标释放
  useEffect(() => {
    if (!isDraggingProgress) return
    const handleGlobalMouseUp = () => {
      setIsDraggingProgress(false)
    }
    window.addEventListener('mouseup', handleGlobalMouseUp)
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp)
    }
  }, [isDraggingProgress])

  const copyImageToClipboard = async (filePath?: string) => {
    console.log('[复制图片] 开始', { filePath, timestamp: performance.now() })

    if (!filePath) {
      showNotification('复制失败: 无法获取图片路径', 'error')
      return
    }

    try {
      const t1 = performance.now()
      console.log('[复制图片] 调用 Rust invoke 开始', { t1 })

      // 直接传递文件路径给 Rust，避免前端 fetch + IPC 传输大量数据
      await invoke('copy_image_to_clipboard', { filePath })

      const t2 = performance.now()
      console.log('[复制图片] Rust invoke 完成', { 耗时: `${(t2 - t1).toFixed(2)}ms` })

      // Windows WebView2 可能在剪贴板操作后不立即重绘
      // 使用最小延迟刷新事件循环并强制重绘
      await new Promise<void>(resolve => {
        setTimeout(() => {
          void document.body.offsetHeight
          resolve()
        }, 1)
      })

      const t3 = performance.now()
      console.log('[复制图片] 强制重绘完成', { 耗时: `${(t3 - t2).toFixed(2)}ms` })

      showNotification('复制成功', 'success')

      const t4 = performance.now()
      console.log('[复制图片] showNotification 调用完成', { 耗时: `${(t4 - t3).toFixed(2)}ms`, 总耗时: `${(t4 - t1).toFixed(2)}ms` })
    } catch (err) {
      logError('Copy failed:', err)
      setError('复制图片失败: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    if (notificationTimeoutRef.current) {
      clearTimeout(notificationTimeoutRef.current)
    }
    setNotification({ message, type })
    // 使用 setTimeout 确保在所有平台上都能立即显示
    // requestAnimationFrame 在 Windows 失去焦点时会暂停
    setTimeout(() => {
      setNotificationVisible(true)
    }, 0)

    notificationTimeoutRef.current = setTimeout(() => {
      setNotificationVisible(false)
      // 等待退出动画完成后清除数据
      setTimeout(() => {
        setNotification(null)
      }, 500)
    }, 3000)
  }

  // 处理媒体文件下载
  const handleDownloadMedia = async (filePath: string, fromButton: boolean = false) => {
    if (!filePath) {
      logError('', '[App] 下载失败: 文件路径为空')
      showNotification('下载失败: 文件路径无效', 'error')
      return
    }

    try {
      logInfo('[App] 开始下载:', { filePath, fromButton })

      const enableQuick = localStorage.getItem('enable_quick_download') === 'true'
      const buttonOnly = localStorage.getItem('quick_download_button_only') !== 'false' // 默认开启
      const quickPath = localStorage.getItem('quick_download_path') || ''

      logInfo('[App] 下载设置:', { enableQuick, buttonOnly, quickPath })

      // 判断是否使用快速下载
      const useQuickDownload = enableQuick && (!buttonOnly || fromButton) && quickPath

      logInfo('[App] 使用快速下载:', useQuickDownload)

      if (useQuickDownload) {
        logInfo('', '[App] 执行快速下载...')
        const savedPath = await quickDownloadMediaFile(filePath, quickPath)
        logInfo('[App] 快速下载完成:', savedPath)
        showNotification('下载成功', 'success')
      } else {
        logInfo('', '[App] 执行手动下载...')
        const savedPath = await downloadMediaFile(filePath)
        logInfo('[App] 手动下载完成:', savedPath)
        showNotification('下载成功', 'success')
      }
    } catch (err) {
      logError('[App] 下载失败:', err)

      // 如果用户取消了下载，不显示错误
      if (err instanceof Error && err.message === 'cancelled') {
        logInfo('', '[App] 用户取消了下载')
        return
      }

      // 显示错误信息
      const errorMessage = err instanceof Error ? err.message : '未知错误'
      showNotification('下载失败: ' + errorMessage, 'error')
    }
  }

  // 生成图片右键菜单项
  const getImageMenuItems = (_imageUrl: string, filePath?: string): MenuItem[] => [
    {
      id: 'copy-image',
      label: '复制图片',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      ),
      onClick: async () => await copyImageToClipboard(filePath),
      disabled: !filePath
    },
    {
      id: 'download-image',
      label: '下载图片',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      ),
      onClick: async () => {
        if (filePath) {
          // 右键菜单下载不是来自按钮，传递 false
          await handleDownloadMedia(filePath, false)
        }
      },
      disabled: !filePath
    }
  ]

  // 生成视频缩略图右键菜单项
  const getVideoThumbnailMenuItems = (filePath?: string): MenuItem[] => [
    {
      id: 'download-video',
      label: '下载视频',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      ),
      onClick: async () => {
        if (filePath) {
          // 右键菜单下载不是来自按钮，传递 false
          await handleDownloadMedia(filePath, false)
        }
      },
      disabled: !filePath
    }
  ]

  // 生成音频右键菜单项
  const getAudioMenuItems = (filePath?: string): MenuItem[] => [
    {
      id: 'download-audio',
      label: '下载音频',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      ),
      onClick: async () => {
        if (filePath) {
          // 右键菜单下载不是来自按钮，传递 false
          await handleDownloadMedia(filePath, false)
        }
      },
      disabled: !filePath
    }
  ]

  // 全局禁用默认右键菜单（但允许视频播放器使用原生菜单）
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      // 记录右键点击时间，用于防止触摸板双指右击后意外触发拖动
      lastContextMenuTimeRef.current = Date.now()

      const target = e.target as HTMLElement
      // 如果是视频播放器中的 video 元素，允许原生右键菜单
      if (target.tagName === 'VIDEO' && target.closest('.video-viewer')) {
        return
      }
      e.preventDefault()
    }
    document.addEventListener('contextmenu', handleContextMenu)
    return () => document.removeEventListener('contextmenu', handleContextMenu)
  }, [])


  // 判断位置是否在实际图片内容上（简化版本，直接使用transform后的坐标）
  const isPositionOnImageContent = (clientX: number, clientY: number): boolean => {
    const img = imageViewerRef.current
    if (!img || !img.naturalWidth || !img.naturalHeight) return false

    const rect = img.getBoundingClientRect()

    // 计算objectFit: contain下实际图片内容的显示区域（使用transform后的尺寸）
    const imgRatio = img.naturalWidth / img.naturalHeight
    const containerRatio = rect.width / rect.height

    let contentWidth: number, contentHeight: number, offsetX: number, offsetY: number
    if (imgRatio > containerRatio) {
      // 图片受宽度限制
      contentWidth = rect.width
      contentHeight = rect.width / imgRatio
      offsetX = 0
      offsetY = (rect.height - contentHeight) / 2
    } else {
      // 图片受高度限制
      contentHeight = rect.height
      contentWidth = rect.height * imgRatio
      offsetY = 0
      offsetX = (rect.width - contentWidth) / 2
    }

    // 获取点击位置相对于图片元素的坐标
    const clickX = clientX - rect.left
    const clickY = clientY - rect.top

    // 判断点击位置是否在实际图片内容区域内
    return (
      clickX >= offsetX &&
      clickX <= offsetX + contentWidth &&
      clickY >= offsetY &&
      clickY <= offsetY + contentHeight
    )
  }

  // 判断点击位置是否在实际图片内容上（React事件版本）
  const isClickOnImageContent = (e: React.MouseEvent<HTMLImageElement>): boolean => {
    return isPositionOnImageContent(e.clientX, e.clientY)
  }

  // 图片拖动开始
  const handleImageMouseDown = (e: React.MouseEvent<HTMLImageElement>) => {
    // 只响应左键点击
    if (e.button === 0) {
      // 检查是否点击在实际图片内容上
      if (!isClickOnImageContent(e)) {
        // 点击的是透明区域，不启动拖拽
        return
      }

      e.preventDefault()
      setIsDragging(true)
      dragStartRef.current = {
        x: e.clientX - imagePositionRef.current.x,
        y: e.clientY - imagePositionRef.current.y
      }
    }
  }

  // 图片拖动中
  const handleImageMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      const newPos = {
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y
      }
      imagePositionRef.current = newPos
      targetPositionRef.current = newPos // 同步目标位置，防止冲突
      updateImageTransform()
    }
  }

  // 图片拖动结束
  const handleImageMouseUp = () => {
    setIsDragging(false)
  }

  // 历史记录图片拖拽开始 (混合拖放：窗口内自定义预览 + 边缘触发原生拖放)
  const handleHistoryImageDragStart = async (e: React.MouseEvent, imageUrl: string, filePath?: string) => {
    // 只响应左键点击，防止右键菜单触发拖动
    if (e.button !== 0) return

    // 检查是否在右键点击冷却期内（500ms），防止触摸板双指右击产生的虚假 mousedown 事件
    // macOS 触摸板双指右击时，可能会在 contextmenu 事件后触发一个 button=0 的 mousedown
    const timeSinceContextMenu = Date.now() - lastContextMenuTimeRef.current
    if (timeSinceContextMenu < 500) {
      return  // 直接忽略这个 mousedown 事件
    }

    e.preventDefault()
    const initialX = e.clientX
    const initialY = e.clientY
    const mouseDownTime = Date.now()

    // 获取或创建图片缩略图（使用缓存系统）
    let thumbnailPath: string | undefined
    let previewDataUrl: string = imageUrl  // 默认使用原图 URL

    if (filePath) {
      try {
        const { getOrCreateImageThumbnail } = await import('../utils/imageConversion')
        const thumbnail = await getOrCreateImageThumbnail(filePath, imageUrl)
        thumbnailPath = thumbnail.filePath
        previewDataUrl = thumbnail.dataUrl
      } catch (err) {
        console.warn('[拖放] 获取图片缩略图失败:', err)
      }
    }

    // 使用内部自定义拖放 + 边缘检测触发原生拖放
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = Math.abs(moveEvent.clientX - initialX)
      const deltaY = Math.abs(moveEvent.clientY - initialY)
      const timeSinceMouseDown = Date.now() - mouseDownTime

      // 优化触控板体验：
      // 1. 增加距离阈值到 40px，避免轻微手指移动触发拖拽
      // 2. 要求按下时间超过 150ms，避免快速点击被误判为拖拽
      if ((deltaX > 40 || deltaY > 40) && timeSinceMouseDown > 150) {
        isDraggingRef.current = true
        // 启动自定义拖放，传入 filePath 和 thumbnailPath
        // DragDropContext 会在检测到边缘时自动触发原生拖放
        startDrag(
          {
            type: 'image',
            imageUrl,
            filePath,
            thumbnailPath,
            sourceType: 'history'
          },
          previewDataUrl  // 使用缓存的缩略图 Data URL
        )
        // Remove listeners after starting drag
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      // 立即重置拖拽标志，避免阻止点击事件
      // onClick 事件在 mouseup 之后触发，所以需要在下一个事件循环中重置
      requestAnimationFrame(() => {
        isDraggingRef.current = false
      })
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  // Handle image click - prevent if dragging occurred
  const handleHistoryImageClick = (url: string, imageUrls: string[], filePaths: string[] = []) => {
    if (isDraggingRef.current) {
      return // Don't open viewer if we just finished dragging
    }
    openImageViewer(url, imageUrls, filePaths)
  }

  // 历史记录视频拖拽开始 (混合拖放：窗口内自定义预览 + 边缘触发原生拖放)
  const handleHistoryVideoDragStart = async (e: React.MouseEvent, videoUrl: string, filePath?: string) => {
    // 只响应左键点击，防止右键菜单触发拖动
    if (e.button !== 0) return

    // 检查是否在右键点击冷却期内（500ms），防止触摸板双指右击产生的虚假 mousedown 事件
    // macOS 触摸板双指右击时，可能会在 contextmenu 事件后触发一个 button=0 的 mousedown
    const timeSinceContextMenu = Date.now() - lastContextMenuTimeRef.current
    if (timeSinceContextMenu < 500) {
      return  // 直接忽略这个 mousedown 事件
    }

    e.preventDefault()
    const initialX = e.clientX
    const initialY = e.clientY
    const mouseDownTime = Date.now()

    // 获取或创建视频缩略图（使用缓存系统）
    let thumbnailPath: string | undefined
    let previewDataUrl: string = videoUrl  // 默认使用视频 URL

    if (filePath) {
      try {
        const { getOrCreateVideoThumbnail } = await import('../utils/imageConversion')
        const thumbnail = await getOrCreateVideoThumbnail(filePath, videoUrl)
        thumbnailPath = thumbnail.filePath
        previewDataUrl = thumbnail.dataUrl
      } catch (err) {
        console.warn('[拖放] 获取视频缩略图失败:', err)
      }
    }

    // 使用内部自定义拖放 + 边缘检测触发原生拖放
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = Math.abs(moveEvent.clientX - initialX)
      const deltaY = Math.abs(moveEvent.clientY - initialY)
      const timeSinceMouseDown = Date.now() - mouseDownTime

      // 优化触控板体验：
      // 1. 增加距离阈值到 40px，避免轻微手指移动触发拖拽
      // 2. 要求按下时间超过 150ms，避免快速点击被误判为拖拽
      if ((deltaX > 40 || deltaY > 40) && timeSinceMouseDown > 150) {
        isDraggingRef.current = true
        startDrag(
          {
            type: 'video',
            imageUrl: videoUrl,
            filePath,
            thumbnailPath,
            sourceType: 'history'
          },
          previewDataUrl  // 使用 Data URL 作为预览（可以在 img 标签显示）
        )
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      // 立即重置拖拽标志，避免阻止点击事件
      // onClick 事件在 mouseup 之后触发，所以需要在下一个事件循环中重置
      requestAnimationFrame(() => {
        isDraggingRef.current = false
      })
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  // Handle video click - prevent if dragging occurred
  const handleHistoryVideoClick = (url: string, filePath?: string) => {
    if (isDraggingRef.current) {
      return // Don't open viewer if we just finished dragging
    }
    openVideoViewer(url, filePath)
  }


  // 独立的进度更新函数 - 不触发任务列表重新渲染
  const updateProgress = useCallback((taskId: string, progress: number) => {
    setTaskProgress(prev => {
      if (prev[taskId] === progress) return prev
      return { ...prev, [taskId]: progress }
    })
  }, [])

  // 优化的任务更新函数 - 只更新指定任务，避免整个数组重新渲染
  const updateTask = useCallback((taskId: string, updates: Partial<GenerationTask>) => {
    // 如果只是更新进度，使用独立的进度状态
    if (Object.keys(updates).length === 1 && 'progress' in updates) {
      updateProgress(taskId, updates.progress!)
      return
    }

    setTasks(prev => {
      const taskIndex = prev.findIndex(t => t.id === taskId)
      if (taskIndex === -1) return prev

      const newTasks = [...prev]
      newTasks[taskIndex] = { ...newTasks[taskIndex], ...updates }
      return newTasks
    })
  }, [updateProgress])

  // 执行单个任务
  const executeTask = async (taskId: string, task?: GenerationTask) => {
    setIsGenerating(true)

    try {
      let taskToExecute = task

      // 如果没有传入任务对象，尝试从状态中查找（注意：这在异步更新中可能不可靠，最好总是传入）
      if (!taskToExecute) {
        // 这里不能使用 setTasks 的副作用来获取，因为它是异步的
        // 我们只能依赖传入的 task 或者当前的 tasks 状态（如果是在事件循环的后续）
        taskToExecute = tasks.find(t => t.id === taskId)
      }

      if (!taskToExecute) {
        logError('[App] 找不到要执行的任务:', taskId)
        setIsGenerating(false) // 确保重置状态
        return
      }

      const { prompt: input, model, type, options: savedOptions } = taskToExecute

      // 重建 options（包含 images 等）
      const options = savedOptions ? { ...savedOptions } : {}

      // 如果任务有上传的文件路径，需要恢复 images 数据
      if (taskToExecute.uploadedFilePaths) {
        options.uploadedFilePaths = taskToExecute.uploadedFilePaths
      }
      if (taskToExecute.images) {
        options.images = taskToExecute.images
      }

      // 动态初始化适配器
      const providerObj = providers.find(p => p.models.some(m => m.id === model))
      if (providerObj) {
        const providerType = providerObj.id as 'ppio' | 'fal' | 'modelscope' | 'kie'

        // 获取对应的 API Key
        let apiKey = ''
        if (providerType === 'fal') {
          apiKey = localStorage.getItem('fal_api_key') || ''
        } else if (providerType === 'modelscope') {
          apiKey = localStorage.getItem('modelscope_api_key') || ''
        } else if (providerType === 'kie') {
          apiKey = localStorage.getItem('kie_api_key') || ''
        } else {
          apiKey = localStorage.getItem('ppio_api_key') || ''
        }

        if (!apiKey) {
          throw new Error(`请先在设置中配置 ${providerObj.name} 的 API Key`)
        }

        // 初始化对应的适配器
        apiService.setApiKey(apiKey)
        apiService.initializeAdapter({
          type: providerType,
          modelName: model
        })

        logInfo('[App] 已切换适配器:', { provider: providerType, model })
      }

      // 更新任务状态为生成中
      updateTask(taskId, { status: 'generating' })

      let result: any
      switch (type) {
        case 'image':
          // 为即梦4.0、bytedance-seedream-v4 添加基于时间的进度跟踪
          // 魔搭模型使用轮询进度，不需要基于时间的进度
          let progressTimer: number | null = null
          let lastUpdateTime = 0

          // 检查是否是魔搭模型
          const isModelscopeModel = providerObj?.id === 'modelscope'

          if ((model === 'seedream-4.0' || model === 'bytedance-seedream-v4') && !isModelscopeModel) {
            const startTime = Date.now()
            // 根据模型和图片数量动态计算预期时间
            let expectedDuration: number

            if (model === 'bytedance-seedream-v4') {
              // bytedance-seedream-v4: 基础时间 20 秒，每张图片增加 20 秒
              const numImages = options.numImages || 1
              const baseTime = 20000
              expectedDuration = baseTime * numImages
            } else {
              // seedream-4.0: 默认 20 秒
              expectedDuration = 20000
            }

            const updateProgressLoop = () => {
              const now = Date.now()
              const elapsed = now - startTime
              const progress = calculateProgress(elapsed, expectedDuration)

              // 使用独立的进度状态，不触发任务列表重新渲染
              updateProgress(taskId, progress)

              lastUpdateTime = now
              if (elapsed < expectedDuration) {
                progressTimer = requestAnimationFrame(updateProgressLoop)
              }
            }

            progressTimer = requestAnimationFrame(updateProgressLoop)
          }

          try {
            result = await apiService.generateImage(input, model, {
              ...options,
              onProgress: (status: any) => {
                // 【关键修复】如果收到 TASK_CREATED 状态，立即保存 taskId/requestId
                if (status.status === 'TASK_CREATED') {
                  if (status.taskId) {
                    logInfo('[App] 🆔 收到任务ID (图片-PPIO/KIE)，立即保存:', status.taskId)
                    updateTask(taskId, {
                      serverTaskId: status.taskId,
                      message: status.message || '任务已创建'
                    })
                  } else if (status.requestId && status.modelId) {
                    logInfo('[App] 🆔 收到请求ID (图片-Fal)，立即保存:', { requestId: status.requestId, modelId: status.modelId })
                    updateTask(taskId, {
                      requestId: status.requestId,
                      modelId: status.modelId,
                      message: status.message || '任务已创建'
                    })
                  }
                  return
                }

                const now = Date.now()
                // 限流：至少间隔 300ms 才更新一次
                if (now - lastUpdateTime < 300) return
                lastUpdateTime = now

                // 使用独立的进度状态
                updateProgress(taskId, status.progress || 0)

                // 只在有 message 时才更新任务状态
                if (status.message) {
                  updateTask(taskId, { message: status.message })
                }
              }
            })
          } finally {
            // 清除定时器
            if (progressTimer) {
              cancelAnimationFrame(progressTimer)
            }
          }

          // 检查是否为 fal 队列超时状态
          if (result?.status === 'timeout') {
            logInfo('[App] 检测到队列超时:', result)
            updateTask(taskId, {
              status: 'timeout',
              provider: providerObj?.id,
              requestId: result.requestId,
              modelId: result.modelId,
              message: result.message || '等待超时，任务依然在处理中'
            })
            return  // 提前返回，不继续处理
          }

          // 检查适配器是否已经处理了本地保存（通过 filePath 字段判断）
          logInfo('[App] 尝试本地保存，ua=', typeof navigator !== 'undefined' ? navigator.userAgent : '')
          if (result?.url && isDesktop() && !(result as any).filePath) {
            try {
              if (result.url.includes('|||')) {
                const urls = result.url.split('|||')
                const display = [] as string[]
                const paths = [] as string[]
                for (const u of urls) {
                  const { fullPath } = await saveImageFromUrl(u)
                  const blobSrc = await fileToBlobSrc(fullPath, 'image/png')
                  display.push(blobSrc)
                  paths.push(fullPath)
                }
                result.url = display.join('|||')
                  ; (result as any).filePath = paths.join('|||')
              } else {
                const { fullPath } = await saveImageFromUrl(result.url)
                const blobSrc = await fileToBlobSrc(fullPath, 'image/png')
                result.url = blobSrc
                  ; (result as any).filePath = fullPath
              }
              logInfo('', '[App] 本地保存成功并替换展示地址')
            } catch (e) {
              logError('[App] 本地保存失败，回退在线地址', e)
            }
          } else if ((result as any).filePath) {
            logInfo('', '[App] 适配器已处理本地保存，跳过重复保存')
          }
          break
        case 'video':
          let videoLastUpdateTime = 0
          logInfo('[App] 🎬 开始视频生成任务:', { taskId, model })

          result = await apiService.generateVideo(input, model, {
            ...options,
            onProgress: (status: any) => {
              const now = Date.now()

              // 【关键修复】如果收到 TASK_CREATED 状态，立即保存 taskId/requestId
              if (status.status === 'TASK_CREATED') {
                if (status.taskId) {
                  logInfo('[App] 🆔 收到任务ID (PPIO/KIE)，立即保存:', status.taskId)
                  updateTask(taskId, {
                    serverTaskId: status.taskId,
                    message: status.message || '任务已创建'
                  })
                } else if (status.requestId && status.modelId) {
                  logInfo('[App] 🆔 收到请求ID (Fal)，立即保存:', { requestId: status.requestId, modelId: status.modelId })
                  updateTask(taskId, {
                    requestId: status.requestId,
                    modelId: status.modelId,
                    message: status.message || '任务已创建'
                  })
                }
                return
              }

              // 限流：至少间隔 300ms 才更新一次
              if (now - videoLastUpdateTime < 300) return
              videoLastUpdateTime = now

              // 使用独立的进度状态
              updateProgress(taskId, status.progress || 0)

              // 只在有 message 时才更新任务状态
              if (status.message) {
                updateTask(taskId, { message: status.message })
              }
            }
          })

          logInfo('[App] 📦 视频生成 API 返回结果:', {
            hasResult: !!result,
            status: result?.status,
            taskId: result?.taskId,
            requestId: result?.requestId,
            modelId: result?.modelId,
            hasUrl: !!result?.url
          })

          // 【新增】检查是否为超时状态
          if (result?.status === 'timeout') {
            logInfo('[App] ⏱️ 检测到轮询超时，保存任务ID以便后续恢复:', {
              taskId: result.taskId,
              requestId: result.requestId,
              modelId: result.modelId
            })
            updateTask(taskId, {
              status: 'timeout',
              serverTaskId: result.taskId,  // 保存 taskId 用于后续重试
              requestId: result.requestId,  // 保存 requestId（Fal 使用）
              modelId: result.modelId,      // 保存 modelId（Fal 使用）
              message: result.message || '轮询超时，任务可能仍在处理中'
            })
            logInfo('[App] ✅ 超时任务已更新，serverTaskId:', result.taskId)
            return  // 提前返回，不继续处理
          }

          // 如果返回了 taskId 而非最终结果，说明需要 App 层轮询（向后兼容）
          if (result.taskId) {
            logInfo('[App] 💾 保存 serverTaskId 到任务对象:', result.taskId)
            updateTask(taskId, {
              serverTaskId: result.taskId,
              requestId: result.requestId,
              modelId: result.modelId
            })
            result = await pollTaskStatus(result.taskId, taskId, model)
          }
          break
        case 'audio':
          logInfo('[App] generateAudio 调用参数:', { input, model, options })
          result = await apiService.generateAudio(input, model, options)
          // 检查适配器是否已经处理了本地保存（通过 filePath 字段判断）
          if (result && result.url && isDesktop() && !(result as any).filePath) {
            try {
              const { fullPath } = await saveAudioFromUrl(result.url)
              const blobSrc = await fileToBlobSrc(fullPath, 'audio/mpeg')
              result.url = blobSrc
                ; (result as any).filePath = fullPath
              logInfo('', '[App] 本地保存成功并替换展示地址')
            } catch (e) {
              logError('[App] 本地保存失败，回退在线地址', e)
            }
          } else if ((result as any).filePath) {
            logInfo('', '[App] 适配器已处理本地保存，跳过重复保存')
          }
          break
        default:
          throw new Error('Unsupported media type')
      }

      // 更新任务状态为成功
      if (result && result.url) {
        // 获取实际媒体尺寸和时长
        let dimensions: string | null = null
        let duration: string | null = null
        try {
          const urlToCheck = (result as any).filePath || result.url
          // 如果包含多个 URL（用 ||| 分隔），只取第一个
          const firstUrl = urlToCheck.includes('|||') ? urlToCheck.split('|||')[0] : urlToCheck
          dimensions = await getMediaDimensions(firstUrl, type)
          duration = await getMediaDurationFormatted(firstUrl, type)
          logInfo('[App] 获取媒体信息:', { dimensions, duration })
        } catch (error) {
          logError('[App] 获取媒体信息失败:', error)
        }

        updateTask(taskId, {
          status: 'success',
          progress: 100,
          dimensions: dimensions || undefined,
          duration: duration || undefined,
          result: {
            id: taskId,
            type,
            url: result.url,
            filePath: (result as any).filePath,
            prompt: input,
            createdAt: new Date()
          }
        })
      }
    } catch (err) {
      logError('[App] 生成失败:', err)
      // 更新任务状态为错误
      updateTask(taskId, {
        status: 'error',
        error: err instanceof Error ? err.message : '生成失败'
      })
    } finally {
      // 任务结束状态由 TaskQueueManager 的 onComplete/onError 处理
      // 这里只需要做资源清理
    }
  }

  const handleGenerate = async (input: string, model: string, type: 'image' | 'video' | 'audio', options?: any) => {
    // 【延迟保存逻辑】处理 options.images 中的 Base64 图片
    // 在生成前将编辑好的图片保存为文件，并更新 editState
    if (options && options.images && options.images.length > 0) {
      if (!options.uploadedFilePaths) options.uploadedFilePaths = new Array(options.images.length).fill('')

      const newImages = [...options.images]
      const newFilePaths = [...(options.uploadedFilePaths || [])]
      let hasChanges = false

      for (let i = 0; i < newImages.length; i++) {
        const img = newImages[i]

        // 如果是 Base64，说明是新编辑的图片（延迟保存）
        if (img.startsWith('data:')) {
          logInfo('[App] Saving delayed edited image (auto-compressed to JPEG):', { index: i })
          try {
            // 1. Convert PNG to JPEG and save (compressed)
            const blob = await dataUrlToBlob(img)
            const jpegBytes = await ensureCompressedJpegBytesWithPica(blob)
            const savedEdited = await saveBytesToUploads(jpegBytes, 'image/jpeg')
            const editedDisplaySrc = savedEdited.displaySrc

            // 2. 获取并更新编辑状态
            const editState = imageEditStatesRef.current.get(img) // 使用 base64 key 查找
            if (editState) {
              // 检查原图是否需要保存 (Fix Issue 2: Original Image Loss)
              let finalOriginalSrc = editState.originalSrc
              if (finalOriginalSrc && finalOriginalSrc.startsWith('data:')) {
                const savedOrg = await saveBase64ToUploads(finalOriginalSrc)
                finalOriginalSrc = savedOrg.displaySrc
                logInfo('[App] Saved delayed original image:', savedOrg.fullPath)
              }

              // 更新 state 对象 (Fix Issue 1: Base64 Bloat)
              const newEditState: ImageEditState = {
                ...editState,
                imageId: savedEdited.relativePath, // 使用相对路径作为 ID
                originalSrc: finalOriginalSrc
              }

              // 更新 ref 中的存储 (移除旧 key，添加新 key)
              imageEditStatesRef.current.delete(img)
              imageEditStatesRef.current.set(editedDisplaySrc, newEditState)

              logInfo('[App] Updated EditState for saved image', { imageId: newEditState.imageId })
            }

            // 3. 更新 images 和 filePaths
            newImages[i] = editedDisplaySrc
            newFilePaths[i] = savedEdited.fullPath
            hasChanges = true

          } catch (e) {
            logError('[App] Failed to save delayed image:', e)
          }
        }
      }

      if (hasChanges) {
        options.images = newImages
        options.uploadedFilePaths = newFilePaths

        // 同步回 MediaGenerator 保持 UI 一致
        if (setUploadedImagesRef.current) setUploadedImagesRef.current(newImages)
        if (setUploadedFilePathsRef.current) setUploadedFilePathsRef.current(newFilePaths)
      }
    }
    if (!input.trim() && (!options || !options.images || options.images.length === 0)) {
      setError('请输入内容或上传图片')
      return
    }

    // 测试模式拦截
    if (shouldSkipRequest()) {
      logRequestParams({
        input,
        model,
        type,
        options,
        timestamp: new Date().toISOString()
      })

      // 显示测试模式提示
      setNotification({ message: '测试模式：已拦截请求，参数已输出到控制台', type: 'success' })
      setNotificationVisible(true)

      return // 不继续执行实际的生成逻辑
    }

    // 查找供应商信息
    const providerObj = providers.find(p => p.models.some(m => m.id === model))
    const providerId = providerObj?.id

    // 创建新的生成任务
    const taskId = Date.now().toString()

    // 【关键修复】视频缩略图应该使用视频文件 URL，而不是 base64 缩略图
    // <video> 标签需要视频文件 URL 才能正确渲染第一帧作为缩略图
    let videoUrls: string[] | undefined = undefined
    if (options?.uploadedVideoFilePaths && options.uploadedVideoFilePaths.length > 0) {
      videoUrls = options.uploadedVideoFilePaths.map((p: string) => convertFileSrc(p))
    } else if (options?.uploadedVideos && options.uploadedVideos.length > 0) {
      // 如果没有文件路径，但有上传的视频缩略图，使用缩略图
      videoUrls = options.uploadedVideos
    }

    // 收集编辑状态（使用索引作为 Key，因为 URL 可能会变）
    const imageEditStates = options?.images?.reduce((acc: any, url: string, index: number) => {
      const state = imageEditStatesRef.current.get(url)
      if (state) {
        acc[index] = state // 使用索引作为 Key
      }
      return acc
    }, {})

    // 如果有编辑状态，保存到文件（懒加载优化）
    let editStateFile: string | undefined = undefined
    if (imageEditStates && Object.keys(imageEditStates).length > 0) {
      try {
        // 使用 taskId 作为文件名
        editStateFile = await saveEditState(taskId, imageEditStates)
        logInfo('[App] 已保存编辑状态到文件', editStateFile)
      } catch (e) {
        logError('[App] 保存编辑状态文件失败', e)
      }
    }

    const newTask: GenerationTask = {
      id: taskId,
      type,
      prompt: input,
      model,  // 保存模型信息
      provider: providerId, // 保存供应商信息
      images: options?.images,
      videos: videoUrls,  // 使用视频文件 URL（可播放），而不是 base64 缩略图
      // 不设置 size 字段，等生成完成后从实际文件中提取真实尺寸
      // size: options?.size,
      uploadedFilePaths: options?.uploadedFilePaths,
      uploadedVideoFilePaths: options?.uploadedVideoFilePaths,  // 保存视频文件路径
      status: isGenerating ? 'queued' : 'pending', // 如果正在生成，则排队
      progress: 0,
      options: {
        ...options,
        // 记录编辑状态文件名（不再直接保存 imageEditStates 对象）
        editStateFile
      }, // 保存完整参数（任务执行时需要）
    }

    // 立即添加到任务列表（最新的在最后）
    if (options?.uploadedFilePaths) {
      logInfo('[App] handleGenerate - uploadedFilePaths:', options.uploadedFilePaths)
    } else {
      logInfo('[App] handleGenerate - No uploadedFilePaths in options', '')
    }
    setTasks(prev => [...prev, newTask])
    setError(null)


    // 将任务放入队列管理器，由管理器调度执行
    // 获取当前状态，如果是新创建的任务或者是重试/继续查询，状态都设为 queued
    const isRunning = taskQueueManager.enqueue({
      id: taskId,
      execute: async () => {
        setIsGenerating(true)
        updateTask(taskId, { status: 'generating' })
        try {
          await executeTask(taskId, newTask)
        } finally {
          // 任务结束（无论成功失败），检查是否还有其他任务在运行
          const runningCount = taskQueueManager.getRunningCount()
          // 注意：这里 getRunningCount 包含了当前即将结束的此任务（因为是在 onComplete 回调之前执行的 execute 内容）
          // 实际上我们应该检查是否已是最后一个运行的任务
          if (runningCount <= 1) {
            setIsGenerating(false)
          }
        }
      },
      onStart: () => {
        // 任务开始时的回调
        setIsGenerating(true)
      },
      onComplete: () => {
        // 单个任务完成时的回调
        const runningCount = taskQueueManager.getRunningCount()
        if (runningCount === 0) {
          setIsGenerating(false)
        }
      },
      onError: (err) => {
        logError('[App] Queue task error:', err)
        const runningCount = taskQueueManager.getRunningCount()
        if (runningCount === 0) {
          setIsGenerating(false)
        }
      }
    })

    if (!isRunning) {
      logInfo('[App] 任务已加入排队:', taskId)
    } else {
      logInfo('[App] 任务立即开始执行:', taskId)
    }
  }

  const pollTaskStatus = async (serverTaskId: string, uiTaskId: string, _model?: string): Promise<any> => {
    logInfo('[App] 开始轮询任务状态:', serverTaskId)
    return new Promise((resolve, reject) => {
      let pollCount = 0
      const maxPolls = 120

      const interval = setInterval(async () => {
        try {
          pollCount++
          logInfo(`[App] 第${pollCount}次轮询任务状态:`, serverTaskId)

          const status = await apiService.checkTaskStatus(serverTaskId)

          // 注意：API返回的是 TASK_STATUS_SUCCEED，不是 TASK_STATUS_SUCCEEDED
          if ((status.status === 'TASK_STATUS_SUCCEEDED' || status.status === 'TASK_STATUS_SUCCEED') && status.result) {
            logInfo('[App] 任务完成:', status.result)
            clearInterval(interval)
            updateTask(uiTaskId, { progress: 100, timedOut: false })
            resolve(status.result)
          } else if (status.status === 'TASK_STATUS_FAILED') {
            logError('', '[App] 任务失败')
            clearInterval(interval)
            reject(new Error('任务执行失败'))
          } else if (pollCount >= maxPolls) {
            if (status.status === 'TASK_STATUS_PROCESSING' || status.status === 'TASK_STATUS_QUEUED') {
              logWarning('', '[App] 轮询超时，仍在处理中，提供重试')
              clearInterval(interval)
              updateTask(uiTaskId, { timedOut: true })
              resolve(null)
            } else {
              logError('', '[App] 轮询超时')
              clearInterval(interval)
              reject(new Error('任务超时'))
            }
          } else {
            logInfo('[App] 任务进行中...', {
              status: status.status,
              progress: status.progress
            })
            // 计算进度（vidu-q1 和其他模型使用相同逻辑）
            const t = pollCount / maxPolls
            const stepProgress = Math.round(95 * (1 - Math.pow(1 - t, 3)))

            // 使用独立的进度状态
            const currentProgress = taskProgress[uiTaskId] ?? 0
            const inc = Math.max(1, stepProgress)
            const next = Math.min(95, Math.max(currentProgress + 1, inc))
            updateProgress(uiTaskId, next)
          }
        } catch (err) {
          logError('[App] 轮询错误:', err)
          clearInterval(interval)
          reject(err)
        }
      }, 3000)
    })
  }

  const retryPolling = async (task: GenerationTask) => {
    if (!task.serverTaskId) {
      logError('', '[App] 无 serverTaskId，无法重试轮询')
      return
    }
    updateTask(task.id, { timedOut: false, status: 'generating' })
    try {
      const result = await pollTaskStatus(task.serverTaskId, task.id, task.model)
      if (result && result.url) {
        // 获取实际媒体尺寸和时长
        let dimensions: string | null = null
        let duration: string | null = null
        try {
          const urlToCheck = (result as any).filePath || result.url
          // 如果包含多个 URL（用 ||| 分隔），只取第一个
          const firstUrl = urlToCheck.includes('|||') ? urlToCheck.split('|||')[0] : urlToCheck
          dimensions = await getMediaDimensions(firstUrl, task.type)
          duration = await getMediaDurationFormatted(firstUrl, task.type)
          logInfo('[App] 获取媒体信息:', { dimensions, duration })
        } catch (error) {
          logError('[App] 获取媒体信息失败:', error)
        }

        updateTask(task.id, {
          status: 'success',
          progress: 100,
          dimensions: dimensions || undefined,
          duration: duration || undefined,
          result: {
            id: task.id,
            type: 'video',
            url: result.url,
            filePath: (result as any).filePath,
            prompt: task.prompt,
            createdAt: new Date()
          }
        })
      }
    } catch (e) {
      logError('[App] 重试轮询失败', e)
    }
  }

  const openSettings = () => {
    setIsSettingsOpen(true)
  }

  const closeSettings = () => {
    setIsSettingsOpen(false)
  }

  const openImageViewer = (imageUrl: string, imageList?: string[], filePaths?: string[], fromUpload: boolean = false) => {
    if (imageList && imageList.length > 0) {
      setCurrentImageList(imageList)
      setCurrentImageIndex(imageList.indexOf(imageUrl))
    } else {
      setCurrentImageList([imageUrl])
      setCurrentImageIndex(0)
    }
    if (filePaths && filePaths.length > 0) {
      setCurrentFilePathList(filePaths)
    } else {
      setCurrentFilePathList([])
    }
    setCurrentImage(imageUrl)
    setIsFromUploadArea(fromUpload)  // 设置图片来源

    // 重置缩放和位置
    imageScaleRef.current = 1
    imagePositionRef.current = { x: 0, y: 0 }
    targetScaleRef.current = 1
    targetPositionRef.current = { x: 0, y: 0 }

    setIsImageViewerOpen(true)
    setViewerOpacity(0)
    // 禁止后面页面滚动
    document.body.style.overflow = 'hidden'
  }

  const closeImageViewer = () => {
    setViewerOpacity(0)
    setTimeout(() => {
      setIsImageViewerOpen(false)
      setIsEditorMode(false)
      document.body.style.overflow = ''
    }, 400)
  }

  const openVideoViewer = (url: string, filePath?: string) => {
    setCurrentVideoUrl(url)
    setCurrentVideoPath(filePath || '')
    setIsVideoViewerOpen(true)
    setIsVideoPlaying(false)
    setCurrentTime(0)
    setVideoDuration(0)
    setVolume(1)
    setMuted(false)
    setPlaybackRate(1)
    setLoop(false)
    setVideoViewerOpacity(0)
    setAutoPlayOnOpen(true)
    document.body.style.overflow = 'hidden'
  }

  const closeVideoViewer = () => {
    setVideoViewerOpacity(0)
    if (videoRef.current) {
      try { videoRef.current.pause() } catch { }
    }
    setAutoPlayOnOpen(false)
    setTimeout(() => {
      setIsVideoViewerOpen(false)
      document.body.style.overflow = ''
    }, 200)
  }

  const navigateImage = (direction: 'prev' | 'next') => {
    if (currentImageList.length === 0) return

    let newIndex = currentImageIndex
    if (direction === 'prev') {
      newIndex = currentImageIndex > 0 ? currentImageIndex - 1 : currentImageList.length - 1
    } else {
      newIndex = currentImageIndex < currentImageList.length - 1 ? currentImageIndex + 1 : 0
    }

    // 切换图片并重置缩放和位置
    setCurrentImageIndex(newIndex)
    setCurrentImage(currentImageList[newIndex])

    // 重置缩放和位置，实际的缩放会在图片的onLoad事件中计算
    imageScaleRef.current = 1
    imagePositionRef.current = { x: 0, y: 0 }
    targetScaleRef.current = 1
    targetPositionRef.current = { x: 0, y: 0 }
  }

  // 重置图片视图到适应窗口大小
  const resetImageView = () => {
    const img = imageViewerRef.current
    if (!img) return

    // 重新计算CSS缩放比例并重置transform缩放为1
    if (img.naturalWidth && img.naturalHeight && img.offsetWidth && img.offsetHeight) {
      // 计算objectFit: contain下的实际显示尺寸
      const naturalRatio = img.naturalWidth / img.naturalHeight
      const layoutRatio = img.offsetWidth / img.offsetHeight

      let actualDisplayWidth
      if (naturalRatio > layoutRatio) {
        // 图片受宽度限制
        actualDisplayWidth = img.offsetWidth
      } else {
        // 图片受高度限制
        actualDisplayWidth = img.offsetHeight * naturalRatio
      }

      const cssScale = actualDisplayWidth / img.naturalWidth
      cssScaleRef.current = cssScale
      // 重置transform缩放为1（相对于布局尺寸）
      imageScaleRef.current = 1
      targetScaleRef.current = 1
      imagePositionRef.current = { x: 0, y: 0 }
      targetPositionRef.current = { x: 0, y: 0 }
      updateImageTransform()
    }
  }

  const downloadVideo = async (videoUrl: string) => {
    try {
      if (currentVideoPath) {
        await downloadMediaFile(currentVideoPath)
      } else {
        const response = await fetch(videoUrl)
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `video-${Date.now()}.mp4`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        window.URL.revokeObjectURL(url)
      }
    } catch (err) {
      logError('Video download failed', err)
    }
  }

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec < 10 ? '0' : ''}${sec}`
  }

  // 加载历史（优先文件，其次本地存储）
  useEffect(() => {
    const load = async () => {
      const fileHistory = isDesktop() ? await readJsonFromAppData<any[]>('history.json') : null
      const store = fileHistory ?? (() => { try { return JSON.parse(localStorage.getItem('generationTasks') || '[]') } catch { return [] } })()

      const dataRoot = isDesktop() ? await getDataRoot() : ''

      const loaded = await Promise.all((store || []).map(async (task: any) => {
        let result = task.result
        if (result && result.filePath && isDesktop()) {
          try {
            // 将相对路径转换为绝对路径
            const absoluteFilePath = await convertPathString(result.filePath, dataRoot, false)
            if (absoluteFilePath) {
              if (typeof absoluteFilePath === 'string' && absoluteFilePath.includes('|||')) {
                const paths = absoluteFilePath.split('|||')
                const display = paths.map((p: string) => convertFileSrc(p)).join('|||')
                result = { ...result, filePath: absoluteFilePath, url: display }
              } else {
                result = { ...result, filePath: absoluteFilePath, url: convertFileSrc(absoluteFilePath) }
              }
            }
          } catch { }
        }

        let images = task.images
        if ((!images || images.length === 0) && task.uploadedFilePaths && task.uploadedFilePaths.length && isDesktop()) {
          try {
            // 将相对路径转换为绝对路径
            const absolutePaths = await convertPathArray(task.uploadedFilePaths, dataRoot, false)
            if (absolutePaths) {
              images = absolutePaths.map((p: string) => convertFileSrc(p))
              // 更新 task.uploadedFilePaths 为绝对路径
              task.uploadedFilePaths = absolutePaths
            }
          } catch { }
        }

        // 恢复视频缩略图（从 uploadedVideoFilePaths 生成）
        let videos: string[] | undefined = undefined
        if (task.uploadedVideoFilePaths && task.uploadedVideoFilePaths.length && isDesktop()) {
          try {
            // 将相对路径转换为绝对路径
            const absolutePaths = await convertPathArray(task.uploadedVideoFilePaths, dataRoot, false)
            if (absolutePaths) {
              videos = absolutePaths.map((p: string) => convertFileSrc(p))
              // 更新 task.uploadedVideoFilePaths 为绝对路径
              task.uploadedVideoFilePaths = absolutePaths
            }
          } catch { }
        }

        return {
          ...task,
          ...(images && { images }),  // 只有当 images 存在时才覆盖
          ...(videos && { videos }),  // 只有当 videos 存在时才添加
          dimensions: task.dimensions, // 恢复实际媒体尺寸
          duration: task.duration, // 恢复实际媒体时长
          status: (task.status === 'generating' || task.status === 'pending' || task.status === 'queued')
            ? ((task.serverTaskId || (task.requestId && task.modelId)) ? 'timeout' : 'error')
            : task.status,
          error: (task.status === 'generating' || task.status === 'pending' || task.status === 'queued')
            ? ((task.serverTaskId || (task.requestId && task.modelId)) ? undefined : '页面刷新后生成中断')
            : task.error,
          message: (task.status === 'generating' || task.status === 'pending' || task.status === 'queued') && (task.serverTaskId || (task.requestId && task.modelId))
            ? '页面刷新导致中断，请点击继续查询'
            : task.message,
          result: result ? { ...result, createdAt: result.createdAt ? new Date(result.createdAt) : new Date() } : undefined,
          images
        }
      }))

      // 【诊断日志】记录加载的任务信息
      const videoTasks = loaded.filter(t => t.type === 'video')
      const generatingTasks = videoTasks.filter(t => t.status === 'generating' || t.status === 'pending' || t.status === 'queued')
      const timeoutTasks = videoTasks.filter(t => t.status === 'timeout')

      logInfo('[App] 📂 从历史记录加载任务:', {
        totalTasks: loaded.length,
        videoTasks: videoTasks.length,
        generatingTasks: generatingTasks.length,
        timeoutTasks: timeoutTasks.length
      })

      // 【诊断日志】详细记录每个生成中/超时的视频任务
      generatingTasks.forEach(t => {
        logInfo('[App] 🔄 发现生成中的任务:', {
          id: t.id,
          originalStatus: (store.find((h: any) => h.id === t.id) as any)?.status,
          serverTaskId: t.serverTaskId,
          requestId: t.requestId,
          modelId: t.modelId,
          willConvertToTimeout: !!(t.serverTaskId || (t.requestId && t.modelId)),
          newStatus: t.status
        })
      })

      timeoutTasks.forEach(t => {
        logInfo('[App] ⏱️ 发现超时任务:', {
          id: t.id,
          serverTaskId: t.serverTaskId,
          requestId: t.requestId,
          modelId: t.modelId,
          message: t.message
        })
      })

      setTasks(loaded)
      setIsTasksLoaded(true)
    }
    load()
  }, [])

  useEffect(() => {
    if (isTasksLoaded && tasks.length > 0) {
      finalizeInitialScroll()
    }
  }, [isTasksLoaded])

  // 监听打开视频查看器的事件（来自 MediaGenerator）
  useEffect(() => {
    const handleOpenVideoViewer = (event: CustomEvent) => {
      const { url, filePath } = event.detail
      openVideoViewer(url, filePath)
    }

    window.addEventListener('open-video-viewer', handleOpenVideoViewer as EventListener)
    return () => {
      window.removeEventListener('open-video-viewer', handleOpenVideoViewer as EventListener)
    }
  }, [])

  // 保存历史到文件（避免本地存储配额）
  // 重要：只保存 filePath，不保存 url 字段，防止 base64 数据膨胀 history.json
  useEffect(() => {
    if (!isTasksLoaded) return
    if (!isDesktop()) return

    const saveHistory = async () => {
      const dataRoot = await getDataRoot()
      const filteredTasks = tasks.filter(t => t.status === 'success' || t.status === 'error' || t.status === 'timeout' || t.status === 'pending' || t.status === 'generating')

      const tasksToSave = await Promise.all(filteredTasks.map(async t => {
        // 清理 options 中的 base64 数据，防止 history.json 膨胀
        const sanitizedOptions = t.options ? { ...t.options } : undefined
        if (sanitizedOptions) {
          // 1. 删除已知的包含 base64 数据的字段（黑名单，性能优化）
          delete sanitizedOptions.images
          delete sanitizedOptions.image_url
          delete sanitizedOptions.uploadedImages
          delete sanitizedOptions.videos
          delete sanitizedOptions.video_url
          delete sanitizedOptions.uploadedVideos
          delete sanitizedOptions.image_input  // KIE 模型的图片 URL 数组

          // Seedream 4.5 specific cleanup
          if (sanitizedOptions.sequential_image_generation_options) {
            // Deep clean nested options if necessary, but sequential_image_generation_options typically contains numbers
          }

          // 2. 自动检测并删除其他可能包含 base64 数据的字段（兜底保护）
          // 这样添加新模型时不需要手动更新清理代码
          const safeFields = new Set([
            'uploadedFilePaths', 'uploadedVideoFilePaths', // 文件路径字段（需要保留）
            'prompt', 'model', 'size', 'duration', 'aspectRatio', 'resolution', // 基础参数
            'seed', 'guidanceScale', 'numInferenceSteps', 'negativePrompt', // 生成参数
            'hailuoVersion', 'hailuoFastMode', 'hailuoResolution', 'hailuo02Version', 'hailuo02FastMode', 'hailuo02Resolution', // Hailuo 参数
            'prompt_optimizer', 'falNanoBananaNumImages', 'falNanoBananaAspectRatio', // 其他模型参数
            'mode', 'veoAspectRatio', 'veoResolution', 'veoEnhancePrompt', 'veoGenerateAudio', 'veoAutoFix', 'fastMode', // Veo 参数
            'seedanceMode', 'seedanceVersion', 'seedanceAspectRatio', 'videoDuration', 'seedanceResolution', 'seedanceCameraFixed', 'seedanceFastMode', // Seedance 参数
            'soraMode', 'soraAspectRatio', 'soraResolution', // Sora 参数
            'ltxResolution', 'ltxFps', 'ltxGenerateAudio', 'ltxFastMode', 'ltxRetakeStartTime', 'ltxRetakeMode', // LTX 参数
            'viduQ2Mode', 'falViduQ2VideoDuration', 'viduQ2AspectRatio', 'viduQ2Resolution', 'viduQ2MovementAmplitude', 'viduQ2Bgm', 'viduQ2FastMode', // Vidu 参数
            'falPixverse55VideoDuration', 'pixverseAspectRatio', 'pixverseResolution', 'pixverseStyle', 'pixverseThinkingType', 'pixverseGenerateAudio', 'pixverseMultiClip', // Pixverse 参数
            'wanAspectRatio', 'wanResolution', 'wanPromptExpansion', // Wan 参数
            'klingV26CfgScale', 'klingV26GenerateAudio', 'aspectRatio', 'keepAudio', 'elements', // Kling 参数
            'customWidth', 'customHeight', 'selectedResolution', 'resolutionQuality', 'imageSize', // 分辨率参数
            'falZImageTurboNumInferenceSteps', 'falZImageTurboEnablePromptExpansion', 'falZImageTurboAcceleration', 'falZImageTurboImageSize', // Z-Image 参数
            'num_images', 'aspect_ratio', 'enable_safety_checker', 'negative_prompt', 'video_negative_prompt', 'videoNegativePrompt', // 通用参数
            'falSeedream40NumImages', 'falKlingImageO1NumImages', 'falKlingImageO1AspectRatio', // 其他图片模型参数
            'falKlingVideoO1Mode', 'falKlingVideoO1VideoDuration', 'falKlingVideoO1AspectRatio', 'falKlingVideoO1KeepAudio', 'falKlingVideoO1Elements', // Kling Video O1 参数
            'falKlingV26ProVideoDuration', 'falKlingV26ProAspectRatio', 'falKlingV26ProCfgScale', 'falKlingV26ProGenerateAudio', // Kling V2.6 Pro 参数
            'falSora2Mode', 'falSora2VideoDuration', 'falSora2AspectRatio', 'falSora2Resolution', // Sora 2 参数
            'falLtx2Mode', 'falLtx2RetakeDuration', 'falLtx2VideoDuration', 'falLtx2Resolution', 'falLtx2Fps', 'falLtx2GenerateAudio', 'falLtx2FastMode', 'falLtx2RetakeStartTime', 'falLtx2RetakeMode', // LTX 2 参数
            'falViduQ2Mode', 'falViduQ2VideoDuration', 'falViduQ2AspectRatio', 'falViduQ2Resolution', 'falViduQ2MovementAmplitude', 'falViduQ2Bgm', 'falViduQ2FastMode', // Vidu Q2 参数
            'falPixverse55VideoDuration', 'falPixverse55AspectRatio', 'falPixverse55Resolution', 'falPixverse55Style', 'falPixverse55ThinkingType', 'falPixverse55GenerateAudio', 'falPixverse55MultiClip', // Pixverse V5.5 参数
            'falWan25VideoDuration', 'falWan25AspectRatio', 'falWan25Resolution', 'falWan25PromptExpansion', // Wan 2.5 参数
            'falHailuo23Duration', 'falHailuo23PromptOptimizer', 'falHailuo23Resolution', 'falHailuo23FastMode', // Hailuo 2.3 参数
            'falHailuo02Duration', 'falHailuo02PromptOptimizer', 'falHailuo02Resolution', 'falHailuo02FastMode', // Hailuo 02 参数
            'falSeedanceV1Mode', 'falSeedanceV1Version', 'ppioSeedanceV1AspectRatio', 'falSeedanceV1VideoDuration', 'ppioSeedanceV1Resolution', 'ppioSeedanceV1CameraFixed', 'falSeedanceV1FastMode', // Seedance V1 参数
            'falVeo31Mode', 'falVeo31VideoDuration', 'falVeo31AspectRatio', 'falVeo31Resolution', 'falVeo31EnhancePrompt', 'falVeo31GenerateAudio', 'falVeo31AutoFix', 'falVeo31FastMode', // Veo 3.1 参数
            'numImages', 'num_inference_steps', 'guidance_scale' // 其他通用参数
          ])

          for (const key in sanitizedOptions) {
            if (safeFields.has(key)) continue // 跳过安全字段

            const value = sanitizedOptions[key]
            // 检测是否为 base64 数据：
            // 1. 字符串类型
            // 2. 以 data: 开头（data URI）
            // 3. 或者长度超过 1000 字符（可能是 base64 字符串）
            if (typeof value === 'string' && (value.startsWith('data:') || value.length > 1000)) {
              logWarning('', `[History] 自动删除疑似 base64 数据字段: ${key} (长度: ${value.length})`)
              delete sanitizedOptions[key]
            }
            // 检测数组中是否包含 base64 数据
            else if (Array.isArray(value) && value.length > 0) {
              const firstItem = value[0]
              if (typeof firstItem === 'string' && (firstItem.startsWith('data:') || firstItem.length > 1000)) {
                logWarning('', `[History] 自动删除疑似 base64 数据数组字段: ${key} (数组长度: ${value.length})`)
                delete sanitizedOptions[key]
              }
            }
          }

          // 转换 options 中的路径为相对路径
          if (sanitizedOptions.uploadedFilePaths) {
            sanitizedOptions.uploadedFilePaths = await convertPathArray(sanitizedOptions.uploadedFilePaths, dataRoot, true)
          }
          if (sanitizedOptions.uploadedVideoFilePaths) {
            sanitizedOptions.uploadedVideoFilePaths = await convertPathArray(sanitizedOptions.uploadedVideoFilePaths, dataRoot, true)
          }
        }

        // 转换路径为相对路径
        const relativeUploadedFilePaths = await convertPathArray(t.uploadedFilePaths, dataRoot, true)
        const relativeUploadedVideoFilePaths = await convertPathArray(t.uploadedVideoFilePaths, dataRoot, true)
        const relativeResultFilePath = t.result?.filePath ? await convertPathString(t.result.filePath, dataRoot, true) : undefined

        const taskToSave = {
          id: t.id,
          type: t.type,
          prompt: t.prompt,
          model: t.model,
          provider: t.provider, // 保存供应商信息
          // images: t.images, // 移除：不再直接保存 base64 图片数据，依赖 uploadedFilePaths 恢复
          videos: t.videos, // 保存上传的视频缩略图（用于历史记录显示）
          size: t.size,
          dimensions: t.dimensions, // 保存实际媒体尺寸
          duration: t.duration, // 保存实际媒体时长
          status: t.status,
          error: t.error,
          uploadedFilePaths: relativeUploadedFilePaths,
          uploadedVideoFilePaths: relativeUploadedVideoFilePaths,  // 保存视频文件路径（相对路径）
          options: sanitizedOptions, // 保存清理后的生成参数（不含 base64 数据）
          requestId: t.requestId, // 保存请求ID（用于超时恢复）
          modelId: t.modelId, // 保存模型ID（用于超时恢复）
          serverTaskId: t.serverTaskId, // 保存服务端任务ID（用于超时恢复）
          message: t.message, // 保存状态消息
          result: t.result ? {
            id: t.result.id,
            type: t.result.type,
            filePath: relativeResultFilePath, // 保存相对路径
            // 明确不保存 url 字段，防止 base64 数据或远程 URL 被保存
            prompt: t.result.prompt,
            createdAt: t.result.createdAt
          } : undefined
        }

        // 【诊断日志】记录保存的任务信息
        if (t.type === 'video' && (t.status === 'generating' || t.status === 'timeout')) {
          logInfo('[App] 💾 保存视频任务到历史记录:', {
            id: t.id,
            status: t.status,
            serverTaskId: t.serverTaskId,
            requestId: t.requestId,
            modelId: t.modelId,
            message: t.message
          })
        }

        return taskToSave
      }))

      const maxHistory = parseInt(localStorage.getItem('max_history_count') || '50', 10)
      const limitedTasks = tasksToSave.slice(-maxHistory)

      // 【诊断日志】记录即将写入的任务数量
      const videoTasks = limitedTasks.filter((t: any) => t.type === 'video')
      logInfo('[App] 📝 写入历史记录文件:', {
        totalTasks: limitedTasks.length,
        videoTasks: videoTasks.length,
        tasksWithServerTaskId: videoTasks.filter((t: any) => t.serverTaskId).length
      })

      writeJsonToAppData('history.json', limitedTasks).catch(e => logError('write history failed', e))
    }

    saveHistory()
  }, [tasks, isTasksLoaded])

  // 检查是否有保存的API密钥
  useEffect(() => {
    const savedApiKey = localStorage.getItem('ppio_api_key')
    if (savedApiKey) {
      apiService.setApiKey(savedApiKey)
      // 默认初始化派欧云适配器
      try {
        apiService.initializeAdapter({
          type: 'ppio',
          modelName: 'seedream-4.0'
        })
      } catch (err) {
        logError('Failed to initialize adapter:', err)
      }
    }
  }, [])


  const handleRegenerate = async (task: GenerationTask) => {
    // 复用原来的参数重新生成，使用任务保存的模型和所有参数
    const options = task.options ? { ...task.options } : {}

    // 向后兼容：如果 options 中没有 size，从 task 的顶级字段获取
    if (!options.size && task.size) {
      options.size = task.size
    }

    // 如果有 uploadedFilePaths，需要重建 base64 图片数据
    if (task.uploadedFilePaths && task.uploadedFilePaths.length > 0) {
      options.uploadedFilePaths = task.uploadedFilePaths
      // 尝试重建 base64，使用正确的 MIME 类型（image/jpeg）
      if (!options.images) {
        try {
          const arr: string[] = []
          for (const p of task.uploadedFilePaths) {
            // 明确使用 image/jpeg MIME 类型，与 saveUploadImage 保持一致
            const data = await fileToDataUrl(p, 'image/jpeg')
            arr.push(data)
          }
          options.images = arr
          logInfo('[App] 重建 images 成功，数量:', arr.length)
        } catch (e) {
          logError('[App] 重建 images 失败:', e)
        }
      }
    }

    // 如果有 uploadedVideoFilePaths，需要重建 base64 视频数据
    if (task.uploadedVideoFilePaths && task.uploadedVideoFilePaths.length > 0) {
      options.uploadedVideoFilePaths = task.uploadedVideoFilePaths
      // 尝试重建 base64
      if (!options.videos) {
        try {
          const arr: string[] = []
          for (const p of task.uploadedVideoFilePaths) {
            const data = await fileToDataUrl(p)
            arr.push(data)
          }
          options.videos = arr
          logInfo('[App] 重建 videos 成功，数量:', arr.length)
        } catch (e) {
          logError('[App] 重建 videos 失败:', e)
        }
      }
    }

    logInfo('[App] 重新生成任务:', {
      model: task.model,
      type: task.type,
      prompt: task.prompt,
    })

    // 恢复编辑状态到 ref，以便后续如果再次重新生成或编辑能保留状态
    // 恢复编辑状态到 ref，以便后续如果再次重新生成或编辑能保留状态
    if (task.options?.editStateFile) {
      // 优先从文件加载（新模式）
      try {
        const states = await loadEditState(task.options.editStateFile)
        if (states && options.images) {
          // 使用索引映射：states key 是 "0", "1" 等索引
          // 我们需要将其映射到新的 options.images 对应的 URL 上
          Object.entries(states).forEach(([key, value]) => {
            const index = parseInt(key)
            if (!isNaN(index) && options.images && options.images[index]) {
              const newUrl = options.images[index]
              imageEditStatesRef.current.set(newUrl, value as ImageEditState)
            } else {
              // 兼容旧模式：key 是 URL (Base64)
              // 如果 options.images 中包含这个 key，直接恢复
              if (options.images && options.images.includes(key)) {
                imageEditStatesRef.current.set(key, value as ImageEditState)
              }
            }
          })
          logInfo('[App] 从文件恢复编辑状态成功', Object.keys(states).length)
        }
      } catch (e) {
        logError('[App] 从文件恢复编辑状态失败:', e)
      }
    } else if (task.options?.imageEditStates) {
      // 兼容旧模式（内联数据）
      try {
        Object.entries(task.options.imageEditStates).forEach(([key, value]) => {
          // 尝试索引匹配
          const index = parseInt(key)
          if (!isNaN(index) && options.images && options.images[index]) {
            const newUrl = options.images[index]
            imageEditStatesRef.current.set(newUrl, value as ImageEditState)
          } else {
            // 原始 Key 匹配
            imageEditStatesRef.current.set(key, value as ImageEditState)
          }
        })
      } catch (e) {
        logError('[App] 恢复历史编辑状态(内联)失败:', e)
      }
    }

    await handleGenerate(task.prompt, task.model, task.type, options)
  }

  const handleReedit = async (task: GenerationTask) => {
    let images: string[] | undefined = undefined

    // 尝试从文件路径恢复图片
    if (task.uploadedFilePaths && task.uploadedFilePaths.length) {
      try {
        const arr: string[] = []
        for (const p of task.uploadedFilePaths) {
          const data = await fileToDataUrl(p)
          arr.push(data)
        }
        images = arr
      } catch (e) {
        logError('[App] 重新编辑无法读取图片文件，尝试使用缓存:', e)
        // 只有当读取失败时，才尝试使用 task.images 回退
        if (task.images && task.images.length) {
          images = task.images
        }
      }
    } else if (task.images && task.images.length) {
      // 没有文件路径，直接使用 images
      images = task.images
    }

    // 恢复视频（逻辑优化）
    let videos: string[] | undefined = undefined

    if (task.uploadedVideoFilePaths && task.uploadedVideoFilePaths.length) {
      try {
        // 读取视频文件（用于生成缩略图等）
        // 注意：这里我们只检查能否读取，实际上不需要全部转为 base64，
        // 因为 uploadedVideoFilePaths 会被传递给 MediaGenerator 处理
        // 但为了保持一致性，我们尝试读取一下
        const arr: string[] = []
        for (const p of task.uploadedVideoFilePaths) {
          try {
            // 简单验证文件是否存在
            await fileToDataUrl(p)
            // 视频这里我们不需要 base64 数据用于显示（因为太大了），
            // 这个 videos 数组主要是为了兼顾旧逻辑
            // 实际使用的是 uploadedVideoFilePaths
            arr.push(p)
          } catch (e) {
            throw e // 抛出错误以触发回退
          }
        }
        // 如果成功，videos 这里的赋值其实不太重要，因为 uploadedVideoFilePaths 更重要
        // 但为了旧逻辑兼容性，我们可以暂不设置 videos，或者设置为空
        // 关键是确保 uploadedVideoFilePaths 有效
      } catch (e) {
        logError('[App] 重新编辑无法读取视频文件，尝试使用缓存:', e)
        // 读取失败，尝试回退到 task.videos (缩略图)
        if (task.videos && task.videos.length) {
          videos = task.videos
        }
      }
    } else if (task.videos && task.videos.length) {
      videos = task.videos
    }

    // 恢复编辑状态到 ref
    // 恢复编辑状态到 ref
    if (task.options?.editStateFile) {
      // 优先从文件加载（新模式）
      try {
        const states = await loadEditState(task.options.editStateFile)
        if (states && images) { // 使用 images 而不是 options.images
          Object.entries(states).forEach(([key, value]) => {
            const index = parseInt(key)
            if (!isNaN(index) && images && images[index]) {
              const newUrl = images[index]
              imageEditStatesRef.current.set(newUrl, value as ImageEditState)
            } else {
              // 兼容旧模式
              imageEditStatesRef.current.set(key, value as ImageEditState)
            }
          })
          logInfo('[App] 从文件恢复编辑状态成功', Object.keys(states).length)
        }
      } catch (e) {
        logError('[App] 从文件恢复编辑状态失败:', e)
      }
    } else if (task.options?.imageEditStates) {
      // 兼容旧模式
      try {
        Object.entries(task.options.imageEditStates).forEach(([key, value]) => {
          const index = parseInt(key)
          if (!isNaN(index) && images && images[index]) {
            const newUrl = images[index]
            imageEditStatesRef.current.set(newUrl, value as ImageEditState)
          } else {
            imageEditStatesRef.current.set(key, value as ImageEditState)
          }
        })
        logInfo('[App] 已恢复历史编辑状态(内联)', Object.keys(task.options.imageEditStates).length)
      } catch (e) {
        logError('[App] 恢复历史编辑状态失败:', e)
      }
    }

    window.dispatchEvent(new CustomEvent('reedit-content', {
      detail: {
        prompt: task.prompt,
        images,
        uploadedFilePaths: task.uploadedFilePaths,
        videos,
        uploadedVideoFilePaths: task.uploadedVideoFilePaths,
        model: task.model,
        provider: task.provider,
        options: task.options
      }
    }))
  }

  const handleContinuePolling = async (task: GenerationTask) => {
    // 根据任务模型确定供应商类型
    const providerObj = providers.find(p => p.models.some(m => m.id === task.model))
    if (!providerObj) {
      throw new Error(`未找到模型 ${task.model} 对应的供应商`)
    }
    const providerType = providerObj.id as 'ppio' | 'fal' | 'modelscope' | 'kie'

    // 【修复】根据供应商类型判断使用哪个方法
    // PPIO 视频任务使用 retryPolling（因为它有特殊的轮询逻辑）
    // 其他任务使用 continuePolling
    if (providerType === 'ppio' && task.type === 'video' && task.serverTaskId) {
      logInfo('[App] 继续查询 PPIO 视频任务:', task.serverTaskId)
      await retryPolling(task)
      return
    }

    logInfo(`[App] 继续查询 ${providerType} 队列:`, {
      requestId: task.requestId,
      modelId: task.modelId,
      serverTaskId: task.serverTaskId
    })

    try {
      // 更新任务状态为生成中
      setTasks(prev => prev.map(t =>
        t.id === task.id ? { ...t, status: 'generating' } : t
      ))
      setIsLoading(true)

      // 获取对应的 API Key
      let apiKey = ''
      if (providerType === 'fal') {
        apiKey = localStorage.getItem('fal_api_key') || ''
      } else if (providerType === 'modelscope') {
        apiKey = localStorage.getItem('modelscope_api_key') || ''
      } else if (providerType === 'kie') {
        apiKey = localStorage.getItem('kie_api_key') || ''
      } else {
        apiKey = localStorage.getItem('ppio_api_key') || ''
      }

      if (!apiKey) {
        throw new Error(`请先在设置中配置 ${providerObj.name} 的 API Key`)
      }

      apiService.setApiKey(apiKey)
      apiService.initializeAdapter({
        type: providerType,
        modelName: task.model
      })

      // 调用 continuePolling 方法
      const adapter = apiService.getAdapter() as any
      if (!adapter.continuePolling) {
        throw new Error('当前适配器不支持继续查询')
      }

      // 根据供应商类型传递不同的参数
      // Fal: continuePolling(modelId, requestId, onProgress)
      // PPIO/KIE/ModelScope: continuePolling(modelId, taskId, onProgress)
      const taskIdOrRequestId = providerType === 'fal' ? task.requestId : task.serverTaskId
      const modelIdParam = providerType === 'fal' ? task.modelId : task.model

      const result = await adapter.continuePolling(
        modelIdParam,
        taskIdOrRequestId,
        (status: any) => {
          logInfo('[App] 继续查询进度:', status.message)
          setTasks(prev => prev.map(t =>
            t.id === task.id ? {
              ...t,
              progress: status.progress || 0,
              message: status.message
            } : t
          ))
        }
      )

      // 再次检查是否超时
      if (result?.status === 'timeout') {
        logInfo('', '[App] 再次超时')
        setTasks(prev => prev.map(t =>
          t.id === task.id ? {
            ...t,
            status: 'timeout',
            message: result.message || '等待超时，任务依然在处理中'
          } : t
        ))
        setIsLoading(false)
        return
      }

      // 成功获取结果，保存图片
      if (result?.url && isDesktop()) {
        try {
          if (result.url.includes('|||')) {
            const urls = result.url.split('|||')
            const display = [] as string[]
            const paths = [] as string[]
            for (const u of urls) {
              const { fullPath } = await saveImageFromUrl(u)
              const blobSrc = await fileToBlobSrc(fullPath, 'image/png')
              display.push(blobSrc)
              paths.push(fullPath)
            }
            result.url = display.join('|||')
              ; (result as any).filePath = paths.join('|||')
          } else {
            const { fullPath } = await saveImageFromUrl(result.url)
            const blobSrc = await fileToBlobSrc(fullPath, 'image/png')
            result.url = blobSrc
              ; (result as any).filePath = fullPath
          }
          logInfo('', '[App] 本地保存成功')
        } catch (e) {
          logError('[App] 本地保存失败', e)
        }
      }

      // 获取实际媒体尺寸和时长
      let dimensions: string | null = null
      let duration: string | null = null
      try {
        const urlToCheck = (result as any).filePath || result.url
        // 如果包含多个 URL（用 ||| 分隔），只取第一个
        const firstUrl = urlToCheck.includes('|||') ? urlToCheck.split('|||')[0] : urlToCheck
        dimensions = await getMediaDimensions(firstUrl, task.type)
        duration = await getMediaDurationFormatted(firstUrl, task.type)
        logInfo('[App] 获取媒体信息:', { dimensions, duration })
      } catch (error) {
        logError('[App] 获取媒体信息失败:', error)
      }

      // 更新任务为成功状态
      setTasks(prev => prev.map(t =>
        t.id === task.id ? {
          ...t,
          status: 'success',
          dimensions: dimensions || undefined,
          duration: duration || undefined,
          result: {
            id: task.id,
            type: task.type,
            url: result.url,
            filePath: (result as any).filePath,
            prompt: task.prompt,
            createdAt: new Date()
          },
          requestId: undefined,
          modelId: undefined,
          message: undefined
        } : t
      ))
    } catch (err) {
      logError('[App] 继续查询失败:', err)
      setTasks(prev => prev.map(t =>
        t.id === task.id ? {
          ...t,
          status: 'error',
          error: err instanceof Error ? err.message : '继续查询失败'
        } : t
      ))
    } finally {
      setIsLoading(false)
    }
  }

  // 清除所有历史记录
  const clearAllHistory = () => {
    setTasks([])
    localStorage.removeItem('generationTasks')
  }

  const clearAllHistoryFiles = async () => {
    try {
      // 加载所有预设
      const presets = await loadPresets()

      const audioPaths: string[] = []

      // 收集结果文件（这些不会被预设引用，直接删除）
      const resultFiles = new Set<string>()
      const editStateFiles = new Set<string>() // 收集编辑状态文件列表

      tasks.forEach(t => {
        // 收集编辑状态文件
        if (t.options?.editStateFile) {
          editStateFiles.add(t.options.editStateFile)
        }

        const p = t.result?.filePath
        if (p) {
          if (p.includes('|||')) {
            p.split('|||').forEach(f => resultFiles.add(f))
          } else {
            resultFiles.add(p)
          }
          if (t.result?.type === 'audio') {
            if (p.includes('|||')) audioPaths.push(...p.split('|||'))
            else audioPaths.push(p)
          }
        }
      })

      // 删除编辑状态文件
      for (const f of editStateFiles) {
        try { await deleteEditState(f) } catch (e) { logError('[App] 删除编辑状态文件失败', { data: [f, e] }) }
      }

      // 删除结果文件
      for (const f of resultFiles) {
        try { await remove(f) } catch (e) { logError('[App] 删除文件失败', { data: [f, e] }) }
      }

      // 删除音频波形缓存
      for (const ap of audioPaths) {
        try { await deleteWaveformCacheForAudio(ap) } catch (e) { logError('[App] 删除波形缓存失败', { data: [ap, e] }) }
      }

      // 收集上传文件（图片）
      const uploadedFiles = new Set<string>()
      tasks.forEach(t => {
        if (t.uploadedFilePaths) {
          t.uploadedFilePaths.forEach(f => uploadedFiles.add(f))
        }
      })

      // 收集上传文件（视频）
      const uploadedVideoFiles = new Set<string>()
      tasks.forEach(t => {
        if (t.uploadedVideoFilePaths) {
          t.uploadedVideoFilePaths.forEach(f => uploadedVideoFiles.add(f))
        }
      })

      // 删除上传文件（图片） - 检查预设引用
      for (const filePath of uploadedFiles) {
        // 检查预设是否在使用
        const usedByPreset = presets.some(preset =>
          preset.images?.filePaths?.includes(filePath)
        )

        if (!usedByPreset) {
          try {
            await remove(filePath)
            logInfo('[App] 删除上传文件(预设未使用):', filePath)
          } catch (e) {
            logError('[App] 删除文件失败', { data: [filePath, e] })
          }
        } else {
          logInfo('[App] 保留上传文件(预设使用中):', filePath)
        }
      }

      // 删除上传文件（视频） - 视频不会被预设引用，直接删除
      for (const filePath of uploadedVideoFiles) {
        try {
          await remove(filePath)
          logInfo('[App] 删除上传视频文件:', filePath)
        } catch (e) {
          logError('[App] 删除视频文件失败', { data: [filePath, e] })
        }
      }
    } finally {
      clearAllHistory()
    }
  }

  // 仅删除失败的历史记录
  const clearFailedHistory = async () => {
    const failedTasks = tasks.filter(t => t.status === 'error' || t.status === 'timeout')

    try {
      // 加载所有预设
      const presets = await loadPresets()

      const audioPaths: string[] = []

      // 收集结果文件
      const resultFiles = new Set<string>()
      const editStateFiles = new Set<string>()

      failedTasks.forEach(t => {
        if (t.options?.editStateFile) {
          editStateFiles.add(t.options.editStateFile)
        }

        const p = t.result?.filePath
        if (p) {
          if (p.includes('|||')) {
            p.split('|||').forEach(f => resultFiles.add(f))
          } else {
            resultFiles.add(p)
          }
          if (t.result?.type === 'audio') {
            if (p.includes('|||')) audioPaths.push(...p.split('|||'))
            else audioPaths.push(p)
          }
        }
      })

      // 删除编辑状态文件
      for (const f of editStateFiles) {
        try { await deleteEditState(f) } catch (e) { logError('[App] 删除编辑状态文件(失败任务)失败', { data: [f, e] }) }
      }

      // 删除结果文件
      for (const f of resultFiles) {
        try { await remove(f) } catch (e) { logError('[App] 删除失败记录文件失败', { data: [f, e] }) }
      }

      // 删除音频波形缓存
      for (const ap of audioPaths) {
        try { await deleteWaveformCacheForAudio(ap) } catch (e) { logError('[App] 删除失败记录波形缓存失败', { data: [ap, e] }) }
      }

      // 收集上传文件（图片）
      const uploadedFiles = new Set<string>()
      failedTasks.forEach(t => {
        if (t.uploadedFilePaths) {
          t.uploadedFilePaths.forEach(f => uploadedFiles.add(f))
        }
      })

      // 收集上传文件（视频）
      const uploadedVideoFiles = new Set<string>()
      failedTasks.forEach(t => {
        if (t.uploadedVideoFilePaths) {
          t.uploadedVideoFilePaths.forEach(f => uploadedVideoFiles.add(f))
        }
      })

      // 计算删除后剩余的任务
      const failedTaskIds = new Set(failedTasks.map(t => t.id))
      const remainingTasks = tasks.filter(t => !failedTaskIds.has(t.id))

      // 删除上传文件（图片） - 检查剩余历史记录和预设的引用
      for (const filePath of uploadedFiles) {
        const canDelete = canDeleteFile(filePath, remainingTasks, presets)

        if (canDelete) {
          try {
            await remove(filePath)
            logInfo('[App] 删除上传文件(无引用):', filePath)
          } catch (e) {
            logError('[App] 删除失败记录文件失败', { data: [filePath, e] })
          }
        } else {
          logInfo('[App] 保留上传文件(仍有引用):', filePath)
        }
      }

      // 删除上传文件（视频） - 检查剩余历史记录的引用
      for (const filePath of uploadedVideoFiles) {
        // 检查剩余任务是否在使用
        const usedByRemaining = remainingTasks.some(t =>
          t.uploadedVideoFilePaths?.includes(filePath)
        )

        if (!usedByRemaining) {
          try {
            await remove(filePath)
            logInfo('[App] 删除上传视频文件(无引用):', filePath)
          } catch (e) {
            logError('[App] 删除视频文件失败', { data: [filePath, e] })
          }
        } else {
          logInfo('[App] 保留上传视频文件(仍有引用):', filePath)
        }
      }
    } finally {
      // 从任务列表中移除失败的任务
      setTasks(prev => prev.filter(t => t.status !== 'error' && t.status !== 'timeout'))
    }
  }

  // 删除单条历史记录
  const deleteTask = async (taskId: string) => {
    const target = tasks.find(t => t.id === taskId)

    // 删除生成的结果文件及其缩略图缓存
    if (target?.result?.filePath) {
      const paths = target.result.filePath.includes('|||') ? target.result.filePath.split('|||') : [target.result.filePath]
      for (const p of paths) {
        try { await remove(p) } catch (e) { logError('[App] 删除单条文件失败', { data: [p, e] }) }
        // 删除对应的缩略图缓存（图片和视频）
        if (target.result.type === 'image' || target.result.type === 'video') {
          try {
            const { deleteThumbnailCache } = await import('../utils/imageConversion')
            await deleteThumbnailCache(p)
          } catch (e) { logError('[App] 删除缩略图缓存失败', { data: [p, e] }) }
        }
      }
      if (target?.result?.type === 'audio') {
        for (const p of paths) {
          try { await deleteWaveformCacheForAudio(p) } catch (e) { logError('[App] 删除单条波形缓存失败', { data: [p, e] }) }
        }
      }
    }

    // 删除编辑状态文件
    if (target?.options?.editStateFile) {
      try { await deleteEditState(target.options.editStateFile) } catch (e) { logError('[App] 删除单条编辑状态文件失败', { data: [target.options.editStateFile, e] }) }
    }

    // 删除上传的文件（图片） - 增强版引用计数（包含预设）
    if (target?.uploadedFilePaths && target.uploadedFilePaths.length) {
      // 加载所有预设
      const presets = await loadPresets()

      // 检查每个文件是否可以删除
      for (const filePath of target.uploadedFilePaths) {
        const canDelete = canDeleteFile(filePath, tasks, presets, taskId)

        if (canDelete) {
          try {
            await remove(filePath)
            logInfo('[App] 删除上传文件(无引用):', filePath)
            // 同时删除缩略图缓存
            const { deleteThumbnailCache } = await import('../utils/imageConversion')
            await deleteThumbnailCache(filePath)
          } catch (e) {
            logError('[App] 删除单条上传文件失败', { data: [filePath, e] })
          }
        } else {
          logInfo('[App] 保留上传文件(仍有引用):', filePath)
        }
      }
    }

    // 删除上传的文件（视频） - 检查引用计数
    if (target?.uploadedVideoFilePaths && target.uploadedVideoFilePaths.length) {
      // 检查每个视频文件是否可以删除
      for (const filePath of target.uploadedVideoFilePaths) {
        // 检查其他任务是否在使用（排除当前任务）
        const usedByOthers = tasks.some(t =>
          t.id !== taskId && t.uploadedVideoFilePaths?.includes(filePath)
        )

        if (!usedByOthers) {
          try {
            await remove(filePath)
            logInfo('[App] 删除上传视频文件(无引用):', filePath)
            // 同时删除缩略图缓存
            const { deleteThumbnailCache } = await import('../utils/imageConversion')
            await deleteThumbnailCache(filePath)
          } catch (e) {
            logError('[App] 删除单条上传视频文件失败', { data: [filePath, e] })
          }
        } else {
          logInfo('[App] 保留上传视频文件(仍有引用):', filePath)
        }
      }
    }

    setTasks(prev => prev.filter(task => task.id !== taskId))
  }

  return (
    <div
      className="h-full flex-1 bg-[#0a0b0d] text-white flex flex-col relative overflow-hidden"
      style={{
        opacity: isReady ? 1 : 0,
        transition: 'opacity 0.3s ease-in-out'
      }}
    >
      {/* WindowControls 已移至外层 App.tsx */}

      {/* 顶部通知 - 考虑标题栏高度下移 */}
      <div
        className={`fixed top-12 left-1/2 transform -translate-x-1/2 z-[100] transition-all duration-500 ease-out ${notificationVisible ? 'translate-y-0 opacity-100' : '-translate-y-8 opacity-0 pointer-events-none'
          }`}
      >
        {notification && (
          <div className={`px-6 py-3 rounded-xl shadow-2xl backdrop-blur-md border flex items-center gap-3 ${notification.type === 'success'
            ? 'bg-green-500/20 border-green-500/30 text-green-100'
            : 'bg-red-500/20 border-red-500/30 text-red-100'
            }`}>
            {notification.type === 'success' ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
            <span className="font-medium text-sm">{notification.message}</span>
          </div>
        )}
      </div>

      {/* 主内容区 */}
      <main className="flex-1 flex flex-col relative z-10 pt-10">
        {/* 结果显示区 - 瀑布流布局 */}
        <div ref={listContainerRef} className="flex-1 overflow-y-auto p-4 pb-[400px] app-scroll-container" style={{ paddingBottom: inputPadding }}>
          <div ref={contentRef} className="max-w-6xl mx-auto w-[90%]">
            {tasks.length > 0 ? (
              <>
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-bold">生成历史</h2>
                  {false && (
                    <button
                      onClick={() => setIsConfirmClearOpen(true)}
                      className="h-8 px-3 inline-flex items-center justify-center bg-red-600/60 hover:bg-red-600/80 rounded-md text-sm leading-none transition-colors"
                    >
                      清除历史
                    </button>
                  )}
                </div>
                <div className="space-y-6">
                  {tasks.map((task) => (
                    <div
                      key={task.id}
                      className="overflow-hidden animate-fade-in"
                    >
                      {/* 任务信息行 */}
                      <div className="pb-3 border-b border-zinc-700/50">
                        <div className="flex flex-wrap gap-4 items-start">
                          {/* 原始图片缩略图 */}
                          {task.images && task.images.length > 0 && (
                            <div className="flex gap-2">
                              {task.images.slice(0, 3).map((image, index) => (
                                <div
                                  key={index}
                                  className="w-16 h-16 rounded cursor-grab active:cursor-grabbing transition-all overflow-hidden border border-zinc-700/50 hover:brightness-75"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    openImageViewer(image, task.images)
                                  }}
                                >
                                  <img
                                    src={image}
                                    alt={`Input ${index + 1}`}
                                    className="w-full h-full object-cover rounded select-none"
                                    onMouseDown={(e) => {
                                      e.stopPropagation()
                                      handleHistoryImageDragStart(e, image, task.uploadedFilePaths?.[index])
                                    }}
                                    draggable={false}
                                  />
                                </div>
                              ))}
                              {task.images.length > 3 && (
                                <div
                                  className="w-16 h-16 rounded bg-zinc-700/50 flex items-center justify-center text-xs cursor-pointer transition-all border border-zinc-700/50 hover:brightness-75"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    openImageViewer(task.images![3], task.images)
                                  }}
                                >
                                  +{task.images.length - 3}
                                </div>
                              )}
                            </div>
                          )}

                          {/* 原始视频缩略图 */}
                          {task.videos && task.videos.length > 0 && (
                            <div className="flex gap-2">
                              {task.videos.slice(0, 3).map((video, index) => (
                                <div
                                  key={index}
                                  className="w-16 h-16 rounded cursor-pointer transition-all overflow-hidden border border-zinc-700/50 hover:brightness-75 relative"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    // 打开视频查看器，传递视频 URL 和文件路径（如果有）
                                    const filePath = task.uploadedVideoFilePaths?.[index]
                                    openVideoViewer(video, filePath)
                                  }}
                                >
                                  <video
                                    src={video}
                                    className="w-full h-full object-cover rounded"
                                    muted
                                  />
                                  {/* 视频图标标识 */}
                                  <div className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none">
                                    <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                                      <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                                    </svg>
                                  </div>
                                </div>
                              ))}
                              {task.videos.length > 3 && (
                                <div
                                  className="w-16 h-16 rounded bg-zinc-700/50 flex items-center justify-center text-xs cursor-pointer transition-all border border-zinc-700/50 hover:brightness-75"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    // 点击 "+N" 时打开第4个视频
                                    const video = task.videos![3]
                                    const filePath = task.uploadedVideoFilePaths?.[3]
                                    openVideoViewer(video, filePath)
                                  }}
                                >
                                  +{task.videos.length - 3}
                                </div>
                              )}
                            </div>
                          )}

                          {/* 文本提示词 */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-zinc-300 truncate text-left">{task.prompt}</p>
                            <div className="flex flex-wrap gap-2 mt-1">
                              <span className="text-xs bg-zinc-700/50 px-2 py-1 rounded">
                                {task.type === 'image' ? '图片' : task.type === 'video' ? '视频' : '音频'}
                              </span>
                              <span className="text-xs bg-[#007eff]/20 text-[#66b3ff] px-2 py-1 rounded">
                                {formatModelDisplayName(task.model)}
                              </span>
                              {/* 图片：显示尺寸 */}
                              {task.type === 'image' && (task.dimensions || task.size) && (
                                <span className="text-xs bg-zinc-700/50 px-2 py-1 rounded">
                                  {task.dimensions || task.size}
                                </span>
                              )}
                              {/* 视频：显示尺寸和时长 */}
                              {task.type === 'video' && (task.dimensions || task.size) && (
                                <span className="text-xs bg-zinc-700/50 px-2 py-1 rounded">
                                  {task.dimensions || task.size}
                                </span>
                              )}
                              {task.type === 'video' && task.duration && (
                                <span className="text-xs bg-zinc-700/50 px-2 py-1 rounded">
                                  {task.duration}
                                </span>
                              )}
                              {/* 音频：只显示时长 */}
                              {task.type === 'audio' && task.duration && (
                                <span className="text-xs bg-zinc-700/50 px-2 py-1 rounded">
                                  {task.duration}
                                </span>
                              )}
                              {task.result?.createdAt && (
                                <span className="text-xs bg-zinc-700/50 px-2 py-1 rounded">
                                  {new Date(task.result.createdAt).toLocaleString()}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* 操作按钮 */}
                          <div className="flex gap-2">
                            {/* 下载按钮 */}
                            {task.result && (
                              <button
                                onClick={async () => {
                                  if (task.result?.filePath) {
                                    // 处理多文件下载
                                    const filePaths = task.result.filePath.includes('|||')
                                      ? task.result.filePath.split('|||')
                                      : [task.result.filePath]

                                    for (const fp of filePaths) {
                                      await handleDownloadMedia(fp, true)
                                    }
                                  }
                                }}
                                className="p-2 bg-zinc-700/50 hover:bg-zinc-600/50 rounded-lg transition-all duration-300"
                                title="下载"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                              </button>
                            )}
                            <button
                              onClick={() => handleRegenerate(task)}
                              className="p-2 bg-zinc-700/50 hover:bg-zinc-600/50 rounded-lg transition-all duration-300"
                              title="重新生成"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleReedit(task)}
                              className="p-2 bg-zinc-700/50 hover:bg-zinc-600/50 rounded-lg transition-all duration-300"
                              title="重新编辑"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => deleteTask(task.id)}
                              className="p-2 bg-red-700/50 hover:bg-red-600/50 rounded-lg transition-all duration-300"
                              title="删除"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* 结果显示区域 */}
                      <div className="pt-3">
                        {task.status === 'queued' && (
                          <div className="flex items-center justify-center h-64 bg-[#1B1C21] rounded-lg border-2 border-blue-500/30">
                            <div className="text-center">
                              <div className="inline-block mb-3">
                                <svg className="w-12 h-12 text-blue-400 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              </div>
                              <p className="text-blue-400 font-medium">排队中...</p>
                              <p className="text-zinc-400 text-sm mt-2">等待上一个任务完成</p>
                            </div>
                          </div>
                        )}

                        {task.status === 'pending' && (
                          <div className="flex items-center justify-center h-64 bg-[#1B1C21] rounded-lg">
                            <div className="text-center">
                              <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[#007eff] mb-2"></div>
                              <p className="text-zinc-400">准备生成...</p>
                            </div>
                          </div>
                        )}

                        {task.status === 'generating' && (
                          <div className="flex items-center justify-center h-64 bg-[#1B1C21] rounded-lg">
                            <div className="text-center w-full px-6">
                              <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[#007eff] mb-3"></div>
                              <p className="text-zinc-400 mb-3">生成中...</p>
                              {/* 进度条：视频任务、Fal图片任务、魔搭图片任务、KIE图片任务、有进度的派欧云图片任务 */}
                              {(task.type === 'video' ||
                                (task.type === 'image' && task.provider === 'fal') ||
                                (task.type === 'image' && task.provider === 'modelscope') ||
                                (task.type === 'image' && task.provider === 'kie') ||
                                (task.type === 'image' && task.provider === 'ppio' && (task.model === 'seedream-4.0' || (taskProgress[task.id] || 0) > 0))
                              ) && (
                                  <ProgressBar
                                    progress={taskProgress[task.id] || task.progress || 0}
                                    className="mt-3"
                                  />
                                )}
                              {task.timedOut && (
                                <div className="mt-3 text-sm text-zinc-300">
                                  <span className="mr-2">轮询超时，任务仍在处理中。</span>
                                  <button
                                    onClick={() => retryPolling(task)}
                                    className="inline-flex items-center px-3 py-1 rounded bg-[#007eff] hover:brightness-110 text-white text-sm transition-colors"
                                  >再次轮询 120 次</button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {task.status === 'timeout' && (
                          <div className="flex items-center justify-center h-64 bg-[#1B1C21] rounded-lg border-2 border-yellow-500/30">
                            <div className="text-center w-full px-6">
                              <div className="inline-block mb-3">
                                <svg className="w-12 h-12 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              </div>
                              <p className="text-yellow-400 mb-2 font-medium">{task.message || '等待超时，任务依然在处理中'}</p>
                              <p className="text-zinc-400 text-sm mb-4">任务可能还在处理中，您可以继续查询状态</p>
                              <button
                                onClick={() => handleContinuePolling(task)}
                                disabled={isLoading}
                                className="inline-flex items-center px-4 py-2 rounded-lg bg-[#007eff] hover:brightness-110 text-white text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                                继续查询
                              </button>
                            </div>
                          </div>
                        )}

                        {task.status === 'success' && task.result && (
                          <div className="flex justify-start">
                            <div
                              ref={(el) => {
                                if (el) {
                                  // 移除旧的监听器（如果存在）
                                  const oldHandler = (el as any)._wheelHandler
                                  if (oldHandler) {
                                    el.removeEventListener('wheel', oldHandler)
                                  }

                                  // 保存目标滚动位置和动画ID到元素上，避免重复初始化
                                  if ((el as any)._targetScrollLeft === undefined) {
                                    (el as any)._targetScrollLeft = el.scrollLeft
                                  }
                                  if ((el as any)._animationFrameId === undefined) {
                                    (el as any)._animationFrameId = null
                                  }

                                  // 平滑滚动动画函数
                                  const smoothScroll = () => {
                                    const currentScrollLeft = el.scrollLeft
                                    const targetScrollLeft = (el as any)._targetScrollLeft
                                    const distance = targetScrollLeft - currentScrollLeft

                                    // 如果距离很小，直接设置到目标位置
                                    if (Math.abs(distance) < 0.5) {
                                      el.scrollLeft = targetScrollLeft
                                        ; (el as any)._animationFrameId = null
                                      return
                                    }

                                    // 使用缓动函数（easing）实现平滑滚动
                                    // 每次移动剩余距离的 20%，实现减速效果
                                    el.scrollLeft += distance * 0.2
                                      ; (el as any)._animationFrameId = requestAnimationFrame(smoothScroll)
                                  }

                                  // 创建新的滚轮处理器
                                  const wheelHandler = (e: WheelEvent) => {
                                    // 检查是否有横向滚动空间（即是否有多张图片）
                                    const hasHorizontalScroll = el.scrollWidth > el.clientWidth

                                    // 如果只有一张图片（没有横向滚动空间），不拦截滚轮事件，允许页面滚动
                                    if (!hasHorizontalScroll) {
                                      return
                                    }

                                    // 判断滚动方向：横向滚动优先
                                    const isHorizontalScroll = Math.abs(e.deltaX) > Math.abs(e.deltaY)

                                    if (isHorizontalScroll && e.deltaX !== 0) {
                                      // 触控板左右滑动：使用 deltaX
                                      e.preventDefault()
                                        ; (el as any)._targetScrollLeft += e.deltaX
                                        ; (el as any)._targetScrollLeft = Math.max(0, Math.min((el as any)._targetScrollLeft, el.scrollWidth - el.clientWidth))

                                      if ((el as any)._animationFrameId === null) {
                                        ; (el as any)._animationFrameId = requestAnimationFrame(smoothScroll)
                                      }
                                    } else if (!isHorizontalScroll && e.deltaY !== 0) {
                                      // 鼠标滚轮或触控板上下滑动：使用 deltaY 控制横向滚动
                                      e.preventDefault()
                                        ; (el as any)._targetScrollLeft += e.deltaY
                                        ; (el as any)._targetScrollLeft = Math.max(0, Math.min((el as any)._targetScrollLeft, el.scrollWidth - el.clientWidth))

                                      if ((el as any)._animationFrameId === null) {
                                        ; (el as any)._animationFrameId = requestAnimationFrame(smoothScroll)
                                      }
                                    }
                                  }

                                    // 保存处理器引用以便后续清理
                                    ; (el as any)._wheelHandler = wheelHandler

                                  // 添加事件监听器，设置 passive: false 以允许 preventDefault
                                  el.addEventListener('wheel', wheelHandler, { passive: false })
                                }
                              }}
                              className="flex gap-2 overflow-x-auto max-w-full pb-2 image-strip"
                              style={{
                                scrollbarWidth: 'thin',
                                scrollbarColor: '#4B5563 #1F2937'
                              }}
                            >
                              {/* 支持多张图片显示 */}
                              {task.result.type === 'image' && task.result.url && (
                                task.result.url.includes('|||') ? (
                                  // 多张图片
                                  (() => {
                                    const imageUrls = task.result!.url.split('|||')
                                    const filePaths = task.result!.filePath ? (task.result!.filePath.includes('|||') ? task.result!.filePath.split('|||') : [task.result!.filePath]) : []
                                    return imageUrls.map((url, index) => (
                                      <div
                                        key={index}
                                        className="relative w-64 h-64 bg-[#1B1C21] rounded-lg overflow-hidden border border-zinc-700/50 flex items-center justify-center flex-shrink-0"
                                        onClick={() => handleHistoryImageClick(url, imageUrls, filePaths)}
                                        onContextMenu={(e) => {
                                          const filePath = filePaths[index]
                                          showMenu(e, getImageMenuItems(url, filePath))
                                        }}
                                      >
                                        <img
                                          src={url}
                                          alt={`${task.result!.prompt} ${index + 1}`}
                                          className="max-w-full max-h-full object-contain cursor-grab active:cursor-grabbing select-none"
                                          onMouseDown={(e) => {
                                            e.stopPropagation()
                                            handleHistoryImageDragStart(e, url, filePaths[index])
                                          }}
                                          draggable={false}
                                        />
                                      </div>
                                    ))
                                  })()
                                ) : (
                                  // 单张图片
                                  <div
                                    className="relative w-64 h-64 bg-[#1B1C21] rounded-lg overflow-hidden border border-zinc-700/50 flex items-center justify-center flex-shrink-0"
                                    onClick={() => handleHistoryImageClick(task.result!.url, [task.result!.url], task.result!.filePath ? [task.result!.filePath] : [])}
                                    onContextMenu={(e) => showMenu(e, getImageMenuItems(task.result!.url, task.result!.filePath))}
                                  >
                                    <img
                                      src={task.result.url}
                                      alt={task.result.prompt}
                                      className="max-w-full max-h-full object-contain cursor-grab active:cursor-grabbing select-none"
                                      onMouseDown={(e) => {
                                        e.stopPropagation()
                                        handleHistoryImageDragStart(e, task.result!.url, task.result!.filePath)
                                      }}
                                      draggable={false}
                                    />
                                  </div>
                                )
                              )}
                              {task.result.type === 'video' && (
                                <div
                                  className="relative w-64 h-64 bg-[#1B1C21] rounded-lg overflow-hidden border border-zinc-700/50 flex items-center justify-center cursor-grab active:cursor-grabbing"
                                  onClick={() => handleHistoryVideoClick(task.result!.url, (task.result as any).filePath)}
                                  onMouseDown={(e) => {
                                    e.stopPropagation()
                                    handleHistoryVideoDragStart(e, task.result!.url, (task.result as any).filePath)
                                  }}
                                  onContextMenu={(e) => showMenu(e, getVideoThumbnailMenuItems(task.result!.filePath))}
                                >
                                  <video
                                    src={task.result.url}
                                    className="max-w-full max-h-full object-contain select-none"
                                    draggable={false}
                                  />
                                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    <div className="h-10 w-10 rounded-full bg-zinc-900/60 backdrop-blur-sm flex items-center justify-center text-white">
                                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
                                        <path d="M8 5v14l11-7-11-7z" />
                                      </svg>
                                    </div>
                                  </div>
                                </div>
                              )}
                              {task.result.type === 'audio' && (
                                <AudioPlayer
                                  src={task.result.url}
                                  filePath={(task.result as any).filePath}
                                  onContextMenu={(e) => showMenu(e, getAudioMenuItems((task.result as any).filePath))}
                                />
                              )}
                            </div>
                          </div>
                        )}

                        {task.status === 'error' && (
                          <div className="flex items-center justify-center h-64 bg-red-900/20 rounded-lg border border-red-700/50">
                            <div className="text-center">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-red-500 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                              </svg>
                              <p className="text-red-300">{task.error}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {/* 滚动到此元素 */}
                  <div ref={tasksEndRef} />
                </div>
              </>
            ) : (
              <div className="h-full" />
            )}
          </div>
        </div >

        {/* 错误提示 */}
        {
          error && (
            <div className="mx-4 mb-4 p-3 bg-red-900/50 backdrop-blur-lg border border-red-700/50 rounded-xl shadow-lg animate-shake">
              <p className="text-red-200">{error}</p>
            </div>
          )
        }

        {/* 输入区域 - 悬浮设计 */}
        <div
          ref={inputContainerRef}
          className="fixed bottom-6 left-1/2 transform -translate-x-1/2 w-[95%] max-w-5xl"
          style={{
            zIndex: isImageDragging ? 9999 : 20
          }}
          onMouseEnter={handlePanelMouseEnter}
          onMouseLeave={handlePanelMouseLeave}
          onMouseMove={handlePanelMouseMove}
        >
          {/* 折叠状态的简洁条 */}
          <div
            className="bg-[#131313]/70 backdrop-blur-xl border border-zinc-700/50 rounded-2xl shadow-2xl hover:shadow-3xl cursor-pointer relative"
            style={{
              transition: 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
              maxHeight: isPanelCollapsed || isCollapsing ? '52px' : '600px',
              minHeight: isPanelCollapsed || isCollapsing ? '52px' : 'auto',
              opacity: isPanelCollapsed || isCollapsing ? 1 : 1,
              padding: isPanelCollapsed || isCollapsing ? '12px 24px' : '16px',
              overflow: (isPanelCollapsed && !isCollapsing) || isImageDragging ? 'visible' : 'hidden'
            }}
            onClick={() => {
              if (isPanelCollapsed) {
                expandPanelSmooth()
              }
            }}
          >
            {/* 折叠状态内容 - 绝对定位，跟随面板移动 */}
            <div
              className="absolute left-0 right-0"
              style={{
                top: isPanelCollapsed || isCollapsing ? '12px' : '-60px',
                opacity: isPanelCollapsed || isCollapsing ? 1 : 0,
                transition: 'opacity 0.5s cubic-bezier(0.4, 0, 0.2, 1), top 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
                padding: '0 24px'
              }}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="text-xs bg-[#007eff]/20 text-[#66b3ff] px-2 py-1 rounded whitespace-nowrap">
                    {formatModelDisplayName(currentModelName || 'seedream-4.0')}
                  </span>
                  <span className="text-sm text-zinc-300 truncate flex-1">
                    {currentPrompt || '鼠标移动到此处来展开面板......'}
                  </span>
                </div>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5 text-zinc-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                </svg>
              </div>
            </div>

            {/* 完整面板内容 */}
            <div
              style={{
                opacity: !isPanelCollapsed && !isCollapsing ? 1 : 0,
                transition: 'opacity 0.4s ease 0.15s',
                pointerEvents: !isPanelCollapsed && !isCollapsing ? 'auto' : 'none',
                display: !isPanelCollapsed || isCollapsing ? 'block' : 'none'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <MediaGenerator
                onGenerate={handleGenerate}
                isLoading={isLoading}
                isGenerating={isGenerating}
                onOpenSettings={openSettings}
                onOpenClearHistory={() => setIsConfirmClearOpen(true)}
                onImageClick={(url: string, list: string[]) => openImageViewer(url, list, undefined, true)}
                onSetUploadedImagesRef={(setter) => { setUploadedImagesRef.current = setter }}
                onSetUploadedFilePathsRef={(setter) => { setUploadedFilePathsRef.current = setter }}
                isCollapsed={isPanelCollapsed}
                onToggleCollapse={() => {
                  if (isPanelCollapsed) {
                    expandPanelSmooth()
                  } else {
                    collapsePanelSmooth()
                  }
                }}
              />
            </div>
          </div>
        </div>
      </main >
      {isConfirmClearOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" style={{ opacity: confirmOpacity, transition: 'opacity 180ms ease' }} onClick={() => { setConfirmOpacity(0); setNeedsClearAllConfirm(false); setTimeout(() => setIsConfirmClearOpen(false), 180) }} />
          <div className="relative bg-[#131313]/80 border border-zinc-700/50 rounded-xl p-4 w-[400px] shadow-2xl" style={{ opacity: confirmOpacity, transform: `scale(${0.97 + 0.03 * confirmOpacity})`, transition: 'opacity 180ms ease, transform 180ms ease' }}>
            <div className="text-white text-base">清除历史记录</div>
            <div className="text-zinc-300 text-sm mt-2">请选择要执行的操作</div>
            <div className="mt-4 flex flex-col gap-2">
              <button
                onClick={async () => { await clearFailedHistory(); setConfirmOpacity(0); setNeedsClearAllConfirm(false); setTimeout(() => setIsConfirmClearOpen(false), 180) }}
                className="h-9 px-3 inline-flex items-center justify-center rounded-md bg-yellow-600/70 hover:bg-yellow-600 text-white text-sm transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                仅删除失败的记录
              </button>
              <button
                onClick={async () => {
                  if (needsClearAllConfirm) {
                    // 第二次点击，执行删除
                    await clearAllHistoryFiles()
                    setConfirmOpacity(0)
                    setNeedsClearAllConfirm(false)
                    setTimeout(() => setIsConfirmClearOpen(false), 180)
                  } else {
                    // 第一次点击，要求二次确认
                    setNeedsClearAllConfirm(true)
                  }
                }}
                className={`h-9 px-3 inline-flex items-center justify-center rounded-md text-white text-sm transition-all ${needsClearAllConfirm
                  ? 'bg-red-700 hover:bg-red-800 animate-pulse-scale'
                  : 'bg-red-600/70 hover:bg-red-600'
                  }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                {needsClearAllConfirm ? '再次点击确认删除' : '清除所有历史记录'}
              </button>
              <button
                onClick={() => { setConfirmOpacity(0); setNeedsClearAllConfirm(false); setTimeout(() => setIsConfirmClearOpen(false), 180) }}
                className="h-9 px-3 inline-flex items-center justify-center rounded-md bg-zinc-700/60 hover:bg-zinc-600/60 text-sm transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 图片查看器/编辑器 - 共享背景防止切换闪烁 */}
      {
        isImageViewerOpen && (
          <div
            className="fixed inset-0 bg-black/90 backdrop-blur-lg z-50"
            style={{ opacity: viewerOpacity, transition: 'opacity 400ms ease' }}
          >
            {isEditorMode && (
              // 编辑模式 - 使用 ImageEditor
              <ImageEditor
                imageUrl={currentImage}
                imageId={currentImage} // 使用 URL 作为唯一标识，解决删除后重传仍保留历史的问题
                imageList={currentImageList}
                currentIndex={currentImageIndex}
                initialEditState={imageEditStatesRef.current.get(currentImage)}
                onClose={() => {
                  closeImageViewer()
                }}
                onSave={(dataUrl, editState) => {
                  // 延迟保存模式：编辑确认时只更新内存状态，文件在点击"生成"时才保存
                  // 1. 更新编辑状态到内存（使用 dataUrl 作为临时 key）
                  const newEditState: ImageEditState = {
                    ...editState,
                    imageId: dataUrl,
                    originalSrc: editState.originalSrc // 保持原图引用
                  }
                  imageEditStatesRef.current.set(dataUrl, newEditState)

                  // 2. 更新 UI 显示（使用 base64 dataUrl）
                  setCurrentImage(dataUrl)
                  setCurrentImageList(prev => {
                    const updated = [...prev]
                    updated[currentImageIndex] = dataUrl
                    return updated
                  })

                  // 3. 更新上传区域的图片显示
                  if (setUploadedImagesRef.current) {
                    setUploadedImagesRef.current(prev => {
                      const updated = [...prev]
                      updated[currentImageIndex] = dataUrl
                      return updated
                    })
                  }

                  // 4. 清除对应位置的 uploadedFilePaths（标记为需要保存）
                  // 空字符串表示这个位置的图片已被编辑，需要在生成时重新保存
                  if (setUploadedFilePathsRef.current) {
                    setUploadedFilePathsRef.current(prev => {
                      const updated = [...prev]
                      updated[currentImageIndex] = '' // 清空路径，标记需要保存
                      return updated
                    })
                  }

                  // 5. 关闭编辑器
                  closeImageViewer()
                  logInfo('[App] Edit confirmed (delayed save mode)', { index: currentImageIndex })
                }}
                onNavigate={(direction) => {
                  if (direction === 'prev') {
                    navigateImage('prev')
                  } else {
                    navigateImage('next')
                  }
                }}
              />
            )}

            {/* 查看模式 - 原有的图片查看器 (始终渲染，通过透明度控制显示/隐藏以实现平滑过渡) */}
            <div
              ref={imageViewerContainerRef}
              className={`absolute inset-0 flex items-center justify-center p-4 transition-opacity duration-400 ease-in-out ${isEditorMode ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
              style={{ overscrollBehavior: 'contain' }}
              onMouseMove={handleImageMouseMove}
              onMouseUp={handleImageMouseUp}
              onMouseLeave={handleImageMouseUp}
              onClick={(e) => {
                // 点击背景区域（不是图片内容）时关闭
                if (e.target === e.currentTarget) {
                  closeImageViewer()
                }
              }}
            >
              {/* 顶部编辑按钮 - 只有来自上传区域的图片才显示 */}
              {isFromUploadArea && (
                <div className="absolute top-8 left-1/2 -translate-x-1/2 z-10">
                  <button
                    onClick={async () => {
                      // 尝试加载历史编辑状态
                      if (!imageEditStatesRef.current.has(currentImage)) {
                        try {
                          const filename = currentImage.split('/').pop()
                          if (filename) {
                            const loaded = await loadEditState(filename)
                            if (loaded) {
                              // 兼容旧数据
                              if (loaded.originalDataUrl && !loaded.originalSrc) {
                                loaded.originalSrc = loaded.originalDataUrl
                                delete loaded.originalDataUrl
                              }
                              imageEditStatesRef.current.set(currentImage, loaded as ImageEditState)
                              logInfo('[App] Restore edit state success', filename)
                            }
                          }
                        } catch (e) {
                          logError('[App] Restore edit state failed', e)
                        }
                      }
                      setIsEditorMode(true)
                    }}
                    className="bg-[#131313]/90 backdrop-blur-xl px-4 py-2 rounded-full text-white text-sm border border-zinc-700/50 hover:bg-zinc-800/90 transition-colors flex items-center gap-2"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                    编辑图片
                  </button>
                </div>
              )}

              {/* 图片容器 */}
              <div className="relative">
                <img
                  ref={imageViewerRef}
                  src={currentImage}
                  alt="Full size"
                  className={`select-none image-transition`}
                  style={{
                    transform: viewerOpacity < 1
                      ? `scale(${imageScaleRef.current * (0.95 + 0.05 * viewerOpacity)}) translate(${imagePositionRef.current.x / imageScaleRef.current}px, ${imagePositionRef.current.y / imageScaleRef.current}px)`
                      : `scale(${imageScaleRef.current}) translate(${imagePositionRef.current.x / imageScaleRef.current}px, ${imagePositionRef.current.y / imageScaleRef.current}px)`,
                    transition: viewerOpacity < 1 ? 'transform 400ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 400ms ease' : 'none',
                    opacity: viewerOpacity,
                    transformOrigin: 'center',
                    width: '95vw',
                    height: '95vh',
                    objectFit: 'contain'
                  }}
                  onLoad={(e) => {
                    // 图片加载完成后，计算CSS缩放比例（相对于原始尺寸）
                    const img = e.currentTarget
                    if (img.naturalWidth && img.naturalHeight && img.offsetWidth && img.offsetHeight) {
                      // 计算objectFit: contain下的实际显示尺寸
                      const naturalRatio = img.naturalWidth / img.naturalHeight
                      const layoutRatio = img.offsetWidth / img.offsetHeight

                      let actualDisplayWidth
                      if (naturalRatio > layoutRatio) {
                        // 图片受宽度限制
                        actualDisplayWidth = img.offsetWidth
                      } else {
                        // 图片受高度限制
                        actualDisplayWidth = img.offsetHeight * naturalRatio
                      }

                      const cssScale = actualDisplayWidth / img.naturalWidth
                      cssScaleRef.current = cssScale
                      // imageScaleRef存储相对于布局尺寸的缩放，初始为1
                      imageScaleRef.current = 1
                      targetScaleRef.current = 1
                      imagePositionRef.current = { x: 0, y: 0 }
                      targetPositionRef.current = { x: 0, y: 0 }
                      updateImageTransform()
                    }
                  }}
                  onMouseDown={handleImageMouseDown}
                  onMouseMove={(e) => {
                    // 动态设置cursor样式：只有在实际图片内容上才显示手抓形状
                    const isOnContent = isClickOnImageContent(e)
                    e.currentTarget.style.cursor = isOnContent ? (isDragging ? 'grabbing' : 'grab') : 'default'
                  }}
                  onClick={(e) => {
                    // 判断是否点击在实际图片内容上
                    if (isClickOnImageContent(e)) {
                      // 点击图片内容，阻止冒泡，不关闭查看器
                      e.stopPropagation()
                    } else {
                      // 点击透明区域，直接关闭查看器
                      closeImageViewer()
                    }
                  }}
                  onContextMenu={(e) => {
                    const filePath = currentFilePathList[currentImageIndex]
                    showMenu(e, getImageMenuItems(currentImage, filePath))
                  }}
                  draggable={false}
                />
              </div>

              {/* 底部信息栏和切换按钮 - 移到查看器容器的直接子元素 */}
              <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3">
                {/* 切换按钮组 */}
                {currentImageList.length > 1 && (
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => navigateImage('prev')}
                      className="bg-zinc-800/80 hover:bg-zinc-700/80 backdrop-blur-sm text-white p-2 rounded-full transition-all duration-200"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <button
                      onClick={() => navigateImage('next')}
                      className="bg-zinc-800/80 hover:bg-zinc-700/80 backdrop-blur-sm text-white p-2 rounded-full transition-all duration-200"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                )}

                {/* 信息按钮组 */}
                <div className="flex items-center gap-4">
                  {/* 导航指示器和计数器 */}
                  {currentImageList.length > 1 && (
                    <div className="bg-[#131313]/90 backdrop-blur-xl px-4 py-2 rounded-full text-white text-sm border border-zinc-700/50">
                      {currentImageIndex + 1} / {currentImageList.length}
                    </div>
                  )}

                  {/* 缩放比例显示 */}
                  <div ref={scaleDisplayRef} className="bg-[#131313]/90 backdrop-blur-xl px-4 py-2 rounded-full text-white text-sm border border-zinc-700/50">
                    100%
                  </div>

                  {/* 重置按钮 */}
                  <button
                    onClick={resetImageView}
                    className="bg-[#131313]/90 backdrop-blur-xl px-4 py-2 rounded-full text-white text-sm border border-zinc-700/50 hover:bg-zinc-800/90 transition-colors"
                  >
                    重置视图
                  </button>

                  {/* 关闭按钮 */}
                  <button
                    onClick={closeImageViewer}
                    className="bg-[#131313]/90 backdrop-blur-xl px-4 py-2 rounded-full text-white text-sm border border-zinc-700/50 hover:bg-zinc-800/90 transition-colors"
                  >
                    关闭
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }

      {
        isVideoViewerOpen && (
          <div
            className={"fixed inset-0 bg黑/70 backdrop-blur-xl z-50 flex items-center justify-center p-4".replace('黑', 'black')}
            style={{ opacity: videoViewerOpacity, transition: 'opacity 500ms ease', overscrollBehavior: 'contain' }}
            onClick={(e) => {
              // 点击背景区域（不是视频内容）时关闭
              if (e.target === e.currentTarget) {
                closeVideoViewer()
              }
            }}
          >
            <div
              className={"relative max-w-6xl max-h-full flex items-center justify-center"}
              onMouseEnter={(e) => { setIsControlsVisible(true); if (controlsHideTimer.current) clearTimeout(controlsHideTimer.current); const inside = controlsContainerRef.current?.contains(e.target as Node); if (isVideoPlaying && !isSpeedMenuOpen && !isVolumeMenuOpen && !inside) controlsHideTimer.current = window.setTimeout(() => { if (!isSpeedMenuOpen && !isVolumeMenuOpen) setIsControlsVisible(false) }, 1500) }}
              onMouseMove={(e) => { setIsControlsVisible(true); if (controlsHideTimer.current) clearTimeout(controlsHideTimer.current); const inside = controlsContainerRef.current?.contains(e.target as Node); if (isVideoPlaying && !isSpeedMenuOpen && !isVolumeMenuOpen && !inside) controlsHideTimer.current = window.setTimeout(() => { if (!isSpeedMenuOpen && !isVolumeMenuOpen) setIsControlsVisible(false) }, 1500) }}
              onMouseLeave={() => { if (controlsHideTimer.current) { clearTimeout(controlsHideTimer.current); controlsHideTimer.current = null } if (!isSpeedMenuOpen) setIsControlsVisible(false) }}
              style={{ cursor: isVideoPlaying && !isSpeedMenuOpen && !isControlsVisible ? 'none' : 'default' }}
            >
              <div className="relative">
                {/* 音量指示器 */}
                <div
                  className="absolute top-4 left-4 bg-black/70 backdrop-blur-sm px-4 py-2 rounded-lg text-white z-10 flex items-center gap-2"
                  style={{ opacity: showVolumeIndicator ? 1 : 0, transition: 'opacity 200ms ease', pointerEvents: 'none' }}
                >
                  {muted || volume === 0 ? (
                    <svg viewBox="0 0 1024 1024" className="w-5 h-5" fill="currentColor">
                      <path d="M468.992 169.536c29.312-22.528 64.128-40.768 101.312-25.088 36.864 15.616 48.64 53.12 53.76 90.048 5.248 37.824 5.248 89.92 5.248 154.688v245.568c0 64.768 0 116.864-5.184 154.752-5.12 36.864-16.96 74.368-53.76 89.984-37.248 15.744-72.064-2.56-101.376-25.088-30.016-23.04-68.032-61.888-112.832-107.584-23.04-23.552-38.336-34.944-53.76-41.28-15.616-6.4-34.496-9.152-67.456-9.152-28.544 0-54.08 0-73.408-2.048-20.224-2.112-39.04-6.656-56-18.24-32.192-22.016-44.544-54.208-49.28-83.84C52.864 570.24 53.248 545.984 53.568 526.464v-28.928c-0.32-19.52-0.64-43.776 2.816-65.92 4.672-29.568 17.024-61.76 49.28-83.776 16.896-11.52 35.712-16.128 55.936-18.24 19.328-1.984 44.8-1.984 73.344-1.984 33.024 0 51.904-2.752 67.456-9.152 15.488-6.4 30.72-17.792 53.76-41.28 44.8-45.696 82.88-84.608 112.896-107.648z"></path>
                      <path d="M724.8 419.2a42.688 42.688 0 0 1 60.352 0l60.352 60.352 60.352-60.352a42.688 42.688 0 0 1 60.352 60.352L906.048 540.16l60.352 60.352a42.688 42.688 0 0 1-60.352 60.352l-60.352-60.352-60.352 60.352a42.688 42.688 0 0 1-60.352-60.352l60.352-60.352-60.352-60.608a42.688 42.688 0 0 1 0-60.352z"></path>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 1024 1024" className="w-5 h-5" fill="currentColor">
                      <path d="M468.992 169.536c29.312-22.528 64.128-40.768 101.312-25.088 36.864 15.616 48.64 53.12 53.76 90.048 5.248 37.824 5.248 89.92 5.248 154.688v245.568c0 64.768 0 116.864-5.184 154.752-5.12 36.864-16.96 74.368-53.76 89.984-37.248 15.744-72.064-2.56-101.376-25.088-30.016-23.04-68.032-61.888-112.832-107.584-23.04-23.552-38.336-34.944-53.76-41.28-15.616-6.4-34.496-9.152-67.456-9.152-28.544 0-54.08 0-73.408-2.048-20.224-2.112-39.04-6.656-56-18.24-32.192-22.016-44.544-54.208-49.28-83.84C52.864 570.24 53.248 545.984 53.568 526.464v-28.928c-0.32-19.52-0.64-43.776 2.816-65.92 4.672-29.568 17.024-61.76 49.28-83.776 16.896-11.52 35.712-16.128 55.936-18.24 19.328-1.984 44.8-1.984 73.344-1.984 33.024 0 51.904-2.752 67.456-9.152 15.488-6.4 30.72-17.792 53.76-41.28 44.8-45.696 82.88-84.608 112.896-107.648z"></path>
                      <path d="M699.52 350.08a42.688 42.688 0 0 1 59.776 8.064c32.256 42.24 51.392 95.872 51.392 153.856 0 57.92-19.136 111.552-51.392 153.856a42.688 42.688 0 1 1-67.84-51.712c21.056-27.648 33.92-63.104 33.92-102.144 0-39.04-12.864-74.496-33.92-102.144a42.688 42.688 0 0 1 8-59.776z"></path>
                      <path d="M884.8 269.824a42.688 42.688 0 1 0-62.912 57.6C868.736 378.688 896 442.88 896 512c0 69.12-27.264 133.312-74.112 184.512a42.688 42.688 0 0 0 62.912 57.6c59.904-65.344 96.512-149.632 96.512-242.112 0-92.48-36.608-176.768-96.512-242.176z"></path>
                    </svg>
                  )}
                  <span className="text-base font-medium">{Math.round((muted ? 0 : volume) * 100)}%</span>
                </div>
                <video
                  ref={videoRef}
                  src={currentVideoUrl}
                  className="object-contain"
                  style={{ maxHeight: '90vh', maxWidth: '90vw', opacity: videoViewerOpacity, transition: 'opacity 500ms ease' }}
                  onLoadedMetadata={() => { if (videoRef.current) { setVideoDuration(videoRef.current.duration || 0); if (autoPlayOnOpen) { videoRef.current.play().catch(() => { }); setAutoPlayOnOpen(false) } } }}
                  onTimeUpdate={() => { if (videoRef.current) setCurrentTime(videoRef.current.currentTime || 0) }}
                  onPlaying={() => { setIsBuffering(false); setIsVideoPlaying(true) }}
                  onPause={() => { setIsVideoPlaying(false) }}
                  onWaiting={() => { setIsBuffering(true) }}
                  onStalled={() => { setIsBuffering(true) }}
                  onClick={() => { if (videoRef.current) { if (isVideoPlaying) videoRef.current.pause(); else videoRef.current.play() } }}
                  onWheel={(e) => { e.preventDefault(); const delta = e.deltaY > 0 ? -0.05 : 0.05; const newVolume = Math.min(1, Math.max(0, volume + delta)); setMuted(false); setVolume(newVolume); setShowVolumeIndicator(true); if (volumeIndicatorTimer.current) clearTimeout(volumeIndicatorTimer.current); volumeIndicatorTimer.current = window.setTimeout(() => setShowVolumeIndicator(false), 1000) }}
                  controls={false}
                />
                <button
                  onClick={closeVideoViewer}
                  className="absolute top-2 right-2 bg-zinc-800/80 hover:bg-zinc-700/80 text-white p-2 rounded-full transition-all duration-200 z-10"
                  style={{ pointerEvents: 'auto' }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div ref={controlsContainerRef} className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[90%] max-w-3xl" style={{ opacity: isSpeedMenuOpen || isVolumeMenuOpen || isControlsVisible ? 1 : 0, transition: 'opacity 500ms ease', pointerEvents: isSpeedMenuOpen || isVolumeMenuOpen || isControlsVisible ? 'auto' : 'none' }}>
                <div className="bg-[#131313]/90 border border-zinc-700/50 rounded-xl px-4 py-3 text-white flex flex-col gap-3">
                  <div
                    ref={progressBarRef}
                    className="progress-container"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setIsDraggingProgress(true)
                      const el = progressBarRef.current
                      if (!el || !videoDuration) return
                      const rect = el.getBoundingClientRect()
                      const percent = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
                      const t = percent * videoDuration
                      setCurrentTime(t)
                      if (videoRef.current) videoRef.current.currentTime = t
                      if (progressFillRef.current) progressFillRef.current.style.width = `${percent * 100}%`
                    }}
                    onMouseMove={(e) => {
                      if (!isDraggingProgress) return
                      const el = progressBarRef.current
                      if (!el || !videoDuration) return
                      const rect = el.getBoundingClientRect()
                      const percent = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
                      const t = percent * videoDuration
                      setCurrentTime(t)
                      if (videoRef.current) videoRef.current.currentTime = t
                      if (progressFillRef.current) progressFillRef.current.style.width = `${percent * 100}%`
                    }}
                    onMouseUp={() => setIsDraggingProgress(false)}
                    onMouseLeave={() => setIsDraggingProgress(false)}
                  >
                    <div ref={progressFillRef} className="progress-bar" />
                  </div>
                  <div className="controls-main">
                    <button
                      onClick={() => { if (videoRef.current) { if (isVideoPlaying) videoRef.current.pause(); else videoRef.current.play() } }}
                      className="btn btn-play"
                    >
                      {isVideoPlaying ? (
                        <svg viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                      )}
                    </button>
                    <div className="time-display">{formatTime(currentTime)} / {formatTime(videoDuration)}</div>
                    <div className="controls-right">
                      <div className="speed-control" onMouseEnter={() => setIsVolumeMenuOpen(true)} onMouseLeave={() => setIsVolumeMenuOpen(false)}>
                        <div ref={volumeDisplayRef} className="speed-display" onClick={() => setMuted(m => !m)} title={muted ? '取消静音' : '静音'}>
                          {muted || volume === 0 ? (
                            <svg viewBox="0 0 1024 1024">
                              <path d="M468.992 169.536c29.312-22.528 64.128-40.768 101.312-25.088 36.864 15.616 48.64 53.12 53.76 90.048 5.248 37.824 5.248 89.92 5.248 154.688v245.568c0 64.768 0 116.864-5.184 154.752-5.12 36.864-16.96 74.368-53.76 89.984-37.248 15.744-72.064-2.56-101.376-25.088-30.016-23.04-68.032-61.888-112.832-107.584-23.04-23.552-38.336-34.944-53.76-41.28-15.616-6.4-34.496-9.152-67.456-9.152-28.544 0-54.08 0-73.408-2.048-20.224-2.112-39.04-6.656-56-18.24-32.192-22.016-44.544-54.208-49.28-83.84C52.864 570.24 53.248 545.984 53.568 526.464v-28.928c-0.32-19.52-0.64-43.776 2.816-65.92 4.672-29.568 17.024-61.76 49.28-83.776 16.896-11.52 35.712-16.128 55.936-18.24 19.328-1.984 44.8-1.984 73.344-1.984 33.024 0 51.904-2.752 67.456-9.152 15.488-6.4 30.72-17.792 53.76-41.28 44.8-45.696 82.88-84.608 112.896-107.648z" fill="currentColor"></path>
                              <path d="M724.8 419.2a42.688 42.688 0 0 1 60.352 0l60.352 60.352 60.352-60.352a42.688 42.688 0 0 1 60.352 60.352L906.048 540.16l60.352 60.352a42.688 42.688 0 0 1-60.352 60.352l-60.352-60.352-60.352 60.352a42.688 42.688 0 0 1-60.352-60.352l60.352-60.352-60.352-60.608a42.688 42.688 0 0 1 0-60.352z" fill="currentColor"></path>
                            </svg>
                          ) : (
                            <svg viewBox="0 0 1024 1024">
                              <path d="M468.992 169.536c29.312-22.528 64.128-40.768 101.312-25.088 36.864 15.616 48.64 53.12 53.76 90.048 5.248 37.824 5.248 89.92 5.248 154.688v245.568c0 64.768 0 116.864-5.184 154.752-5.12 36.864-16.96 74.368-53.76 89.984-37.248 15.744-72.064-2.56-101.376-25.088-30.016-23.04-68.032-61.888-112.832-107.584-23.04-23.552-38.336-34.944-53.76-41.28-15.616-6.4-34.496-9.152-67.456-9.152-28.544 0-54.08 0-73.408-2.048-20.224-2.112-39.04-6.656-56-18.24-32.192-22.016-44.544-54.208-49.28-83.84C52.864 570.24 53.248 545.984 53.568 526.464v-28.928c-0.32-19.52-0.64-43.776 2.816-65.92 4.672-29.568 17.024-61.76 49.28-83.776 16.896-11.52 35.712-16.128 55.936-18.24 19.328-1.984 44.8-1.984 73.344-1.984 33.024 0 51.904-2.752 67.456-9.152 15.488-6.4 30.72-17.792 53.76-41.28 44.8-45.696 82.88-84.608 112.896-107.648z" fill="currentColor"></path>
                              <path d="M699.52 350.08a42.688 42.688 0 0 1 59.776 8.064c32.256 42.24 51.392 95.872 51.392 153.856 0 57.92-19.136 111.552-51.392 153.856a42.688 42.688 0 1 1-67.84-51.712c21.056-27.648 33.92-63.104 33.92-102.144 0-39.04-12.864-74.496-33.92-102.144a42.688 42.688 0 0 1 8-59.776z" fill="currentColor"></path>
                              <path d="M884.8 269.824a42.688 42.688 0 1 0-62.912 57.6C868.736 378.688 896 442.88 896 512c0 69.12-27.264 133.312-74.112 184.512a42.688 42.688 0 0 0 62.912 57.6c59.904-65.344 96.512-149.632 96.512-242.112 0-92.48-36.608-176.768-96.512-242.176z" fill="currentColor"></path>
                            </svg>
                          )}
                        </div>
                        <div ref={volumeMenuRef} className={`speed-menu volume-menu ${isVolumeMenuOpen ? 'active' : ''}`} onWheel={(e) => { e.preventDefault(); const d = e.deltaY > 0 ? -0.05 : 0.05; const next = Math.min(1, Math.max(0, (muted ? 0 : volume) + d)); setMuted(false); setVolume(next) }}>
                          <div className="volume-vertical">
                            <div className="volume-percent">{Math.round((muted ? 0 : volume) * 100)}</div>
                            <div className="volume-track" onClick={(e) => { const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); const percent = 1 - Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)); const v = percent; setMuted(false); setVolume(v) }}>
                              <div className="volume-fill" style={{ height: `calc(5px + (100% - 10px) * ${muted ? 0 : volume})` }}></div>
                              <div className="volume-thumb" style={{ bottom: `calc(5px + (100% - 10px) * ${muted ? 0 : volume})` }}></div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="speed-control" onMouseEnter={() => setIsSpeedMenuOpen(true)} onMouseLeave={() => setIsSpeedMenuOpen(false)}>
                        <div ref={speedDisplayRef} className="speed-display">{playbackRate}x</div>
                        <div ref={speedMenuRef} className={`speed-menu ${isSpeedMenuOpen ? 'active' : ''}`}>
                          {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map(s => (
                            <div key={s} className={`speed-option ${playbackRate === s ? 'active' : ''}`} onClick={() => { setPlaybackRate(s); setIsSpeedMenuOpen(false) }}>{s}x</div>
                          ))}
                        </div>
                      </div>
                      <button className={`btn btn-small ${loop ? 'loop-active' : ''}`} onClick={() => setLoop(l => !l)}>
                        <svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" /></svg>
                      </button>
                      <button className="btn btn-small" onClick={() => downloadVideo(currentVideoUrl)}>
                        <svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" /></svg>
                      </button>
                    </div>
                  </div>
                </div>
                {isBuffering && (<div className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs text-zinc-300">缓冲中...</div>)}
              </div>
            </div>
          </div>
        )
      }

      {/* 右键菜单 */}
      <ContextMenu
        items={menuItems}
        position={menuPosition}
        visible={menuVisible}
        onClose={hideMenu}
      />

      {/* 设置模态框 */}
      {
        isSettingsOpen && (
          <SettingsModal onClose={closeSettings} />
        )
      }

      {/* 测试模式指示器 */}
      <TestModeIndicator onOpenPanel={() => setIsTestPanelOpen(true)} />

      {/* 测试模式参数显示窗口 */}
      <TestModeParamsDisplay />

      {/* 测试模式面板 */}
      <TestModePanel
        isOpen={isTestPanelOpen}
        onClose={() => setIsTestPanelOpen(false)}
      />

      {/* 更新提示对话框 */}
      {
        showUpdateDialog && updateReleaseInfo && (
          <UpdateDialog
            releaseInfo={updateReleaseInfo}
            currentVersion={getCurrentVersion()}
            onClose={() => setShowUpdateDialog(false)}
          />
        )
      }
    </div >
  )
}

export default ConversationWorkspace
