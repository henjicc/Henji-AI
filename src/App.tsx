import React, { useState, useEffect } from 'react'
import { apiService } from './services/api'
import MediaGenerator from './components/MediaGenerator'
import SettingsModal from './components/SettingsModal'
import { MediaResult } from './types'
import { isDesktop, saveImageFromUrl, fileToBlobSrc, fileToDataUrl, readJsonFromAppData, writeJsonToAppData } from './utils/save'
import WindowControls from './components/WindowControls'
import { remove } from '@tauri-apps/plugin-fs'

// 定义生成任务类型
interface GenerationTask {
  id: string
  type: 'image' | 'video' | 'audio'
  prompt: string
  model: string  // 保存使用的模型
  images?: string[]
  size?: string
  status: 'pending' | 'generating' | 'success' | 'error'
  result?: MediaResult
  error?: string
  uploadedFilePaths?: string[]
  progress?: number
  serverTaskId?: string
  timedOut?: boolean
}

const App: React.FC = () => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [tasks, setTasks] = useState<GenerationTask[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false)
  const [imageViewerClosing, setImageViewerClosing] = useState(false)
  const [currentImage, setCurrentImage] = useState('')
  const [currentImageList, setCurrentImageList] = useState<string[]>([])
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [imageScale, setImageScale] = useState(1)
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [isSpacePressed, setIsSpacePressed] = useState(false)
  const [imageTransitioning, setImageTransitioning] = useState(false)
  const [isTasksLoaded, setIsTasksLoaded] = useState(false) // 标记任务是否已从localStorage加载
  const [viewerOpacity, setViewerOpacity] = useState(0)
  const [isConfirmClearOpen, setIsConfirmClearOpen] = useState(false)
  const [confirmOpacity, setConfirmOpacity] = useState(0)
  const tasksEndRef = React.useRef<HTMLDivElement>(null)
  const imageViewerRef = React.useRef<HTMLImageElement>(null)

  // 自动滚动到最新任务
  const scrollToBottom = () => {
    tasksEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

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
        setIsSpacePressed(true)
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        setIsSpacePressed(false)
        setIsDragging(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [isImageViewerOpen, currentImageIndex, currentImageList])

  // 图片缩放的滚轮事件监听(非passive模式)
  useEffect(() => {
    if (!isImageViewerOpen || !imageViewerRef.current) return

    const handleWheel = (e: WheelEvent) => {
      if (e.cancelable) e.preventDefault()
      const delta = e.deltaY > 0 ? -0.1 : 0.1
      setImageScale(prev => {
        const newScale = Math.max(0.5, Math.min(5, prev + delta))
        return newScale
      })
    }

    const imgElement = imageViewerRef.current
    // 使用 { passive: false } 允许 preventDefault
    imgElement.addEventListener('wheel', handleWheel, { passive: false })
    
    return () => {
      imgElement.removeEventListener('wheel', handleWheel)
    }
  }, [isImageViewerOpen])

  useEffect(() => {
    if (isImageViewerOpen) {
      requestAnimationFrame(() => setViewerOpacity(1))
    } else {
      setViewerOpacity(0)
    }
  }, [isImageViewerOpen])

  useEffect(() => {
    if (isConfirmClearOpen) {
      requestAnimationFrame(() => setConfirmOpacity(1))
    } else {
      setConfirmOpacity(0)
    }
  }, [isConfirmClearOpen])

  // 当任务列表变化时滚动到底部
  useEffect(() => {
    if (tasks.length > 0) {
      scrollToBottom()
    }
  }, [tasks])

  // 加载历史（优先文件，其次本地存储）
  useEffect(() => {
    const load = async () => {
      const fileHistory = await readJsonFromAppData<any[]>('Henji-AI/history.json')
      const store = fileHistory ?? (() => { try { return JSON.parse(localStorage.getItem('generationTasks') || '[]') } catch { return [] } })()
      const loaded = await Promise.all((store || []).map(async (task: any) => {
        let result = task.result
        if (result && result.filePath) {
          try { result = { ...result, url: await fileToBlobSrc(result.filePath) } } catch {}
        }
        let images = task.images
        if ((!images || images.length === 0) && task.uploadedFilePaths && task.uploadedFilePaths.length) {
          try {
            const arr: string[] = []
            for (const p of task.uploadedFilePaths) {
              const src = await fileToBlobSrc(p, 'image/png')
              arr.push(src)
            }
            images = arr
          } catch {}
        }
        return {
          ...task,
          status: task.status === 'generating' || task.status === 'pending' ? 'error' : task.status,
          error: task.status === 'generating' || task.status === 'pending' ? '页面刷新后生成中断' : task.error,
          result: result ? { ...result, createdAt: result.createdAt ? new Date(result.createdAt) : new Date() } : undefined,
          images
        }
      }))
      setTasks(loaded)
      setIsTasksLoaded(true)
    }
    load()
  }, [])

  // 保存历史到文件（避免本地存储配额）
  useEffect(() => {
    if (!isTasksLoaded) return
    const tasksToSave = tasks.filter(t => t.status === 'success' || t.status === 'error')
      .map(t => ({
        id: t.id,
        type: t.type,
        prompt: t.prompt,
        model: t.model,
        size: t.size,
        status: t.status,
        error: t.error,
        uploadedFilePaths: t.uploadedFilePaths,
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

  const handleGenerate = async (input: string, model: string, type: 'image' | 'video' | 'audio', options?: any) => {
    if (!input.trim() && (!options || !options.images || options.images.length === 0)) {
      setError('请输入内容或上传图片')
      return
    }

    // 创建新的生成任务
    const taskId = Date.now().toString()
  const newTask: GenerationTask = {
      id: taskId,
      type,
      prompt: input,
      model,  // 保存模型信息
      images: options?.images,
      size: options?.size,
      uploadedFilePaths: options?.uploadedFilePaths,
      status: 'pending',
      progress: 0,
      timedOut: false
    }

    // 立即添加到任务列表（最新的在最后）
    setTasks(prev => [...prev, newTask])
    setError(null)

    try {
      // 更新任务状态为生成中
      setTasks(prev => prev.map(task => 
        task.id === taskId ? {...task, status: 'generating'} : task
      ))

      let result: any
      switch (type) {
        case 'image':
          result = await apiService.generateImage(input, model, options)
          console.log('[App] 尝试本地保存，ua=', typeof navigator !== 'undefined' ? navigator.userAgent : '')
          if (result?.url) {
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
                ;(result as any).filePath = paths.join('|||')
              } else {
                const { fullPath } = await saveImageFromUrl(result.url)
                const blobSrc = await fileToBlobSrc(fullPath, 'image/png')
                result.url = blobSrc
                ;(result as any).filePath = fullPath
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
          result = await apiService.generateAudio(input, model, options)
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
      // 更新任务状态为错误
      setTasks(prev => prev.map(task => 
        task.id === taskId ? {
          ...task, 
          status: 'error',
          error: err instanceof Error ? err.message : '生成失败'
        } : task
      ))
    }
  }

  const pollTaskStatus = async (serverTaskId: string, uiTaskId: string, model?: string): Promise<any> => {
    console.log('[App] 开始轮询任务状态:', serverTaskId)
    return new Promise((resolve, reject) => {
      let pollCount = 0
      const maxPolls = model === 'vidu-q1' ? 120 : 100
      
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

  const openImageViewer = (imageUrl: string, imageList?: string[]) => {
    if (imageList && imageList.length > 0) {
      setCurrentImageList(imageList)
      setCurrentImageIndex(imageList.indexOf(imageUrl))
    } else {
      setCurrentImageList([imageUrl])
      setCurrentImageIndex(0)
    }
    setCurrentImage(imageUrl)
    // 打开时重置缩放和位置
    setImageScale(1)
    setImagePosition({ x: 0, y: 0 })
    setIsImageViewerOpen(true)
    setImageViewerClosing(false)
    setViewerOpacity(0)
    // 禁止后面页面滚动
    document.body.style.overflow = 'hidden'
  }

  const closeImageViewer = () => {
    setImageViewerClosing(true)
    setViewerOpacity(0)
    setTimeout(() => {
      setIsImageViewerOpen(false)
      setImageViewerClosing(false)
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
    setImageScale(1)
    setImagePosition({ x: 0, y: 0 })
  }

  const downloadImage = async (imageUrl: string) => {
    try {
      const response = await fetch(imageUrl)
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `image-${Date.now()}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Download failed:', err)
    }
  }

  const copyImageToClipboard = async (imageUrl: string) => {
    try {
      const response = await fetch(imageUrl)
      const blob = await response.blob()
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type]: blob
        })
      ])
    } catch (err) {
      console.error('Copy failed:', err)
    }
  }



  // 图片拖动开始
  const handleImageMouseDown = (e: React.MouseEvent) => {
    // 只响应左键点击
    if (e.button === 0) {
      e.preventDefault()
      setIsDragging(true)
      setDragStart({ x: e.clientX - imagePosition.x, y: e.clientY - imagePosition.y })
    }
  }

  // 图片拖动中
  const handleImageMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setImagePosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      })
    }
  }

  // 图片拖动结束
  const handleImageMouseUp = () => {
    setIsDragging(false)
  }



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
      } catch {}
    } else if (task.images && task.images.length) {
      // 如果历史中已有 images 但不是 data:，仍尝试用上传路径重建
      if (task.images.some(img => typeof img === 'string' && !img.startsWith('data:'))) {
        if (task.uploadedFilePaths && task.uploadedFilePaths.length) {
          try {
            const arr: string[] = []
            for (const p of task.uploadedFilePaths) {
              const data = await fileToDataUrl(p)
              arr.push(data)
            }
            images = arr
          } catch {}
        } else {
          images = task.images
        }
      } else {
        images = task.images
      }
    }
    const event = new CustomEvent('reedit-content', { detail: { prompt: task.prompt, images } })
    window.dispatchEvent(event)
  }

  // 清除所有历史记录
  const clearAllHistory = () => {
    setTasks([])
    localStorage.removeItem('generationTasks')
  }

  const clearAllHistoryFiles = async () => {
    try {
      const files: string[] = []
      tasks.forEach(t => {
        const p = t.result?.filePath
        if (p) {
          if (p.includes('|||')) files.push(...p.split('|||'))
          else files.push(p)
        }
        if (t.uploadedFilePaths && t.uploadedFilePaths.length) {
          files.push(...t.uploadedFilePaths)
        }
      })
      for (const f of files) {
        try { await remove(f) } catch (e) { console.error('[App] 删除文件失败', f, e) }
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
        <div className="flex-1 overflow-y-auto p-4 pb-[400px] app-scroll-container"> {/* 增加底部内边距避免被整个悬浮输入框遮挡 */}
          <div className="max-w-6xl mx-auto w-[90%]"> {/* 添加容器限制宽度并居中 */}
            {tasks.length > 0 ? (
              <>
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-bold">生成历史</h2>
                  <button
                    onClick={() => setIsConfirmClearOpen(true)}
                    className="h-8 px-3 inline-flex items-center justify-center bg-red-600/60 hover:bg-red-600/80 rounded-md text-sm leading-none transition-colors"
                  >
                    清除历史
                  </button>
                </div>
                <div className="space-y-6">
                  {tasks.map((task) => (
                    <div 
                      key={task.id} 
                      className="overflow-hidden animate-fade-in-up"
                    >
                      {/* 任务信息行 */}
                      <div className="pb-3 border-b border-[rgba(46,46,46,0.8)]">
                        <div className="flex flex-wrap gap-4 items-start">
                          {/* 原始图片缩略图 */}
                          {task.images && task.images.length > 0 && (
                            <div className="flex gap-2">
                              {task.images.slice(0, 3).map((image, index) => (
                                <div key={index} className="w-16 h-16 rounded border border-[rgba(46,46,46,0.8)] overflow-hidden">
                                  <img 
                                    src={image} 
                                    alt={`Input ${index + 1}`} 
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                              ))}
                              {task.images.length > 3 && (
                                <div className="w-16 h-16 rounded border border-[rgba(46,46,46,0.8)] bg-zinc-700/50 flex items-center justify-center text-xs">
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
                              <div className="w-full h-2 bg-zinc-700 rounded">
                                <div
                                  className="h-2 bg-[#007eff] rounded transition-all duration-[2800ms] ease-out"
                                  style={{ width: `${Math.min(100, Math.max(0, task.progress || 0))}%` }}
                                ></div>
                              </div>
                              <div className="mt-2 text-sm text-zinc-400">{Math.min(100, Math.max(0, Math.floor(task.progress || 0)))}%</div>
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
                              {task.result.type === 'image' && (
                                task.result.url.includes('|||') ? (
                                  // 多张图片
                                  (() => {
                                    const imageUrls = task.result!.url.split('|||')
                                    return imageUrls.map((url, index) => (
                                      <div 
                                        key={index} 
                                        className="relative w-64 h-64 bg-[#1B1C21] rounded-lg overflow-hidden border border-[rgba(46,46,46,0.8)] flex items-center justify-center flex-shrink-0"
                                      >
                                        <img 
                                          src={url} 
                                          alt={`${task.result!.prompt} ${index + 1}`}
                                          className="max-w-full max-h-full object-contain cursor-pointer"
                                          onClick={() => openImageViewer(url, imageUrls)}
                                        />
                                      </div>
                                    ))
                                  })()
                                ) : (
                                  // 单张图片
                                  <div 
                                    className="relative w-64 h-64 bg-[#1B1C21] rounded-lg overflow-hidden border border-[rgba(46,46,46,0.8)] flex items-center justify-center flex-shrink-0"
                                  >
                                    <img 
                                      src={task.result.url} 
                                      alt={task.result.prompt} 
                                      className="max-w-full max-h-full object-contain cursor-pointer"
                                      onClick={() => openImageViewer(task.result!.url, [task.result!.url])}
                                    />
                                  </div>
                                )
                              )}
                              {task.result.type === 'video' && (
                                <div className="relative w-64 h-64 bg-[#1B1C21] rounded-lg overflow-hidden border border-[rgba(46,46,46,0.8)] flex items-center justify-center">
                                  <video 
                                    src={task.result.url} 
                                    controls 
                                    className="max-w-full max-h-full object-contain"
                                  />
                                </div>
                              )}
                              {task.result.type === 'audio' && (
                                <div className="flex flex-col items-center">
                                  <div className="w-16 h-16 rounded-full bg-[#007eff] flex items-center justify-center mb-4">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                                    </svg>
                                  </div>
                                  <audio 
                                    src={task.result.url} 
                                    controls 
                                    className="w-full max-w-xs"
                                  />
                                </div>
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
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="inline-block p-4 rounded-full bg-zinc-800/30 backdrop-blur-lg mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                  <p className="text-zinc-500 text-lg">生成的内容将显示在这里</p>
                  <p className="text-zinc-600 text-sm mt-2">选择模型并输入提示词开始创作</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mx-4 mb-4 p-3 bg-red-900/50 backdrop-blur-lg border border-red-700/50 rounded-xl shadow-lg animate-shake">
            <p className="text-red-200">{error}</p>
          </div>
        )}

        {/* 输入区域 - 悬浮设计 */}
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 w-[90%] max-w-4xl z-20">
          <div className="bg-[#131313]/70 backdrop-blur-xl border border-[rgba(46,46,46,0.8)] rounded-2xl shadow-2xl p-4 hover:shadow-3xl transition-all duration-300">
            <MediaGenerator 
              onGenerate={handleGenerate}
              isLoading={isLoading}
              onOpenSettings={openSettings}
            />
          </div>
        </div>
      </main>
      {isConfirmClearOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" style={{ opacity: confirmOpacity, transition: 'opacity 180ms ease' }} onClick={() => { setConfirmOpacity(0); setTimeout(() => setIsConfirmClearOpen(false), 180) }} />
          <div className="relative bg-[#131313]/80 border border-[rgba(46,46,46,0.8)] rounded-xl p-4 w-[360px] shadow-2xl" style={{ opacity: confirmOpacity, transform: `scale(${0.97 + 0.03 * confirmOpacity})`, transition: 'opacity 180ms ease, transform 180ms ease' }}>
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
      {isImageViewerOpen && (
        <div 
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
                className={`object-contain select-none ${
                  imageTransitioning ? 'image-transitioning' : 'image-transition'
                }`}
                style={{
                  transform: `scale(${imageScale * (0.97 + 0.03 * viewerOpacity)}) translate(${imagePosition.x / imageScale}px, ${imagePosition.y / imageScale}px)`,
                  transition: isDragging ? 'none' : 'transform 200ms ease, opacity 200ms ease',
                  opacity: viewerOpacity,
                  maxHeight: '90vh',
                  maxWidth: '90vw'
                }}
                onMouseDown={handleImageMouseDown}
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
                <div className="bg-[#131313]/90 backdrop-blur-xl px-4 py-2 rounded-full text-white text-sm border border-[rgba(46,46,46,0.8)]">
                  {currentImageIndex + 1} / {currentImageList.length}
                </div>
              )}
              
              {/* 缩放比例显示 */}
              <div className="bg-[#131313]/90 backdrop-blur-xl px-4 py-2 rounded-full text-white text-sm border border-[rgba(46,46,46,0.8)]">
                {Math.round(imageScale * 100)}%
              </div>
              
              {/* 重置按钮 - 始终显示 */}
              <button
                onClick={resetImageView}
                className="bg-[#131313]/90 backdrop-blur-xl px-4 py-2 rounded-full text-white text-sm border border-[rgba(46,46,46,0.8)] hover:bg-zinc-800/90 transition-colors"
              >
                重置视图
              </button>
            </div>
            </div>
          </div>
        </div>
      )}

      {/* 设置模态框 */}
      {isSettingsOpen && (
        <SettingsModal onClose={closeSettings} />
      )}
    </div>
  )
}

export default App
