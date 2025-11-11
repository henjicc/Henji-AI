import React, { useState, useRef, useEffect } from 'react'
import { providers } from '../config/providers'

interface MediaGeneratorProps {
  onGenerate: (input: string, model: string, type: 'image' | 'video' | 'audio', options?: any) => void
  isLoading: boolean
  onOpenSettings: () => void
}

const MediaGenerator: React.FC<MediaGeneratorProps> = ({ onGenerate, isLoading, onOpenSettings }) => {
  const [input, setInput] = useState('')
  const [selectedProvider, setSelectedProvider] = useState('piaoyun')
  const [selectedModel, setSelectedModel] = useState('seedream-4.0')
  const [mediaType, setMediaType] = useState<'text' | 'image'>('text')
  const [uploadedImages, setUploadedImages] = useState<string[]>([])
  const [isImageGalleryExpanded, setIsImageGalleryExpanded] = useState(false)
  const [removingImages, setRemovingImages] = useState<Set<string>>(new Set())
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false)
  const [modelDropdownClosing, setModelDropdownClosing] = useState(false)
  const [isResolutionDropdownOpen, setIsResolutionDropdownOpen] = useState(false)
  const [selectedResolution, setSelectedResolution] = useState('2048x2048')
  const [resolutionQuality, setResolutionQuality] = useState<'2K' | '4K'>('2K') // 2K/4K切换
  const [customWidth, setCustomWidth] = useState('')
  const [customHeight, setCustomHeight] = useState('')
  const [isManualInput, setIsManualInput] = useState(false) // 标记是否手动输入
  const [sequentialImageGeneration, setSequentialImageGeneration] = useState<'auto' | 'disabled'>('auto')
  const [maxImages, setMaxImages] = useState<number>(15)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageFileInputRef = useRef<HTMLInputElement>(null)
  const modelRef = useRef<HTMLDivElement>(null)
  const resolutionRef = useRef<HTMLDivElement>(null)

  const currentProvider = providers.find(p => p.id === selectedProvider)
  const currentModel = currentProvider?.models.find(m => m.id === selectedModel)

  // 预设分辨率选项 - 2K基础分辨率
  const baseResolutions: Record<string, string> = {
    '1:1': '2048x2048',
    '4:3': '2304x1728',
    '3:4': '1728x2304',
    '16:9': '2560x1440',
    '9:16': '1440x2560',
    '3:2': '2496x1664',
    '2:3': '1664x2496',
    '21:9': '3024x1296'
  }

  // 根据质量获取实际分辨率
  const getActualResolution = (ratio: string): string => {
    const base = baseResolutions[ratio]
    if (!base) return base
    
    if (resolutionQuality === '4K') {
      const [w, h] = base.split('x').map(Number)
      return `${w * 2}x${h * 2}`
    }
    return base
  }

  // 监听分辨率选项变化,更新底部数值
  useEffect(() => {
    if (selectedResolution === 'smart' || isManualInput) {
      return // 智能模式或手动输入时不自动更新
    }
    
    const resolution = getActualResolution(selectedResolution)
    if (resolution && resolution.includes('x')) {
      const [w, h] = resolution.split('x')
      setCustomWidth(w)
      setCustomHeight(h)
    }
  }, [selectedResolution, resolutionQuality])

  // 计算智能分辨率(基于第一张图片)
  const calculateSmartResolution = (imageDataUrl: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const originalWidth = img.width
        const originalHeight = img.height
        const aspectRatio = originalWidth / originalHeight
        
        // 检查宽高比范围 [1/16, 16]
        if (aspectRatio < 1/16 || aspectRatio > 16) {
          // 超出范围,使用默认 1:1
          resolve(resolutionQuality === '2K' ? '2048x2048' : '4096x4096')
          return
        }
        
        const maxPixels = resolutionQuality === '2K' ? 4194304 : 16777216 // 2K: 2048*2048, 4K: 4096*4096
        
        // 计算最大尺寸
        let width = originalWidth
        let height = originalHeight
        
        if (width * height > maxPixels) {
          // 超过最大像素,需要缩小
          const scale = Math.sqrt(maxPixels / (width * height))
          width = Math.floor(width * scale)
          height = Math.floor(height * scale)
        }
        
        // 确保不超过原始尺寸
        width = Math.min(width, originalWidth)
        height = Math.min(height, originalHeight)
        
        // 确保不超过最大像素限制
        if (width * height > maxPixels) {
          const scale = Math.sqrt(maxPixels / (width * height))
          width = Math.floor(width * scale)
          height = Math.floor(height * scale)
        }
        
        resolve(`${width}x${height}`)
      }
      img.src = imageDataUrl
    })
  }

  // 监听重新编辑事件
  useEffect(() => {
    const handleReedit = (event: CustomEvent) => {
      const { prompt, images } = event.detail
      setInput(prompt || '')
      if (images && Array.isArray(images)) {
        setUploadedImages(images)
        setMediaType('image')
      }
    }

    window.addEventListener('reedit-content', handleReedit as EventListener)
    return () => {
      window.removeEventListener('reedit-content', handleReedit as EventListener)
    }
  }, [])

  // 监听分辨率选项变化,更新底部数值
  useEffect(() => {
    if (selectedResolution === 'smart' || isManualInput) {
      return // 智能模式或手动输入时不自动更新
    }
    
    const resolution = getActualResolution(selectedResolution)
    if (resolution && resolution.includes('x')) {
      const [w, h] = resolution.split('x')
      setCustomWidth(w)
      setCustomHeight(h)
    }
  }, [selectedResolution, resolutionQuality])

  // 点击外部区域关闭下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelRef.current && !modelRef.current.contains(event.target as Node) && isModelDropdownOpen) {
        handleCloseModelDropdown()
      }
      if (resolutionRef.current && !resolutionRef.current.contains(event.target as Node) && isResolutionDropdownOpen) {
        setIsResolutionDropdownOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isModelDropdownOpen, isResolutionDropdownOpen])

  const handleCloseModelDropdown = () => {
    setModelDropdownClosing(true)
    setTimeout(() => {
      setIsModelDropdownOpen(false)
      setModelDropdownClosing(false)
    }, 200)
  }

  const handleGenerate = async () => {
    if ((!input.trim() && uploadedImages.length === 0) || isLoading) return
    
    // 构建生成选项
    const options: any = {}
    
    // 如果是图片模型，添加图片和分辨率选项
    if (currentModel?.type === 'image') {
      if (uploadedImages.length > 0) {
        options.images = uploadedImages
      }
      
      // 处理分辨率设置
      if (selectedResolution === 'smart') {
        // 智能模式:根据第一张图片计算
        if (uploadedImages.length > 0) {
          const smartSize = await calculateSmartResolution(uploadedImages[0])
          options.size = smartSize
        } else {
          // 没有图片时使用默认分辨率
          options.size = resolutionQuality === '2K' ? '2048x2048' : '4096x4096'
        }
      } else if (customWidth && customHeight && !isManualInput) {
        // 预设模式:使用预设分辨率
        options.size = `${customWidth}x${customHeight}`
      } else if (isManualInput && customWidth && customHeight) {
        // 手动输入模式:使用手动输入的值
        options.size = `${customWidth}x${customHeight}`
      }
      
      // 添加即梦图片生成4.0的参数
      if (selectedModel === 'seedream-4.0') {
        options.sequential_image_generation = sequentialImageGeneration
        if (sequentialImageGeneration === 'auto' && maxImages > 1) {
          options.max_images = maxImages
        }
        // 默认不添加水印
        options.watermark = false
      }
    }
    
    onGenerate(input, selectedModel, currentModel?.type || 'image', options)
  }

  const handleTextFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (event) => {
        if (event.target?.result) {
          setInput(event.target.result as string)
        }
      }
      reader.readAsText(file)
    }
  }

  const handleImageFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) {
      files.forEach(file => {
        if (file) {
          const reader = new FileReader()
          reader.onload = (event) => {
            if (event.target?.result) {
              setUploadedImages(prev => {
                // 最多允许6张图片
                if (prev.length >= 6) {
                  return prev
                }
                return [...prev, event.target?.result as string]
              })
              setMediaType('image')
            }
          }
          reader.readAsDataURL(file)
        }
      })
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const blob = items[i].getAsFile()
        if (blob) {
          const reader = new FileReader()
          reader.onload = (event) => {
            if (event.target?.result) {
              setUploadedImages(prev => [...prev, event.target?.result as string])
              setMediaType('image')
            }
          }
          reader.readAsDataURL(blob)
        }
        break
      }
    }
  }

  const removeImage = (index: number) => {
    const imageToRemove = uploadedImages[index]
    // 标记该图片为正在删除
    setRemovingImages(prev => new Set(prev).add(imageToRemove))
    // 等待动画完成后再移除
    setTimeout(() => {
      setUploadedImages(prev => prev.filter((_, i) => i !== index))
      setRemovingImages(prev => {
        const newSet = new Set(prev)
        newSet.delete(imageToRemove)
        return newSet
      })
    }, 250) // 与动画时长一致
  }

  const clearAllImages = () => {
    setUploadedImages([])
  }

  // 处理拖拽图片
  const handleImageFileDrop = (files: File[]) => {
    files.forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onloadend = () => {
          setUploadedImages(prev => {
            // 最多允许6张图片
            if (prev.length >= 6) {
              return prev
            }
            return [...prev, reader.result as string]
          })
        }
        reader.readAsDataURL(file)
      }
    })
  }

  const handleModelSelect = (providerId: string, modelId: string) => {
    setSelectedProvider(providerId)
    setSelectedModel(modelId)
    handleCloseModelDropdown()
  }

  const handleResolutionSelect = (resolution: string) => {
    setSelectedResolution(resolution)
    setIsManualInput(false) // 选择预设时重置手动输入标记
    // 不再立即关闭面板
  }

  const handleQualitySelect = (quality: '2K' | '4K') => {
    setResolutionQuality(quality)
    setIsManualInput(false)
  }

  const handleManualWidthChange = (value: string) => {
    setCustomWidth(value)
    setIsManualInput(true) // 标记为手动输入
  }

  const handleManualHeightChange = (value: string) => {
    setCustomHeight(value)
    setIsManualInput(true) // 标记为手动输入
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* 模型选择器、分辨率设置和即梦参数设置 */}
      <div className="flex flex-wrap gap-3 mb-4">
        {/* 合并的提供商和模型选择器 - 缩短宽度 */}
        <div className="w-auto min-w-[180px] relative" ref={modelRef}>
          <label className="block text-sm font-medium mb-1 text-gray-300">模型</label>
          <div 
            className="bg-gray-800/70 backdrop-blur-lg border border-gray-700/50 rounded-lg px-3 py-2 h-[38px] focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all duration-300 cursor-pointer flex items-center justify-between whitespace-nowrap"
            onClick={() => {
              if (isModelDropdownOpen) {
                handleCloseModelDropdown()
              } else {
                setIsModelDropdownOpen(true)
              }
            }}
          >
            <span className="text-sm">{currentProvider?.name}_{currentModel?.name || '选择'}</span>
            <svg 
              className={`w-4 h-4 text-gray-400 transition-transform duration-200 ml-2 ${isModelDropdownOpen ? 'rotate-180' : ''}`} 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
            </svg>
          </div>
          
          {/* 模型下拉菜单 - 限制最大高度并添加滚动条 */}
          {(isModelDropdownOpen || modelDropdownClosing) && (
            <div 
              className={`absolute z-20 mt-1 w-full min-w-[200px] bg-gray-800/90 backdrop-blur-xl border border-gray-700/50 rounded-lg shadow-lg ${
                modelDropdownClosing ? 'animate-scale-out' : 'animate-scale-in'
              }`}
            >
              <div className="max-h-60 overflow-y-auto">
                {providers.map(provider => (
                  <div key={provider.id}>
                    <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      {provider.name}
                    </div>
                    {provider.models.map(model => (
                      <div
                        key={`${provider.id}-${model.id}`}
                        className={`px-3 py-2 cursor-pointer transition-colors duration-200 flex items-center ${
                          selectedProvider === provider.id && selectedModel === model.id
                            ? 'bg-purple-500/20 text-purple-300' 
                            : 'hover:bg-gray-700/50'
                        }`}
                        onClick={() => handleModelSelect(provider.id, model.id)}
                      >
                        <span className="flex-1 text-sm">{model.name}</span>
                        <span className="text-xs text-gray-500 ml-2">
                          {model.type === 'image' ? '图片' : model.type === 'video' ? '视频' : '音频'}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 分辨率设置按钮 - 仅对图片模型显示 */}
        {currentModel?.type === 'image' && (
          <div className="relative" ref={resolutionRef}>
            <label className="block text-sm font-medium mb-1 text-gray-300">分辨率</label>
            <button
              onClick={() => setIsResolutionDropdownOpen(!isResolutionDropdownOpen)}
              className="bg-gray-800/70 backdrop-blur-lg border border-gray-700/50 rounded-lg px-3 py-2 h-[38px] focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all duration-300 flex items-center"
            >
              <span className="mr-2 text-sm whitespace-nowrap">
                {selectedResolution === 'smart' 
                  ? '智能' 
                  : `${customWidth || '?'}x${customHeight || '?'}`}
              </span>
              <svg 
                className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isResolutionDropdownOpen ? 'rotate-180' : ''}`} 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
              </svg>
            </button>
            
            {/* 分辨率设置悬浮窗口 - 向上弹出 */}
            {isResolutionDropdownOpen && (
              <div 
                className="absolute z-20 mb-1 w-80 bg-gray-800 border border-gray-700/50 rounded-lg shadow-2xl bottom-full right-0 mb-2 animate-scale-in"
              >
                <div className="p-4">
                  {/* 选择比例 */}
                  <div className="mb-3">
                    <label className="block text-xs text-gray-400 mb-2">选择比例</label>
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: '智能', value: 'smart' },
                        { label: '21:9', value: '21:9', ratio: '21:9' },
                        { label: '16:9', value: '16:9', ratio: '16:9' },
                        { label: '3:2', value: '3:2', ratio: '3:2' },
                        { label: '4:3', value: '4:3', ratio: '4:3' },
                        { label: '1:1', value: '1:1', ratio: '1:1' },
                        { label: '3:4', value: '3:4', ratio: '3:4' },
                        { label: '2:3', value: '2:3', ratio: '2:3' },
                        { label: '9:16', value: '9:16', ratio: '9:16' }
                      ].map(resolution => (
                        <button
                          key={resolution.value}
                          onClick={() => handleResolutionSelect(resolution.value)}
                          className={`px-2 py-3 text-xs rounded flex flex-col items-center justify-center gap-2 transition-all duration-300 ${
                            selectedResolution === resolution.value
                              ? 'bg-white text-black'
                              : 'bg-gray-700/50 text-gray-300 hover:bg-gray-600/50'
                          }`}
                        >
                          {resolution.ratio && (
                            <div className="flex items-center justify-center h-8">
                              <div 
                                className={`border-2 ${
                                  selectedResolution === resolution.value ? 'border-black' : 'border-gray-400'
                                } ${
                                  resolution.ratio === '21:9' ? 'w-8 h-3' :
                                  resolution.ratio === '16:9' ? 'w-8 h-4' :
                                  resolution.ratio === '3:2' ? 'w-7 h-5' :
                                  resolution.ratio === '4:3' ? 'w-7 h-5' :
                                  resolution.ratio === '1:1' ? 'w-6 h-6' :
                                  resolution.ratio === '3:4' ? 'w-5 h-7' :
                                  resolution.ratio === '2:3' ? 'w-5 h-7' :
                                  resolution.ratio === '9:16' ? 'w-4 h-8' :
                                  'w-6 h-6'
                                }`}
                              ></div>
                            </div>
                          )}
                          <span className="font-medium">{resolution.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 选择分辨率 */}
                  <div className="mb-3">
                    <label className="block text-xs text-gray-400 mb-2">选择分辨率</label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: '高清 2K', value: '2K' },
                        { label: '超清 4K', value: '4K' }
                      ].map(res => (
                        <button
                          key={res.value}
                          onClick={() => handleQualitySelect(res.value as '2K' | '4K')}
                          className={`px-3 py-2 text-sm rounded transition-all duration-300 ${
                            resolutionQuality === res.value
                              ? 'bg-blue-500 text-white'
                              : 'bg-gray-700/50 text-gray-300 hover:bg-gray-600/50'
                          }`}
                        >
                          {res.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 尺寸 */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-2">尺寸</label>
                    <div className="flex gap-2 items-center">
                      <div className="flex-1">
                        <input
                          type="number"
                          value={customWidth}
                          onChange={(e) => handleManualWidthChange(e.target.value)}
                          disabled={selectedResolution === 'smart'}
                          placeholder="2048"
                          className={`w-full bg-gray-700/50 border border-gray-600 rounded px-3 py-2 text-sm ${
                            selectedResolution === 'smart' ? 'opacity-50 cursor-not-allowed' : ''
                          }`}
                          min="1024"
                          max="8192"
                        />
                      </div>
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path>
                      </svg>
                      <div className="flex-1">
                        <input
                          type="number"
                          value={customHeight}
                          onChange={(e) => handleManualHeightChange(e.target.value)}
                          disabled={selectedResolution === 'smart'}
                          placeholder="2048"
                          className={`w-full bg-gray-700/50 border border-gray-600 rounded px-3 py-2 text-sm ${
                            selectedResolution === 'smart' ? 'opacity-50 cursor-not-allowed' : ''
                          }`}
                          min="1024"
                          max="8192"
                        />
                      </div>
                      <span className="text-xs text-gray-400">PX</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 即梦图片生成4.0参数设置 - 仅对即梦模型显示 */}
        {selectedModel === 'seedream-4.0' && (
          <>
            {/* 批量生成开关 */}
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-300">批量生成</label>
              <div className="flex gap-1 h-[38px]">
                <button
                  onClick={() => setSequentialImageGeneration('auto')}
                  className={`px-3 py-2 text-sm rounded transition-all duration-300 ${
                    sequentialImageGeneration === 'auto'
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-700/50 text-gray-300 hover:bg-gray-600/50'
                  }`}
                >
                  自动
                </button>
                <button
                  onClick={() => setSequentialImageGeneration('disabled')}
                  className={`px-3 py-2 text-sm rounded transition-all duration-300 ${
                    sequentialImageGeneration === 'disabled'
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-700/50 text-gray-300 hover:bg-gray-600/50'
                  }`}
                >
                  禁用
                </button>
              </div>
            </div>

            {/* 最大图像数量 */}
            {sequentialImageGeneration === 'auto' && (
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-300">最大数量</label>
                <input
                  type="number"
                  value={maxImages}
                  onChange={(e) => setMaxImages(Math.min(15, Math.max(1, parseInt(e.target.value) || 1)))}
                  className="w-20 bg-gray-700/50 border border-gray-600 rounded px-3 py-2 h-[38px] text-sm transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  min="1"
                  max="15"
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* 输入区域 */}
      <div className="relative">
        {/* 图片上传和预览区域 - 独立一行 */}
        <div className="mb-3">
          <div className="flex items-center gap-2">
            {/* 已上传的图片 - 横向排列 */}
            {uploadedImages.map((image, index) => (
              <div
                key={`${image}-${index}`}
                className="relative group flex-shrink-0"
                style={{
                  animation: removingImages.has(image)
                    ? 'imageSlideOut 0.25s ease-in forwards' 
                    : 'imageSlideIn 0.25s ease-out forwards'
                }}
              >
                <div className="relative w-12 h-16 rounded-lg shadow-lg">
                  <img
                    src={image}
                    alt={`Uploaded ${index + 1}`}
                    className="w-full h-full object-cover rounded-lg border-2 border-white"
                  />
                  {/* 删除按钮 - 只在hover时显示，不再有初始加载时的闪烁 */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      removeImage(index)
                    }}
                    className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 shadow-lg z-20"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}

            {/* 上传按钮 - 紧跟在图片之后 */}
            <div 
              key={`upload-btn-${uploadedImages.length}`}
              className="w-12 h-16 bg-gray-700/80 backdrop-blur-sm rounded-lg shadow-lg border-2 border-dashed border-gray-500 hover:border-gray-400 flex items-center justify-center transition-all duration-200 cursor-pointer flex-shrink-0"
              onClick={() => imageFileInputRef.current?.click()}
              style={{
                animation: 'imageSlideIn 0.25s ease-out forwards'
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </div>
          </div>
        </div>

        {/* 文本输入框 - 独立一行 */}
        <div className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={handlePaste}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              const files = Array.from(e.dataTransfer.files).filter(file => file.type.startsWith('image/'))
              if (files.length > 0) {
                handleImageFileDrop(files)
              }
            }}
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (e.ctrlKey) {
                  // Ctrl+Enter 换行
                  return
                } else {
                  // Enter 生成
                  e.preventDefault()
                  handleGenerate()
                }
              }
            }}
            placeholder="描述想要生成的图片"
            className="w-full bg-gray-800/70 backdrop-blur-lg border border-gray-700/50 rounded-xl p-4 pr-14 min-h-[100px] resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all duration-300 text-white placeholder-gray-400"
            disabled={isLoading}
          />
          
          {/* 生成按钮 */}
          <button
            onClick={handleGenerate}
            disabled={isLoading || (!input.trim() && uploadedImages.length === 0)}
            className={`absolute bottom-3 right-3 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${
              isLoading || (!input.trim() && uploadedImages.length === 0)
                ? 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
                : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white shadow-lg hover:shadow-xl transform hover:scale-105'
            }`}
          >
            {isLoading ? (
              <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex flex-wrap gap-3 mt-4">
        <button
          onClick={() => {
            setInput('')
            setUploadedImages([])
            setMediaType('text')
          }}
          disabled={isLoading}
          className="px-4 py-2 bg-gray-700/50 hover:bg-gray-600/50 backdrop-blur-lg rounded-lg transition-all duration-300 border border-gray-600/50 flex items-center text-sm"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          清除
        </button>
        
        {/* 设置按钮 */}
        <button
          onClick={onOpenSettings}
          className="px-4 py-2 bg-gray-700/50 hover:bg-gray-600/50 backdrop-blur-lg rounded-lg transition-all duration-300 border border-gray-600/50 flex items-center text-sm"
          title="API设置"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          设置
        </button>
      </div>

      {/* 隐藏的文件输入 */}
      <input
        type="file"
        ref={imageFileInputRef}
        onChange={handleImageFileUpload}
        accept="image/*"
        multiple
        className="hidden"
      />
    </div>
  )
}

export default MediaGenerator