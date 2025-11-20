import React, { useState, useEffect, useRef } from 'react'
import { apiService } from './services/api'
import MediaGenerator from './components/MediaGenerator'
import SettingsModal from './components/SettingsModal'
import ContextMenu from './components/ContextMenu'
import { MediaResult } from './types'
import { isDesktop, saveImageFromUrl, saveAudioFromUrl, fileToBlobSrc, fileToDataUrl, readJsonFromAppData, writeJsonToAppData, downloadMediaFile, deleteWaveformCacheForAudio } from './utils/save'
import { convertBlobToPng } from './utils/imageConversion'
import { convertFileSrc } from '@tauri-apps/api/core'
import WindowControls from './components/WindowControls'
import AudioPlayer from './components/AudioPlayer'
import { remove } from '@tauri-apps/plugin-fs'
import { useDragDrop } from './contexts/DragDropContext'
import { useContextMenu, MenuItem } from './hooks/useContextMenu'
import { providers } from './config/providers'

// 定义生成任务类型
interface GenerationTask {
  id: string
  type: 'image' | 'video' | 'audio'
  prompt: string
  model: string  // 保存使用的模型
  provider?: string  // 保存供应商信息（用于继续查询）
  images?: string[]
  size?: string
  status: 'pending' | 'generating' | 'success' | 'error' | 'timeout'  // 添加 timeout 状态
  result?: MediaResult
  error?: string
  uploadedFilePaths?: string[]
  progress?: number
  requestId?: string
  modelId?: string
  message?: string
  options?: any
  serverTaskId?: string
  timedOut?: boolean
}

const App: React.FC = () => {
  const { startDrag } = useDragDrop()
  const isDraggingRef = useRef(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [tasks, setTasks] = useState<GenerationTask[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
  const tasksEndRef = React.useRef<HTMLDivElement>(null)
  const listContainerRef = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const imageViewerRef = React.useRef<HTMLImageElement>(null)
  const imageViewerContainerRef = React.useRef<HTMLDivElement>(null)
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

  const speedDisplayRef = React.useRef<HTMLDivElement>(null)
  const speedMenuRef = React.useRef<HTMLDivElement>(null)
  const volumeDisplayRef = React.useRef<HTMLDivElement>(null)
  const volumeMenuRef = React.useRef<HTMLDivElement>(null)

  const controlsContainerRef = React.useRef<HTMLDivElement>(null)
  const [autoPlayOnOpen, setAutoPlayOnOpen] = useState(false)
  const inputContainerRef = React.useRef<HTMLDivElement>(null)
  const [inputPadding, setInputPadding] = useState<number>(400)

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
      setInputPadding(h + 24)
      listEl.style.paddingBottom = `${h + 24}px`
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(inputEl)
    return () => { ro.disconnect() }
  }, [])

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
      scaleDisplayRef.current.innerText = `${Math.round(scale * 100)}%`
    }
  }

  // 图片查看器滚轮缩放（使用原生事件避免 passive 警告）
  useEffect(() => {
    const container = imageViewerContainerRef.current
    if (!container || !isImageViewerOpen) return

    const handleWheel = (e: WheelEvent) => {
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
    if (!isVolumeMenuOpen) return
    const handler = (e: MouseEvent) => {
      const d = volumeDisplayRef.current
      const m = volumeMenuRef.current
      const t = e.target as Node
      if (d && m && t && !d.contains(t) && !m.contains(t)) setIsVolumeMenuOpen(false)
    }
    document.addEventListener('click', handler)
    return () => { document.removeEventListener('click', handler) }
  }, [isVolumeMenuOpen])



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

  const copyImageToClipboard = async (imageUrl: string) => {
    try {
      const response = await fetch(imageUrl)
      let blob = await response.blob()

      // 确保转换为 PNG，因为 Clipboard API 主要支持 PNG
      if (blob.type !== 'image/png') {
        try {
          blob = await convertBlobToPng(blob)
        } catch (e) {
          console.error('Image conversion failed:', e)
          throw new Error('图片格式转换失败')
        }
      }

      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': blob
        })
      ])
    } catch (err) {
      console.error('Copy failed:', err)
      setError('复制图片失败: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  // 生成图片右键菜单项
  const getImageMenuItems = (imageUrl: string, filePath?: string): MenuItem[] => [
    {
      id: 'copy-image',
      label: '复制图片',
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      ),
      onClick: () => copyImageToClipboard(imageUrl)
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
          try {
            await downloadMediaFile(filePath)
          } catch (err) {
            console.error('Download image failed:', err)
          }
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
          try {
            await downloadMediaFile(filePath)
          } catch (err) {
            console.error('Download video failed:', err)
          }
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
          try {
            await downloadMediaFile(filePath)
          } catch (err) {
            console.error('Download audio failed:', err)
          }
        }
      },
      disabled: !filePath
    }
  ]

  // 全局禁用默认右键菜单（但允许视频播放器使用原生菜单）
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
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


  // 图片拖动开始
  const handleImageMouseDown = (e: React.MouseEvent) => {
    // 只响应左键点击
    if (e.button === 0) {
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

  // 历史记录图片拖拽开始 (使用自定义拖拽)
  const handleHistoryImageDragStart = (e: React.MouseEvent, imageUrl: string) => {
    e.preventDefault()
    const initialX = e.clientX
    const initialY = e.clientY

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = Math.abs(moveEvent.clientX - initialX)
      const deltaY = Math.abs(moveEvent.clientY - initialY)
      // If moved more than 5 pixels, consider it a drag
      if (deltaX > 5 || deltaY > 5) {
        isDraggingRef.current = true
        startDrag(
          {
            type: 'image',
            imageUrl,
            sourceType: 'history'
          },
          imageUrl
        )
        // Remove listeners after starting drag
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      // Reset dragging flag after a short delay (onClick fires after mouseup)
      setTimeout(() => {
        isDraggingRef.current = false
      }, 100)
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

  const handleGenerate = async (input: string, model: string, type: 'image' | 'video' | 'audio', options?: any) => {
    if (!input.trim() && (!options || !options.images || options.images.length === 0)) {
      setError('请输入内容或上传图片')
      return
    }

    // 创建 sanitizedOptions，移除 base64 图片数据以防止 history.json 膨胀
    const sanitizedOptions = { ...options }
    if (sanitizedOptions && sanitizedOptions.images) {
      delete sanitizedOptions.images
    }

    // 查找供应商信息
    const providerObj = providers.find(p => p.models.some(m => m.id === model))
    const providerId = providerObj?.id

    // 创建新的生成任务
    const taskId = Date.now().toString()
    const newTask: GenerationTask = {
      id: taskId,
      type,
      prompt: input,
      model,  // 保存模型信息
      provider: providerId, // 保存供应商信息
      images: options?.images,
      size: options?.size,
      uploadedFilePaths: options?.uploadedFilePaths,
      status: 'pending',
      progress: 0,
      options: sanitizedOptions, // 保存清洗后的参数
    }

    // 立即添加到任务列表（最新的在最后）
    setTasks(prev => [...prev, newTask])
    setError(null)

    try {
      setIsLoading(true)

      // 动态初始化适配器（根据模型判断供应商）
      const providerObj = providers.find(p => p.models.some(m => m.id === model))
      if (providerObj) {
        const providerType = providerObj.id as 'piaoyun' | 'fal'

        // 获取对应的 API Key
        let apiKey = ''
        if (providerType === 'fal') {
          apiKey = localStorage.getItem('fal_api_key') || ''
        } else {
          apiKey = localStorage.getItem('piaoyun_api_key') || ''
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

        console.log('[App] 已切换适配器:', { provider: providerType, model })
      }

      // 更新任务状态为生成中
      setTasks(prev => prev.map(task =>
        task.id === taskId ? { ...task, status: 'generating' } : task
      ))

      let result: any
      switch (type) {
        case 'image':
          result = await apiService.generateImage(input, model, options)

          // 检查是否为 fal 队列超时状态
          if (result?.status === 'timeout') {
            console.log('[App] 检测到队列超时:', result)
            setTasks(prev => prev.map(task =>
              task.id === taskId ? {
                ...task,
                status: 'timeout',
                provider: providerObj?.id,
                requestId: result.requestId,
                modelId: result.modelId,
                message: result.message || '等待超时，任务依然在处理中'
              } : task
            ))
            setIsLoading(false)
            return  // 提前返回，不继续处理
          }

          console.log('[App] 尝试本地保存，ua=', typeof navigator !== 'undefined' ? navigator.userAgent : '')
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
              console.log('[App] 本地保存成功并替换展示地址')
            } catch (e) {
              console.error('[App] 本地保存失败，回退在线地址', e)
            }
          }
          break
        case 'video':
          result = await apiService.generateVideo(input, model, options)
          if (result.taskId) {
            setTasks(prev => prev.map(t => t.id === taskId ? { ...t, serverTaskId: result.taskId } : t))
            result = await pollTaskStatus(result.taskId, taskId, model)
          }
          break
        case 'audio':
          console.log('[App] generateAudio 调用参数:', { input, model, options })
          result = await apiService.generateAudio(input, model, options)
          if (result && result.url && isDesktop()) {
            try {
              const { fullPath } = await saveAudioFromUrl(result.url)
              const blobSrc = await fileToBlobSrc(fullPath, 'audio/mpeg')
              result.url = blobSrc
                ; (result as any).filePath = fullPath
              console.log('[App] 本地保存成功并替换展示地址')
            } catch (e) {
              console.error('[App] 本地保存失败，回退在线地址', e)
            }
          }
          break
        default:
          throw new Error('Unsupported media type')
      }

      // 更新任务状态为成功
      if (result && result.url) {
        setTasks(prev => prev.map(task =>
          task.id === taskId ? {
            ...task,
            status: 'success',
            progress: 100,
            result: {
              id: taskId,
              type,
              url: result.url,
              filePath: (result as any).filePath,
              prompt: input,
              createdAt: new Date()
            }
          } : task
        ))
      }
    } catch (err) {
      console.error('[App] 生成失败:', err)
      // 更新任务状态为错误
      setTasks(prev => prev.map(task =>
        task.id === taskId ? {
          ...task,
          status: 'error',
          error: err instanceof Error ? err.message : '生成失败'
        } : task
      ))
    } finally {
      setIsLoading(false)
    }
  }

  const pollTaskStatus = async (serverTaskId: string, uiTaskId: string, model?: string): Promise<any> => {
    console.log('[App] 开始轮询任务状态:', serverTaskId)
    return new Promise((resolve, reject) => {
      let pollCount = 0
      const maxPolls = 120

      const interval = setInterval(async () => {
        try {
          pollCount++
          console.log(`[App] 第${pollCount}次轮询任务状态:`, serverTaskId)

          const status = await apiService.checkTaskStatus(serverTaskId)

          // 注意：API返回的是 TASK_STATUS_SUCCEED，不是 TASK_STATUS_SUCCEEDED
          if ((status.status === 'TASK_STATUS_SUCCEEDED' || status.status === 'TASK_STATUS_SUCCEED') && status.result) {
            console.log('[App] 任务完成:', status.result)
            clearInterval(interval)
            setTasks(prev => prev.map(t => t.id === uiTaskId ? { ...t, progress: 100, timedOut: false } : t))
            resolve(status.result)
          } else if (status.status === 'TASK_STATUS_FAILED') {
            console.error('[App] 任务失败')
            clearInterval(interval)
            reject(new Error('任务执行失败'))
          } else if (pollCount >= maxPolls) {
            if (status.status === 'TASK_STATUS_PROCESSING' || status.status === 'TASK_STATUS_QUEUED') {
              console.warn('[App] 轮询超时，仍在处理中，提供重试')
              clearInterval(interval)
              setTasks(prev => prev.map(t => t.id === uiTaskId ? { ...t, timedOut: true } : t))
              resolve(null)
            } else {
              console.error('[App] 轮询超时')
              clearInterval(interval)
              reject(new Error('任务超时'))
            }
          } else {
            console.log('[App] 任务进行中...', {
              status: status.status,
              progress: status.progress
            })
            if (model === 'vidu-q1') {
              const t = pollCount / maxPolls
              const stepProgress = Math.round(95 * (1 - Math.pow(1 - t, 3)))
              setTasks(prev => prev.map(t => {
                if (t.id !== uiTaskId) return t
                const inc = Math.max(1, stepProgress)
                const next = Math.min(95, Math.max((t.progress ?? 0) + 1, inc))
                return { ...t, progress: next }
              }))
            } else {
              const t = pollCount / maxPolls
              const stepProgress = Math.round(95 * (1 - Math.pow(1 - t, 3)))
              setTasks(prev => prev.map(t => {
                if (t.id !== uiTaskId) return t
                const inc = Math.max(1, stepProgress)
                const next = Math.min(95, Math.max((t.progress ?? 0) + 1, inc))
                return { ...t, progress: next }
              }))
            }
          }
        } catch (err) {
          console.error('[App] 轮询错误:', err)
          clearInterval(interval)
          reject(err)
        }
      }, 3000)
    })
  }

  const retryPolling = async (task: GenerationTask) => {
    if (!task.serverTaskId) {
      console.error('[App] 无 serverTaskId，无法重试轮询')
      return
    }
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, timedOut: false } : t))
    try {
      const result = await pollTaskStatus(task.serverTaskId, task.id, task.model)
      if (result && result.url) {
        setTasks(prev => prev.map(t => t.id === task.id ? {
          ...t,
          status: 'success',
          progress: 100,
          result: {
            id: task.id,
            type: 'video',
            url: result.url,
            filePath: (result as any).filePath,
            prompt: t.prompt,
            createdAt: new Date()
          }
        } : t))
      }
    } catch (e) {
      console.error('[App] 重试轮询失败', e)
    }
  }

  const openSettings = () => {
    setIsSettingsOpen(true)
  }

  const closeSettings = () => {
    setIsSettingsOpen(false)
  }

  const openImageViewer = (imageUrl: string, imageList?: string[], filePaths?: string[]) => {
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
    // 打开时重置缩放和位置
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
      document.body.style.overflow = ''
    }, 200)
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

    // 直接硬切换图片,不重置缩放和位置
    setCurrentImageIndex(newIndex)
    setCurrentImage(currentImageList[newIndex])
  }

  // 重置图片视图到适应窗口大小
  const resetImageView = () => {
    imageScaleRef.current = 1
    imagePositionRef.current = { x: 0, y: 0 }
    targetScaleRef.current = 1
    targetPositionRef.current = { x: 0, y: 0 }
    updateImageTransform()
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
      console.error('Video download failed', err)
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
      const fileHistory = isDesktop() ? await readJsonFromAppData<any[]>('Henji-AI/history.json') : null
      const store = fileHistory ?? (() => { try { return JSON.parse(localStorage.getItem('generationTasks') || '[]') } catch { return [] } })()
      const loaded = (store || []).map((task: any) => {
        let result = task.result
        if (result && result.filePath && isDesktop()) {
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
        let images = task.images
        if ((!images || images.length === 0) && task.uploadedFilePaths && task.uploadedFilePaths.length && isDesktop()) {
          try {
            images = task.uploadedFilePaths.map((p: string) => convertFileSrc(p))
          } catch { }
        }
        return {
          ...task,
          status: task.status === 'generating' || task.status === 'pending' ? 'error' : task.status,
          error: task.status === 'generating' || task.status === 'pending' ? '页面刷新后生成中断' : task.error,
          result: result ? { ...result, createdAt: result.createdAt ? new Date(result.createdAt) : new Date() } : undefined,
          images
        }
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

  // 保存历史到文件（避免本地存储配额）
  useEffect(() => {
    if (!isTasksLoaded) return
    if (!isDesktop()) return
    const tasksToSave = tasks.filter(t => t.status === 'success' || t.status === 'error' || t.status === 'timeout' || t.status === 'pending' || t.status === 'generating')
      .map(t => ({
        id: t.id,
        type: t.type,
        prompt: t.prompt,
        model: t.model,
        provider: t.provider, // 保存供应商信息
        size: t.size,
        status: t.status,
        error: t.error,
        uploadedFilePaths: t.uploadedFilePaths,
        options: t.options, // 保存生成参数
        requestId: t.requestId, // 保存请求ID（用于超时恢复）
        modelId: t.modelId, // 保存模型ID（用于超时恢复）
        message: t.message, // 保存状态消息
        result: t.result ? {
          id: t.result.id,
          type: t.result.type,
          filePath: t.result.filePath,
          prompt: t.result.prompt,
          createdAt: t.result.createdAt
        } : undefined
      }))
    const maxHistory = parseInt(localStorage.getItem('max_history_count') || '50', 10)
    const limitedTasks = tasksToSave.slice(-maxHistory)
    writeJsonToAppData('Henji-AI/history.json', limitedTasks).catch(e => console.error('write history failed', e))
  }, [tasks, isTasksLoaded])

  // 检查是否有保存的API密钥
  useEffect(() => {
    const savedApiKey = localStorage.getItem('piaoyun_api_key')
    if (savedApiKey) {
      apiService.setApiKey(savedApiKey)
      // 默认初始化派欧云适配器
      try {
        apiService.initializeAdapter({
          type: 'piaoyun',
          modelName: 'seedream-4.0'
        })
      } catch (err) {
        console.error('Failed to initialize adapter:', err)
      }
    }
  }, [])



  const handleRegenerate = async (task: GenerationTask) => {
    // 复用原来的参数重新生成，使用任务保存的模型
    const options = {
      images: task.images,
      size: task.size
    }

    console.log('[App] 重新生成任务:', {
      model: task.model,
      type: task.type,
      prompt: task.prompt,
      options
    })

    await handleGenerate(task.prompt, task.model, task.type, options)
  }

  const handleReedit = async (task: GenerationTask) => {
    let images: string[] | undefined = undefined
    if (task.uploadedFilePaths && task.uploadedFilePaths.length) {
      try {
        const arr: string[] = []
        for (const p of task.uploadedFilePaths) {
          const data = await fileToDataUrl(p)
          arr.push(data)
        }
        images = arr
      } catch { }
    } else if (task.images && task.images.length) {
      if (task.images.some(img => typeof img === 'string' && !img.startsWith('data:')) && task.uploadedFilePaths && task.uploadedFilePaths.length) {
        try {
          const arr: string[] = []
          for (const p of task.uploadedFilePaths) {
            const data = await fileToDataUrl(p)
            arr.push(data)
          }
          images = arr
        } catch {
          images = task.images
        }
      } else {
        images = task.images
      }
    }

    window.dispatchEvent(new CustomEvent('reedit-content', {
      detail: {
        prompt: task.prompt,
        images,
        uploadedFilePaths: task.uploadedFilePaths,
        model: task.model,
        provider: task.provider,
        options: task.options
      }
    }))
  }

  const handleContinuePolling = async (task: GenerationTask) => {

    console.log('[App] 继续查询 fal 队列:', { requestId: task.requestId, modelId: task.modelId })

    try {
      // 更新任务状态为生成中
      setTasks(prev => prev.map(t =>
        t.id === task.id ? { ...t, status: 'generating' } : t
      ))
      setIsLoading(true)

      // 初始化 fal 适配器
      const apiKey = localStorage.getItem('fal_api_key') || ''
      if (!apiKey) {
        throw new Error('请先在设置中配置 fal 的 API Key')
      }

      apiService.setApiKey(apiKey)
      apiService.initializeAdapter({
        type: 'fal',
        modelName: task.model
      })

      // 调用 continuePolling 方法
      const adapter = apiService.getAdapter() as any
      if (!adapter.continuePolling) {
        throw new Error('当前适配器不支持继续查询')
      }

      const result = await adapter.continuePolling(
        task.modelId,
        task.requestId,
        (status: any) => {
          console.log('[App] 继续查询进度:', status.message)
        }
      )

      // 再次检查是否超时
      if (result?.status === 'timeout') {
        console.log('[App] 再次超时')
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
          console.log('[App] 本地保存成功')
        } catch (e) {
          console.error('[App] 本地保存失败', e)
        }
      }

      // 更新任务为成功状态
      setTasks(prev => prev.map(t =>
        t.id === task.id ? {
          ...t,
          status: 'success',
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
      console.error('[App] 继续查询失败:', err)
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
      const files: string[] = []
      const audioPaths: string[] = []
      tasks.forEach(t => {
        const p = t.result?.filePath
        if (p) {
          if (p.includes('|||')) files.push(...p.split('|||'))
          else files.push(p)
          if (t.result?.type === 'audio') {
            if (p.includes('|||')) audioPaths.push(...p.split('|||'))
            else audioPaths.push(p)
          }
        }
        if (t.uploadedFilePaths && t.uploadedFilePaths.length) {
          files.push(...t.uploadedFilePaths)
        }
      })
      for (const f of files) {
        try { await remove(f) } catch (e) { console.error('[App] 删除文件失败', f, e) }
      }
      for (const ap of audioPaths) {
        try { await deleteWaveformCacheForAudio(ap) } catch (e) { console.error('[App] 删除波形缓存失败', ap, e) }
      }
    } finally {
      clearAllHistory()
    }
  }

  // 删除单条历史记录
  const deleteTask = async (taskId: string) => {
    const target = tasks.find(t => t.id === taskId)
    if (target?.result?.filePath) {
      const paths = target.result.filePath.includes('|||') ? target.result.filePath.split('|||') : [target.result.filePath]
      for (const p of paths) {
        try { await remove(p) } catch (e) { console.error('[App] 删除单条文件失败', p, e) }
      }
      if (target?.result?.type === 'audio') {
        for (const p of paths) {
          try { await deleteWaveformCacheForAudio(p) } catch (e) { console.error('[App] 删除单条波形缓存失败', p, e) }
        }
      }
    }
    if (target?.uploadedFilePaths && target.uploadedFilePaths.length) {
      for (const p of target.uploadedFilePaths) {
        try { await remove(p) } catch (e) { console.error('[App] 删除单条上传文件失败', p, e) }
      }
    }
    setTasks(prev => prev.filter(task => task.id !== taskId))
  }

  return (
    <div className="min-h-screen bg-[#0a0b0d] text-white flex flex-col relative overflow-hidden">
      <WindowControls />
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
                                <div key={index} className="w-16 h-16 rounded border border-zinc-700/50 overflow-hidden">
                                  <img
                                    src={image}
                                    alt={`Input ${index + 1}`}
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                              ))}
                              {task.images.length > 3 && (
                                <div className="w-16 h-16 rounded border border-zinc-700/50 bg-zinc-700/50 flex items-center justify-center text-xs">
                                  +{task.images.length - 3}
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
                                {task.model}
                              </span>
                              {task.size && (
                                <span className="text-xs bg-zinc-700/50 px-2 py-1 rounded">
                                  {task.size}
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
                              {/* 进度条仅在视频生成时显示 */}
                              {task.type === 'video' && (
                                <>
                                  <div className="w-full h-2 bg-zinc-700 rounded">
                                    <div
                                      className="h-2 bg-[#007eff] rounded transition-all duration-[2800ms] ease-out"
                                      style={{ width: `${Math.min(100, Math.max(0, task.progress || 0))}%` }}
                                    ></div>
                                  </div>
                                  <div className="mt-2 text-sm text-zinc-400">{Math.min(100, Math.max(0, Math.floor(task.progress || 0)))}%</div>
                                </>
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
                              <p className="text-zinc-400 text-sm mb-4">图片可能还在生成中，您可以继续查询状态</p>
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
                              className="flex gap-2 overflow-x-auto max-w-full pb-2 image-strip"
                              style={{
                                scrollbarWidth: 'thin',
                                scrollbarColor: '#4B5563 #1F2937'
                              }}
                              onWheel={(e) => {
                                // 鼠标停留在图片区域时，滚轮变为横向滚动
                                if (e.deltaY !== 0) {
                                  e.currentTarget.scrollLeft += e.deltaY
                                }
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
                                            handleHistoryImageDragStart(e, url)
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
                                        handleHistoryImageDragStart(e, task.result!.url)
                                      }}
                                      draggable={false}
                                    />
                                  </div>
                                )
                              )}
                              {task.result.type === 'video' && (
                                <div
                                  className="relative w-64 h-64 bg-[#1B1C21] rounded-lg overflow-hidden border border-zinc-700/50 flex items-center justify-center cursor-pointer"
                                  onClick={() => openVideoViewer(task.result!.url, (task.result as any).filePath)}
                                  onContextMenu={(e) => showMenu(e, getVideoThumbnailMenuItems(task.result!.filePath))}
                                >
                                  <video
                                    src={task.result.url}
                                    className="max-w-full max-h-full object-contain"
                                  />
                                  <div className="absolute inset-0 flex items-center justify-center">
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
        </div>

        {/* 错误提示 */}
        {
          error && (
            <div className="mx-4 mb-4 p-3 bg-red-900/50 backdrop-blur-lg border border-red-700/50 rounded-xl shadow-lg animate-shake">
              <p className="text-red-200">{error}</p>
            </div>
          )
        }

        {/* 输入区域 - 悬浮设计 */}
        <div ref={inputContainerRef} className="fixed bottom-6 left-1/2 transform -translate-x-1/2 w-[95%] max-w-5xl z-20">
          <div className="bg-[#131313]/70 backdrop-blur-xl border border-zinc-700/50 rounded-2xl shadow-2xl p-4 hover:shadow-3xl transition-all duration-300">
            <MediaGenerator
              onGenerate={handleGenerate}
              isLoading={isLoading}
              onOpenSettings={openSettings}
              onOpenClearHistory={() => setIsConfirmClearOpen(true)}
            />
          </div>
        </div>
      </main >
      {isConfirmClearOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" style={{ opacity: confirmOpacity, transition: 'opacity 180ms ease' }} onClick={() => { setConfirmOpacity(0); setTimeout(() => setIsConfirmClearOpen(false), 180) }} />
          <div className="relative bg-[#131313]/80 border border-zinc-700/50 rounded-xl p-4 w-[360px] shadow-2xl" style={{ opacity: confirmOpacity, transform: `scale(${0.97 + 0.03 * confirmOpacity})`, transition: 'opacity 180ms ease, transform 180ms ease' }}>
            <div className="text-white text-base">确认清除历史</div>
            <div className="text-zinc-300 text-sm mt-2">此操作会删除所有生成历史，且不可恢复。</div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => { setConfirmOpacity(0); setTimeout(() => setIsConfirmClearOpen(false), 180) }}
                className="h-9 px-3 inline-flex items-center justify-center rounded-md bg-zinc-700/60 hover:bg-zinc-600/60 text-sm"
              >
                取消
              </button>
              <button
                onClick={async () => { await clearAllHistoryFiles(); setConfirmOpacity(0); setTimeout(() => setIsConfirmClearOpen(false), 180) }}
                className="h-9 px-3 inline-flex items-center justify-center rounded-md bg-red-600/70 hover:bg-red-600 text-white text-sm"
              >
                清除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 图片查看器模态框 */}
      {
        isImageViewerOpen && (
          <div
            ref={imageViewerContainerRef}
            className={"fixed inset-0 bg-black/90 backdrop-blur-lg z-50 flex items-center justify-center p-4"}
            style={{ opacity: viewerOpacity, transition: 'opacity 200ms ease', overscrollBehavior: 'contain' }}
            onMouseMove={handleImageMouseMove}
            onMouseUp={handleImageMouseUp}
            onMouseLeave={handleImageMouseUp}
          >
            <div className={"relative max-w-6xl max-h-full flex items-center justify-center"}>
              {/* 图片容器 */}
              <div
                className="relative"
                style={{
                  cursor: isDragging ? 'grabbing' : 'grab'
                }}
              >
                {/* 关闭按钮 */}
                <button
                  onClick={closeImageViewer}
                  className="absolute top-2 right-2 bg-zinc-800/80 hover:bg-zinc-700/80 backdrop-blur-sm text-white p-2 rounded-full transition-all duration-200 z-10"
                  title="关闭"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <img
                  ref={imageViewerRef}
                  src={currentImage}
                  alt="Full size"
                  className={`object-contain select-none image-transition`}
                  style={{
                    transform: viewerOpacity < 1
                      ? `scale(${imageScaleRef.current * (0.97 + 0.03 * viewerOpacity)}) translate(${imagePositionRef.current.x / imageScaleRef.current}px, ${imagePositionRef.current.y / imageScaleRef.current}px)`
                      : undefined,
                    transition: viewerOpacity < 1 ? 'transform 200ms ease, opacity 200ms ease' : 'opacity 200ms ease',
                    opacity: viewerOpacity,
                    maxHeight: '90vh',
                    maxWidth: '90vw'
                  }}
                  onMouseDown={handleImageMouseDown}
                  onContextMenu={(e) => {
                    const filePath = currentFilePathList[currentImageIndex]
                    showMenu(e, getImageMenuItems(currentImage, filePath))
                  }}
                  draggable={false}
                />
              </div>

              {/* 底部信息栏和切换按钮 */}
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3">
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

                  {/* 重置按钮 - 始终显示 */}
                  <button
                    onClick={resetImageView}
                    className="bg-[#131313]/90 backdrop-blur-xl px-4 py-2 rounded-full text-white text-sm border border-zinc-700/50 hover:bg-zinc-800/90 transition-colors"
                  >
                    重置视图
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
                      <div className="speed-control">
                        <div ref={volumeDisplayRef} className="speed-display" onClick={() => setIsVolumeMenuOpen(o => !o)} title="音量">
                          <svg viewBox="0 0 1024 1024">
                            <path d="M468.992 169.536c29.312-22.528 64.128-40.768 101.312-25.088 36.864 15.616 48.64 53.12 53.76 90.048 5.248 37.824 5.248 89.92 5.248 154.688v245.568c0 64.768 0 116.864-5.184 154.752-5.12 36.864-16.96 74.368-53.76 89.984-37.248 15.744-72.064-2.56-101.376-25.088-30.016-23.04-68.032-61.888-112.832-107.584-23.04-23.552-38.336-34.944-53.76-41.28-15.616-6.4-34.496-9.152-67.456-9.152-28.544 0-54.08 0-73.408-2.048-20.224-2.112-39.04-6.656-56-18.24-32.192-22.016-44.544-54.208-49.28-83.84C52.864 570.24 53.248 545.984 53.568 526.464v-28.928c-0.32-19.52-0.64-43.776 2.816-65.92 4.672-29.568 17.024-61.76 49.28-83.776 16.896-11.52 35.712-16.128 55.936-18.24 19.328-1.984 44.8-1.984 73.344-1.984 33.024 0 51.904-2.752 67.456-9.152 15.488-6.4 30.72-17.792 53.76-41.28 44.8-45.696 82.88-84.608 112.896-107.648z" fill="currentColor"></path>
                            <path d="M699.52 350.08a42.688 42.688 0 0 1 59.776 8.064c32.256 42.24 51.392 95.872 51.392 153.856 0 57.92-19.136 111.552-51.392 153.856a42.688 42.688 0 1 1-67.84-51.712c21.056-27.648 33.92-63.104 33.92-102.144 0-39.04-12.864-74.496-33.92-102.144a42.688 42.688 0 0 1 8-59.776z" fill="currentColor"></path>
                            <path d="M884.8 269.824a42.688 42.688 0 1 0-62.912 57.6C868.736 378.688 896 442.88 896 512c0 69.12-27.264 133.312-74.112 184.512a42.688 42.688 0 0 0 62.912 57.6c59.904-65.344 96.512-149.632 96.512-242.112 0-92.48-36.608-176.768-96.512-242.176z" fill="currentColor"></path>
                          </svg>
                        </div>
                        <div ref={volumeMenuRef} className={`speed-menu volume-menu ${isVolumeMenuOpen ? 'active' : ''}`} onWheel={(e) => { e.preventDefault(); const d = e.deltaY > 0 ? -0.05 : 0.05; const next = Math.min(1, Math.max(0, (muted ? 0 : volume) + d)); setMuted(false); setVolume(next) }}>
                          <div className="volume-vertical">
                            <div className="volume-percent">{Math.round((muted ? 0 : volume) * 100)}</div>
                            <div className="volume-track" onClick={(e) => { const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); const percent = 1 - Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)); const v = percent; setMuted(false); setVolume(v) }}>
                              <div className="volume-fill" style={{ height: `calc(${muted ? 0 : Math.round(volume * 100)}% + 7px)` }}></div>
                              <div className="volume-thumb" style={{ bottom: `${muted ? 0 : Math.round(volume * 100)}%` }}></div>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="speed-control">
                        <div ref={speedDisplayRef} className="speed-display" onClick={() => setIsSpeedMenuOpen(o => !o)}>{playbackRate}x</div>
                        <div ref={speedMenuRef} className={`speed-menu ${isSpeedMenuOpen ? 'active' : ''}`}>
                          {[0.5, 0.75, 1, 1.25, 1.5, 2].map(s => (
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
    </div >
  )
}

export default App
