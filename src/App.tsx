import React, { useState, useEffect } from 'react'
import { apiService } from './services/api'
import MediaGenerator from './components/MediaGenerator'
import SettingsModal from './components/SettingsModal'
import { MediaResult } from './types'

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
      e.preventDefault()
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

  // 当任务列表变化时滚动到底部
  useEffect(() => {
    if (tasks.length > 0) {
      scrollToBottom()
    }
  }, [tasks])

  // 从本地存储加载任务
  useEffect(() => {
    const savedTasks = localStorage.getItem('generationTasks')
    if (savedTasks) {
      try {
        const parsedTasks = JSON.parse(savedTasks)
        // 确保从本地存储加载的任务状态正确
        const loadedTasks = parsedTasks.map((task: any) => ({
          ...task,
          // 任何正在生成中的任务都重置为错误状态,因为页面刷新后无法继续生成
          status: task.status === 'generating' || task.status === 'pending' ? 'error' : task.status,
          error: task.status === 'generating' || task.status === 'pending' ? '页面刷新后生成中断' : task.error,
          // 确保 createdAt 是 Date 对象
          result: task.result ? {
            ...task.result,
            createdAt: task.result.createdAt ? new Date(task.result.createdAt) : new Date()
          } : undefined
        }))
        setTasks(loadedTasks)
      } catch (e) {
        console.error('Failed to parse saved tasks:', e)
      }
    }
    // 标记任务已加载完成
    setIsTasksLoaded(true)
  }, [])

  // 保存任务到本地存储
  useEffect(() => {
    // 只有在任务已从localStorage加载后才执行保存,避免初始化时覆盖已保存的数据
    if (!isTasksLoaded) return
    
    // 只保存成功和错误状态的任务,不保存pending和generating状态的任务
    const tasksToSave = tasks.filter(task => 
      task.status === 'success' || task.status === 'error'
    )
      
    // 获取历史记录数量限制
    const maxHistory = parseInt(localStorage.getItem('max_history_count') || '50', 10)
      
    // 只保存最新的N条记录
    const limitedTasks = tasksToSave.slice(-maxHistory)
      
    localStorage.setItem('generationTasks', JSON.stringify(limitedTasks))
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
      status: 'pending'
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
          break
        case 'video':
          result = await apiService.generateVideo(input, model, options)
          // 视频生成是异步的，需要轮询状态
          if (result.taskId) {
            result = await pollTaskStatus(result.taskId)
          }
          break
        case 'audio':
          result = await apiService.generateAudio(input, model, options)
          break
        default:
          throw new Error('Unsupported media type')
      }

      // 更新任务状态为成功
      setTasks(prev => prev.map(task => 
        task.id === taskId ? {
          ...task, 
          status: 'success',
          result: {
            id: taskId,
            type,
            url: result.url,
            prompt: input,
            createdAt: new Date()
          }
        } : task
      ))
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

  const pollTaskStatus = async (taskId: string): Promise<any> => {
    console.log('[App] 开始轮询任务状态:', taskId)
    return new Promise((resolve, reject) => {
      let pollCount = 0
      const maxPolls = 100 // 最多轮询100次（5分钟）
      
      const interval = setInterval(async () => {
        try {
          pollCount++
          console.log(`[App] 第${pollCount}次轮询任务状态:`, taskId)
          
          const status = await apiService.checkTaskStatus(taskId)
          
          // 注意：API返回的是 TASK_STATUS_SUCCEED，不是 TASK_STATUS_SUCCEEDED
          if ((status.status === 'TASK_STATUS_SUCCEEDED' || status.status === 'TASK_STATUS_SUCCEED') && status.result) {
            console.log('[App] 任务完成:', status.result)
            clearInterval(interval)
            resolve(status.result)
          } else if (status.status === 'TASK_STATUS_FAILED') {
            console.error('[App] 任务失败')
            clearInterval(interval)
            reject(new Error('任务执行失败'))
          } else if (pollCount >= maxPolls) {
            console.error('[App] 轮询超时')
            clearInterval(interval)
            reject(new Error('任务超时'))
          } else {
            console.log('[App] 任务进行中...', {
              status: status.status,
              progress: status.progress
            })
          }
        } catch (err) {
          console.error('[App] 轮询错误:', err)
          clearInterval(interval)
          reject(err)
        }
      }, 3000) // 每3秒检查一次状态
    })
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
    // 禁止后面页面滚动
    document.body.style.overflow = 'hidden'
  }

  const closeImageViewer = () => {
    setImageViewerClosing(true)
    // 恢复后面页面滚动
    document.body.style.overflow = ''
    setTimeout(() => {
      setIsImageViewerOpen(false)
      setImageViewerClosing(false)
      // 延迟清空状态,确保 DOM 完全卸载后再清理
      setTimeout(() => {
        setCurrentImage('')
        setCurrentImageList([])
        setCurrentImageIndex(0)
        // 不在这里重置 scale 和 position,留在下次打开时重置
      }, 50)
    }, 300)
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

  const handleReedit = (task: GenerationTask) => {
    // 将内容返回到输入框
    const event = new CustomEvent('reedit-content', {
      detail: {
        prompt: task.prompt,
        images: task.images
      }
    })
    window.dispatchEvent(event)
  }

  // 清除所有历史记录
  const clearAllHistory = () => {
    setTasks([])
    localStorage.removeItem('generationTasks')
  }

  // 删除单条历史记录
  const deleteTask = (taskId: string) => {
    setTasks(prev => prev.filter(task => task.id !== taskId))
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white flex flex-col relative overflow-hidden">
      {/* 主内容区 */}
      <main className="flex-1 flex flex-col relative z-10">
        {/* 结果显示区 - 瀑布流布局 */}
        <div className="flex-1 overflow-y-auto p-4 pb-[400px]"> {/* 增加底部内边距避免被整个悬浮输入框遮挡 */}
          <div className="max-w-6xl mx-auto w-[90%]"> {/* 添加容器限制宽度并居中 */}
            {tasks.length > 0 ? (
              <>
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-bold">生成历史</h2>
                  <button
                    onClick={clearAllHistory}
                    className="px-3 py-1 bg-red-600/50 hover:bg-red-600/70 rounded-lg text-sm transition-colors"
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
                      <div className="pb-3 border-b border-gray-700/50">
                        <div className="flex flex-wrap gap-4 items-start">
                          {/* 原始图片缩略图 */}
                          {task.images && task.images.length > 0 && (
                            <div className="flex gap-2">
                              {task.images.slice(0, 3).map((image, index) => (
                                <div key={index} className="w-16 h-16 rounded border border-gray-600 overflow-hidden">
                                  <img 
                                    src={image} 
                                    alt={`Input ${index + 1}`} 
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                              ))}
                              {task.images.length > 3 && (
                                <div className="w-16 h-16 rounded border border-gray-600 bg-gray-700/50 flex items-center justify-center text-xs">
                                  +{task.images.length - 3}
                                </div>
                              )}
                            </div>
                          )}
                          
                          {/* 文本提示词 */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-300 truncate text-left">{task.prompt}</p>
                            <div className="flex flex-wrap gap-2 mt-1">
                              <span className="text-xs bg-gray-700/50 px-2 py-1 rounded">
                                {task.type === 'image' ? '图片' : task.type === 'video' ? '视频' : '音频'}
                              </span>
                              <span className="text-xs bg-blue-700/50 px-2 py-1 rounded">
                                {task.model}
                              </span>
                              {task.size && (
                                <span className="text-xs bg-gray-700/50 px-2 py-1 rounded">
                                  {task.size}
                                </span>
                              )}
                              {task.result?.createdAt && (
                                <span className="text-xs bg-gray-700/50 px-2 py-1 rounded">
                                  {new Date(task.result.createdAt).toLocaleString()}
                                </span>
                              )}
                            </div>
                          </div>
                          
                          {/* 操作按钮 */}
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleRegenerate(task)}
                              className="p-2 bg-gray-700/50 hover:bg-gray-600/50 rounded-lg transition-all duration-300"
                              title="重新生成"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleReedit(task)}
                              className="p-2 bg-gray-700/50 hover:bg-gray-600/50 rounded-lg transition-all duration-300"
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
                          <div className="flex items-center justify-center h-64 bg-gray-800/50 rounded-lg">
                            <div className="text-center">
                              <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500 mb-2"></div>
                              <p className="text-gray-400">准备生成...</p>
                            </div>
                          </div>
                        )}
                        
                        {task.status === 'generating' && (
                          <div className="flex items-center justify-center h-64 bg-gray-800/50 rounded-lg">
                            <div className="text-center">
                              <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-purple-500 mb-2"></div>
                              <p className="text-gray-400">生成中...</p>
                            </div>
                          </div>
                        )}
                        
                        {task.status === 'success' && task.result && (
                          <div className="flex justify-start">
                            <div 
                              className="flex gap-2 overflow-x-auto max-w-full pb-2"
                              style={{
                                scrollbarWidth: 'thin',
                                scrollbarColor: '#4B5563 #1F2937'
                              }}
                              onWheel={(e) => {
                                // 鼠标停留在图片区域时，滚轮变为横向滚动
                                if (e.deltaY !== 0) {
                                  e.currentTarget.scrollLeft += e.deltaY
                                  e.preventDefault()
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
                                        className="relative w-64 h-64 bg-gray-900 rounded-lg overflow-hidden border border-gray-700 flex items-center justify-center flex-shrink-0"
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
                                    className="relative w-64 h-64 bg-gray-900 rounded-lg overflow-hidden border border-gray-700 flex items-center justify-center flex-shrink-0"
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
                                <div className="relative w-64 h-64 bg-gray-900 rounded-lg overflow-hidden border border-gray-700 flex items-center justify-center">
                                  <video 
                                    src={task.result.url} 
                                    controls 
                                    className="max-w-full max-h-full object-contain"
                                  />
                                </div>
                              )}
                              {task.result.type === 'audio' && (
                                <div className="flex flex-col items-center">
                                  <div className="w-16 h-16 rounded-full bg-gradient-to-r from-blue-500 to-purple-500 flex items-center justify-center mb-4">
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
                  <div className="inline-block p-4 rounded-full bg-gray-800/30 backdrop-blur-lg mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                  <p className="text-gray-500 text-lg">生成的内容将显示在这里</p>
                  <p className="text-gray-600 text-sm mt-2">选择模型并输入提示词开始创作</p>
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
          <div className="bg-gray-900/70 backdrop-blur-xl border border-gray-700/50 rounded-2xl shadow-2xl p-4 hover:shadow-3xl transition-all duration-300">
            <MediaGenerator 
              onGenerate={handleGenerate}
              isLoading={isLoading}
              onOpenSettings={openSettings}
            />
          </div>
        </div>
      </main>

      {/* 图片查看器模态框 */}
      {isImageViewerOpen && (
        <div 
          className={`fixed inset-0 bg-black/90 backdrop-blur-lg z-50 flex items-center justify-center p-4 ${
            imageViewerClosing ? 'image-viewer-mask-exit' : 'image-viewer-mask-enter'
          }`}
          onMouseMove={handleImageMouseMove}
          onMouseUp={handleImageMouseUp}
          onMouseLeave={handleImageMouseUp}
          onWheel={(e) => e.preventDefault()}
        >
          <div className={`relative max-w-6xl max-h-full flex items-center justify-center ${
            imageViewerClosing ? 'image-viewer-content-exit' : 'image-viewer-content-enter'
          }`}>
            {/* 关闭按钮 */}
            <button
              onClick={closeImageViewer}
              className="absolute -top-12 right-0 text-white hover:text-gray-300 p-2 transition-colors z-10"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            
            {/* 图片容器 */}
            <div 
              className="relative"
              style={{
                cursor: isDragging ? 'grabbing' : 'grab'
              }}
            >
              <img 
                ref={imageViewerRef}
                src={currentImage} 
                alt="Full size" 
                className={`object-contain select-none ${
                  imageTransitioning ? 'image-transitioning' : 'image-transition'
                }`}
                style={{
                  transform: `scale(${imageScale}) translate(${imagePosition.x / imageScale}px, ${imagePosition.y / imageScale}px)`,
                  transition: (isDragging || imageViewerClosing) ? 'none' : 'transform 0.2s ease-out',
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
                    className="bg-gray-800/80 hover:bg-gray-700/80 backdrop-blur-sm text-white p-2 rounded-full transition-all duration-200"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => navigateImage('next')}
                    className="bg-gray-800/80 hover:bg-gray-700/80 backdrop-blur-sm text-white p-2 rounded-full transition-all duration-200"
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
                <div className="bg-gray-900/90 backdrop-blur-xl px-4 py-2 rounded-full text-white text-sm border border-gray-700/50">
                  {currentImageIndex + 1} / {currentImageList.length}
                </div>
              )}
              
              {/* 缩放比例显示 */}
              <div className="bg-gray-900/90 backdrop-blur-xl px-4 py-2 rounded-full text-white text-sm border border-gray-700/50">
                {Math.round(imageScale * 100)}%
              </div>
              
              {/* 重置按钮 - 始终显示 */}
              <button
                onClick={resetImageView}
                className="bg-gray-900/90 backdrop-blur-xl px-4 py-2 rounded-full text-white text-sm border border-gray-700/50 hover:bg-gray-800/90 transition-colors"
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