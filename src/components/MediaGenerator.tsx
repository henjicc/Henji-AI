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
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false)
  const [modelDropdownClosing, setModelDropdownClosing] = useState(false)
  const [isResolutionDropdownOpen, setIsResolutionDropdownOpen] = useState(false)
  const [selectedResolution, setSelectedResolution] = useState('2048x2048')
  const [customWidth, setCustomWidth] = useState('')
  const [customHeight, setCustomHeight] = useState('')
  const [sequentialImageGeneration, setSequentialImageGeneration] = useState<'auto' | 'disabled'>('auto')
  const [maxImages, setMaxImages] = useState<number>(1)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageFileInputRef = useRef<HTMLInputElement>(null)
  const modelRef = useRef<HTMLDivElement>(null)
  const resolutionRef = useRef<HTMLDivElement>(null)

  const currentProvider = providers.find(p => p.id === selectedProvider)
  const currentModel = currentProvider?.models.find(m => m.id === selectedModel)

  // 预设分辨率选项
  const presetResolutions = [
    { label: '1:1', value: '2048x2048', ratio: '1:1' },
    { label: '4:3', value: '2304x1728', ratio: '4:3' },
    { label: '3:4', value: '1728x2304', ratio: '3:4' },
    { label: '16:9', value: '2560x1440', ratio: '16:9' },
    { label: '9:16', value: '1440x2560', ratio: '9:16' },
    { label: '3:2', value: '2496x1664', ratio: '3:2' },
    { label: '2:3', value: '1664x2496', ratio: '2:3' },
    { label: '21:9', value: '3024x1296', ratio: '21:9' },
    { label: '自定义', value: 'custom' },
    { label: '跟随图片', value: 'follow-image' }
  ]

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

  const handleGenerate = () => {
    if ((!input.trim() && uploadedImages.length === 0) || isLoading) return
    
    // 构建生成选项
    const options: any = {}
    
    // 如果是图片模型，添加图片和分辨率选项
    if (currentModel?.type === 'image') {
      if (uploadedImages.length > 0) {
        options.images = uploadedImages
      }
      
      // 处理分辨率设置
      if (selectedResolution === 'custom') {
        if (customWidth && customHeight) {
          options.size = `${customWidth}x${customHeight}`
        }
      } else if (selectedResolution !== 'follow-image') {
        options.size = selectedResolution
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
      const newImages: string[] = []
      let processedCount = 0
      
      files.forEach(file => {
        if (file) {
          const reader = new FileReader()
          reader.onload = (event) => {
            if (event.target?.result) {
              newImages.push(event.target.result as string)
              processedCount++
              
              // 当所有文件都处理完后更新状态
              if (processedCount === files.length) {
                setUploadedImages(prev => [...prev, ...newImages])
                setMediaType('image')
              }
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
    setUploadedImages(prev => prev.filter((_, i) => i !== index))
  }

  const clearAllImages = () => {
    setUploadedImages([])
  }

  const handleModelSelect = (providerId: string, modelId: string) => {
    setSelectedProvider(providerId)
    setSelectedModel(modelId)
    handleCloseModelDropdown()
  }

  const handleResolutionSelect = (resolution: string) => {
    setSelectedResolution(resolution)
    if (resolution !== 'custom') {
      setIsResolutionDropdownOpen(false)
    }
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
                {selectedResolution === 'custom' 
                  ? `${customWidth}x${customHeight}` 
                  : selectedResolution === 'follow-image' 
                  ? '跟随图片' 
                  : presetResolutions.find(r => r.value === selectedResolution)?.label}
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
              <div className="absolute z-20 mb-1 w-64 bg-gray-800/90 backdrop-blur-xl border border-gray-700/50 rounded-lg shadow-lg bottom-full right-0 mb-2 animate-scale-in">
                <div className="p-3">
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {presetResolutions.map(resolution => (
                      <button
                        key={resolution.value}
                        onClick={() => handleResolutionSelect(resolution.value)}
                        className={`px-2 py-2 text-xs rounded flex flex-col items-center transition-all duration-300 ${
                          selectedResolution === resolution.value
                            ? 'bg-blue-500 text-white'
                            : 'bg-gray-700/50 text-gray-300 hover:bg-gray-600/50'
                        }`}
                      >
                        <span className="font-medium">{resolution.label}</span>
                        {resolution.ratio && (
                          <div className="mt-1 relative">
                            <div 
                              className={`border border-gray-400 ${
                                resolution.ratio === '1:1' ? 'w-6 h-6' :
                                resolution.ratio === '4:3' ? 'w-8 h-6' :
                                resolution.ratio === '3:4' ? 'w-6 h-8' :
                                resolution.ratio === '16:9' ? 'w-10 h-6' :
                                resolution.ratio === '9:16' ? 'w-6 h-10' :
                                resolution.ratio === '3:2' ? 'w-8 h-6' :
                                resolution.ratio === '2:3' ? 'w-6 h-8' :
                                resolution.ratio === '21:9' ? 'w-12 h-5' :
                                'w-6 h-6'
                              }`}
                            ></div>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                  
                  {selectedResolution === 'custom' && (
                    <div className="flex gap-2 mt-2">
                      <div className="flex-1">
                        <label className="block text-xs text-gray-400 mb-1">宽度</label>
                        <input
                          type="number"
                          value={customWidth}
                          onChange={(e) => setCustomWidth(e.target.value)}
                          placeholder="宽度"
                          className="w-full bg-gray-700/50 border border-gray-600 rounded px-2 py-1 text-sm"
                          min="1024"
                          max="4096"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs text-gray-400 mb-1">高度</label>
                        <input
                          type="number"
                          value={customHeight}
                          onChange={(e) => setCustomHeight(e.target.value)}
                          placeholder="高度"
                          className="w-full bg-gray-700/50 border border-gray-600 rounded px-2 py-1 text-sm"
                          min="1024"
                          max="4096"
                        />
                      </div>
                    </div>
                  )}
                  
                  <div className="mt-2 text-xs text-gray-400">
                    {selectedResolution === 'follow-image' 
                      ? '分辨率将跟随第一张上传图片的尺寸（不超过4096x4096）' 
                      : selectedResolution === 'custom'
                      ? '自定义分辨率（范围：1024x1024 到 4096x4096）'
                      : '预设分辨率'}
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

      {/* 上传的图片预览 */}
      {uploadedImages.length > 0 && (
        <div className="mb-4">
          <div className="flex justify-between items-center mb-2">
            <label className="block text-sm font-medium text-gray-300">已上传图片 ({uploadedImages.length})</label>
            <button
              onClick={clearAllImages}
              className="text-xs text-red-400 hover:text-red-300 flex items-center"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              清除全部
            </button>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 max-h-32 overflow-y-auto p-1">
            {uploadedImages.map((image, index) => (
              <div key={index} className="relative group">
                <img 
                  src={image} 
                  alt={`Uploaded ${index + 1}`} 
                  className="w-full h-16 object-cover rounded border border-gray-600"
                />
                <button
                  onClick={() => removeImage(index)}
                  className="absolute -top-1 -right-1 bg-red-500 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 输入区域 */}
      <div className="mb-4">
        <div className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={handlePaste}
            placeholder="输入提示词..."
            className="w-full bg-gray-800/70 backdrop-blur-lg border border-gray-700/50 rounded-xl p-4 min-h-[120px] resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all duration-300 text-white placeholder-gray-400"
            disabled={isLoading}
          />
          <div className="absolute bottom-3 right-3 flex gap-2">
            <button
              onClick={() => imageFileInputRef.current?.click()}
              disabled={isLoading}
              className="p-2 bg-gray-700/50 hover:bg-gray-600/50 rounded-lg transition-all duration-300 backdrop-blur-sm border border-gray-600/50"
              title="上传图片"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="p-2 bg-gray-700/50 hover:bg-gray-600/50 rounded-lg transition-all duration-300 backdrop-blur-sm border border-gray-600/50"
              title="上传文本文件"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={handleGenerate}
          disabled={isLoading || (!input.trim() && uploadedImages.length === 0)}
          className={`flex-1 min-w-[120px] px-6 py-3 rounded-xl font-medium transition-all duration-300 flex items-center justify-center ${
            isLoading || (!input.trim() && uploadedImages.length === 0)
              ? 'bg-gray-700/50 text-gray-400 cursor-not-allowed'
              : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white shadow-lg hover:shadow-xl transform hover:-translate-y-0.5'
          }`}
        >
          {isLoading ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              生成中...
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              生成
            </>
          )}
        </button>

        <button
          onClick={() => {
            setInput('')
            setUploadedImages([])
            setMediaType('text')
          }}
          disabled={isLoading}
          className="px-4 py-3 bg-gray-700/50 hover:bg-gray-600/50 backdrop-blur-lg rounded-xl transition-all duration-300 border border-gray-600/50 flex items-center"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
        
        {/* 设置按钮 */}
        <button
          onClick={onOpenSettings}
          className="px-4 py-3 bg-gray-700/50 hover:bg-gray-600/50 backdrop-blur-lg rounded-xl transition-all duration-300 border border-gray-600/50 flex items-center"
          title="API设置"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      {/* 隐藏的文件输入 */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleTextFileUpload}
        accept=".txt"
        className="hidden"
      />
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