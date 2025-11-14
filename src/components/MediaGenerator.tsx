import React, { useState, useRef, useEffect } from 'react'
import { providers } from '../config/providers'
import { saveUploadImage, dataUrlToBlob } from '@/utils/save'

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
  const [uploadedFilePaths, setUploadedFilePaths] = useState<string[]>([])
  const [isImageGalleryExpanded, setIsImageGalleryExpanded] = useState(false)
  const [removingImages, setRemovingImages] = useState<Set<string>>(new Set())
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false)
  const [modelDropdownClosing, setModelDropdownClosing] = useState(false)
  const [modelFilterProvider, setModelFilterProvider] = useState<string>('all')
  const [modelFilterType, setModelFilterType] = useState<'all' | 'image' | 'video' | 'audio'>('all')
  const [isResolutionDropdownOpen, setIsResolutionDropdownOpen] = useState(false)
  const [selectedResolution, setSelectedResolution] = useState('smart')  // 默认为智能模式
  const [resolutionQuality, setResolutionQuality] = useState<'2K' | '4K'>('2K') // 2K/4K切换，默认2K
  const [customWidth, setCustomWidth] = useState('')
  const [customHeight, setCustomHeight] = useState('')
  const [isManualInput, setIsManualInput] = useState(false) // 标记是否手动输入
  const [sequentialImageGeneration, setSequentialImageGeneration] = useState<'auto' | 'disabled'>('auto')
  const [maxImages, setMaxImages] = useState<number>(15)
  const [isViduModeDropdownOpen, setIsViduModeDropdownOpen] = useState(false)
  const [viduModeDropdownClosing, setViduModeDropdownClosing] = useState(false)
  const [isViduAspectDropdownOpen, setIsViduAspectDropdownOpen] = useState(false)
  const [viduAspectDropdownClosing, setViduAspectDropdownClosing] = useState(false)
  const [isViduMovementDropdownOpen, setIsViduMovementDropdownOpen] = useState(false)
  const [viduMovementDropdownClosing, setViduMovementDropdownClosing] = useState(false)
  const [isViduStyleDropdownOpen, setIsViduStyleDropdownOpen] = useState(false)
  const [viduStyleDropdownClosing, setViduStyleDropdownClosing] = useState(false)
  const [isViduBgmDropdownOpen, setIsViduBgmDropdownOpen] = useState(false)
  const [viduBgmDropdownClosing, setViduBgmDropdownClosing] = useState(false)
  
  // Vidu Q1 参数
  const [viduMode, setViduMode] = useState<'text-image-to-video' | 'start-end-frame' | 'reference-to-video'>('text-image-to-video')
  const [viduAspectRatio, setViduAspectRatio] = useState('16:9')
  const [viduStyle, setViduStyle] = useState('general')
  const [viduDuration, setViduDuration] = useState(5)
  const [viduMovementAmplitude, setViduMovementAmplitude] = useState('auto')
  const [viduBgm, setViduBgm] = useState(false)
  const [videoDuration, setVideoDuration] = useState(5)
  const [videoAspectRatio, setVideoAspectRatio] = useState('16:9')
  const [videoResolution, setVideoResolution] = useState('540p')
  const [videoSeed, setVideoSeed] = useState<number | undefined>(undefined)
  const [videoNegativePrompt, setVideoNegativePrompt] = useState('')
  const [klingCfgScale, setKlingCfgScale] = useState(0.5)
  const [pixFastMode, setPixFastMode] = useState(false)
  const [pixStyle, setPixStyle] = useState<string | undefined>(undefined)
  const [minimaxEnablePromptExpansion, setMinimaxEnablePromptExpansion] = useState(true)
  const [hailuoFastMode, setHailuoFastMode] = useState(false)
  const [wanSize, setWanSize] = useState('1920*1080')
  const [wanResolution, setWanResolution] = useState('1080P')
  const [wanPromptExtend, setWanPromptExtend] = useState(true)
  const [wanWatermark, setWanWatermark] = useState(false)
  const [wanAudio, setWanAudio] = useState(true)
  const [wanAudioUrl, setWanAudioUrl] = useState('')
  const [wanImageUrl, setWanImageUrl] = useState('')
  const [seedanceResolution, setSeedanceResolution] = useState('720p')
  const [seedanceAspectRatio, setSeedanceAspectRatio] = useState('16:9')
  const [seedanceDuration, setSeedanceDuration] = useState(5)
  const [seedanceCameraFixed, setSeedanceCameraFixed] = useState(false)
  const [seedanceUseLastImage, setSeedanceUseLastImage] = useState(false)
  const [isKlingDurationDropdownOpen, setIsKlingDurationDropdownOpen] = useState(false)
  const [klingDurationDropdownClosing, setKlingDurationDropdownClosing] = useState(false)
  const [isKlingAspectDropdownOpen, setIsKlingAspectDropdownOpen] = useState(false)
  const [klingAspectDropdownClosing, setKlingAspectDropdownClosing] = useState(false)
  const [isHailuoDurationDropdownOpen, setIsHailuoDurationDropdownOpen] = useState(false)
  const [hailuoDurationDropdownClosing, setHailuoDurationDropdownClosing] = useState(false)
  const [isHailuoResolutionDropdownOpen, setIsHailuoResolutionDropdownOpen] = useState(false)
  const [hailuoResolutionDropdownClosing, setHailuoResolutionDropdownClosing] = useState(false)
  const [isPixAspectDropdownOpen, setIsPixAspectDropdownOpen] = useState(false)
  const [pixAspectDropdownClosing, setPixAspectDropdownClosing] = useState(false)
  const [isPixResolutionDropdownOpen, setIsPixResolutionDropdownOpen] = useState(false)
  const [pixResolutionDropdownClosing, setPixResolutionDropdownClosing] = useState(false)
  
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageFileInputRef = useRef<HTMLInputElement>(null)
  const modelRef = useRef<HTMLDivElement>(null)
  const resolutionRef = useRef<HTMLDivElement>(null)
  const viduModeRef = useRef<HTMLDivElement>(null)
  const viduAspectRef = useRef<HTMLDivElement>(null)
  const viduMovementRef = useRef<HTMLDivElement>(null)
  const viduStyleRef = useRef<HTMLDivElement>(null)
  const viduBgmRef = useRef<HTMLDivElement>(null)
  const klingDurationRef = useRef<HTMLDivElement>(null)
  const klingAspectRef = useRef<HTMLDivElement>(null)
  const hailuoDurationRef = useRef<HTMLDivElement>(null)
  const hailuoResolutionRef = useRef<HTMLDivElement>(null)
  const pixAspectRef = useRef<HTMLDivElement>(null)
  const pixResolutionRef = useRef<HTMLDivElement>(null)

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

  // Hailuo 时长-分辨率联动与默认值
  useEffect(() => {
    if (currentModel?.type === 'video' && (selectedModel === 'minimax-hailuo-2.3' || selectedModel === 'minimax-hailuo-02')) {
      if (videoDuration !== 6 && videoDuration !== 10) {
        setVideoDuration(6)
      }
      const currentRes = (videoResolution || '').toUpperCase()
      if (videoDuration === 10) {
        if (currentRes !== '768P') {
          setVideoResolution('768P')
        }
      } else {
        if (currentRes !== '768P' && currentRes !== '1080P') {
          setVideoResolution('768P')
        }
      }
    }
  }, [selectedModel, videoDuration, videoResolution])

  // PixVerse 分辨率规范化
  useEffect(() => {
    if (currentModel?.type === 'video' && selectedModel === 'pixverse-v4.5') {
      const s = (videoResolution || '').toLowerCase()
      const allowed = ['360p', '540p', '720p', '1080p']
      if (!allowed.includes(s)) {
        setVideoResolution('540p')
      }
      if (pixFastMode && s === '1080p') {
        setVideoResolution('720p')
      }
    }
  }, [selectedModel, videoResolution, pixFastMode])

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
        
        // 优化算法：在保持原图比例的前提下，让分辨率尽可能接近目标像素数
        // 计算能达到目标像素数的理想尺寸
        const targetHeight = Math.sqrt(maxPixels / aspectRatio)
        const targetWidth = targetHeight * aspectRatio
        
        // 取整到合理的值（8的倍数，便于编码）
        let width = Math.floor(targetWidth / 8) * 8
        let height = Math.floor(targetHeight / 8) * 8
        
        // 2K模式：允许略微超过目标像素（最多105%），以更接近理想尺寸
        // 4K模式：严格不超过目标像素
        if (resolutionQuality === '2K') {
          // 2K模式：如果当前尺寸略小，尝试增加到8的倍数，允许略微超过
          const currentPixels = width * height
          if (currentPixels < maxPixels) {
            // 尝试增加宽度或高度，看是否能更接近目标
            const withExtraWidth = (width + 8) * height
            const withExtraHeight = width * (height + 8)
            
            // 选择更接近目标且不超过105%的方案
            const maxAllowed = maxPixels * 1.05
            if (withExtraWidth <= maxAllowed && Math.abs(withExtraWidth - maxPixels) < Math.abs(currentPixels - maxPixels)) {
              width += 8
            } else if (withExtraHeight <= maxAllowed && Math.abs(withExtraHeight - maxPixels) < Math.abs(currentPixels - maxPixels)) {
              height += 8
            }
          }
        } else {
          // 4K模式：严格确保不超过最大像素限制
          if (width * height > maxPixels) {
            // 微调：减小尺寸确保不超过限制
            const scale = Math.sqrt(maxPixels / (width * height))
            width = Math.floor(width * scale / 8) * 8
            height = Math.floor(height * scale / 8) * 8
          }
        }
        
        // 确保最小尺寸（至少512像素）
        if (width < 512) width = 512
        if (height < 512) height = 512
        
        // 最终验证：4K模式严格检查，2K模式允许105%
        const finalPixels = width * height
        const maxAllowed = resolutionQuality === '2K' ? maxPixels * 1.05 : maxPixels
        if (finalPixels > maxAllowed) {
          const scale = Math.sqrt(maxAllowed / finalPixels)
          width = Math.floor(width * scale / 8) * 8
          height = Math.floor(height * scale / 8) * 8
        }
        
        console.log('[MediaGenerator] 智能分辨率计算:', {
          原图尺寸: `${originalWidth}x${originalHeight}`,
          宽高比: aspectRatio.toFixed(3),
          质量模式: resolutionQuality,
          目标像素: maxPixels,
          计算结果: `${width}x${height}`,
          实际像素: width * height,
          利用率: `${((width * height / maxPixels) * 100).toFixed(1)}%`,
          允许超限: resolutionQuality === '2K' ? '是(105%)' : '否(严格)'
        })
        
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
      if (viduModeRef.current && !viduModeRef.current.contains(event.target as Node) && isViduModeDropdownOpen) {
        handleCloseViduModeDropdown()
      }
      if (viduAspectRef.current && !viduAspectRef.current.contains(event.target as Node) && isViduAspectDropdownOpen) {
        handleCloseViduAspectDropdown()
      }
      if (viduMovementRef.current && !viduMovementRef.current.contains(event.target as Node) && isViduMovementDropdownOpen) {
        handleCloseViduMovementDropdown()
      }
      if (viduStyleRef.current && !viduStyleRef.current.contains(event.target as Node) && isViduStyleDropdownOpen) {
        handleCloseViduStyleDropdown()
      }
      if (viduBgmRef.current && !viduBgmRef.current.contains(event.target as Node) && isViduBgmDropdownOpen) {
        handleCloseViduBgmDropdown()
      }
      if (klingDurationRef.current && !klingDurationRef.current.contains(event.target as Node) && isKlingDurationDropdownOpen) {
        handleCloseKlingDurationDropdown()
      }
      if (klingAspectRef.current && !klingAspectRef.current.contains(event.target as Node) && isKlingAspectDropdownOpen) {
        handleCloseKlingAspectDropdown()
      }
      if (hailuoDurationRef.current && !hailuoDurationRef.current.contains(event.target as Node) && isHailuoDurationDropdownOpen) {
        handleCloseHailuoDurationDropdown()
      }
      if (hailuoResolutionRef.current && !hailuoResolutionRef.current.contains(event.target as Node) && isHailuoResolutionDropdownOpen) {
        handleCloseHailuoResolutionDropdown()
      }
      if (pixAspectRef.current && !pixAspectRef.current.contains(event.target as Node) && isPixAspectDropdownOpen) {
        handleClosePixAspectDropdown()
      }
      if (pixResolutionRef.current && !pixResolutionRef.current.contains(event.target as Node) && isPixResolutionDropdownOpen) {
        handleClosePixResolutionDropdown()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isModelDropdownOpen, isResolutionDropdownOpen, isViduModeDropdownOpen, isViduAspectDropdownOpen, isViduMovementDropdownOpen, isViduStyleDropdownOpen, isViduBgmDropdownOpen, isKlingDurationDropdownOpen, isKlingAspectDropdownOpen, isHailuoDurationDropdownOpen, isHailuoResolutionDropdownOpen, isPixAspectDropdownOpen, isPixResolutionDropdownOpen])

  const handleCloseModelDropdown = () => {
    setModelDropdownClosing(true)
    setTimeout(() => {
      setIsModelDropdownOpen(false)
      setModelDropdownClosing(false)
    }, 200)
  }

  const handleCloseViduModeDropdown = () => {
    setViduModeDropdownClosing(true)
    setTimeout(() => {
      setIsViduModeDropdownOpen(false)
      setViduModeDropdownClosing(false)
    }, 200)
  }

  const handleCloseViduAspectDropdown = () => {
    setViduAspectDropdownClosing(true)
    setTimeout(() => {
      setIsViduAspectDropdownOpen(false)
      setViduAspectDropdownClosing(false)
    }, 200)
  }

  const handleCloseViduMovementDropdown = () => {
    setViduMovementDropdownClosing(true)
    setTimeout(() => {
      setIsViduMovementDropdownOpen(false)
      setViduMovementDropdownClosing(false)
    }, 200)
  }

  const handleCloseViduStyleDropdown = () => {
    setViduStyleDropdownClosing(true)
    setTimeout(() => {
      setIsViduStyleDropdownOpen(false)
      setViduStyleDropdownClosing(false)
    }, 200)
  }

  const handleCloseViduBgmDropdown = () => {
    setViduBgmDropdownClosing(true)
    setTimeout(() => {
      setIsViduBgmDropdownOpen(false)
      setViduBgmDropdownClosing(false)
    }, 200)
  }

  const handleCloseKlingDurationDropdown = () => {
    setKlingDurationDropdownClosing(true)
    setTimeout(() => {
      setIsKlingDurationDropdownOpen(false)
      setKlingDurationDropdownClosing(false)
    }, 200)
  }

  const handleCloseKlingAspectDropdown = () => {
    setKlingAspectDropdownClosing(true)
    setTimeout(() => {
      setIsKlingAspectDropdownOpen(false)
      setKlingAspectDropdownClosing(false)
    }, 200)
  }

  const handleCloseHailuoDurationDropdown = () => {
    setHailuoDurationDropdownClosing(true)
    setTimeout(() => {
      setIsHailuoDurationDropdownOpen(false)
      setHailuoDurationDropdownClosing(false)
    }, 200)
  }

  const handleCloseHailuoResolutionDropdown = () => {
    setHailuoResolutionDropdownClosing(true)
    setTimeout(() => {
      setIsHailuoResolutionDropdownOpen(false)
      setHailuoResolutionDropdownClosing(false)
    }, 200)
  }

  const handleClosePixAspectDropdown = () => {
    setPixAspectDropdownClosing(true)
    setTimeout(() => {
      setIsPixAspectDropdownOpen(false)
      setPixAspectDropdownClosing(false)
    }, 200)
  }

  const handleClosePixResolutionDropdown = () => {
    setPixResolutionDropdownClosing(true)
    setTimeout(() => {
      setIsPixResolutionDropdownOpen(false)
      setPixResolutionDropdownClosing(false)
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
      const paths: string[] = []
      for (const data of uploadedImages) {
        const blob = await dataUrlToBlob(data)
        const saved = await saveUploadImage(blob)
        paths.push(saved.fullPath)
      }
      setUploadedFilePaths(paths)
      options.uploadedFilePaths = paths
    }
      
      // 处理分辨率设置
      if (selectedResolution === 'smart') {
        // 智能模式:根据第一张图片计算
        if (uploadedImages.length > 0) {
          const smartSize = await calculateSmartResolution(uploadedImages[0])
          options.size = smartSize
        } else {
          // 没有图片时使用质量对应的默认分辨率
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
    
    if (currentModel?.type === 'video' && selectedModel === 'vidu-q1') {
      options.mode = viduMode
      options.duration = viduDuration
      options.movementAmplitude = viduMovementAmplitude
      options.bgm = viduBgm
      
      // 根据模式添加不同的参数
      if (viduMode === 'text-image-to-video') {
        // 文/图生视频：最多1张图片
        if (uploadedImages.length > 0) {
          options.images = [uploadedImages[0]]
          const blob = await dataUrlToBlob(uploadedImages[0])
          const saved = await saveUploadImage(blob)
          options.uploadedFilePaths = [saved.fullPath]
          setUploadedFilePaths([saved.fullPath])
        }
        // 只有文生视频才支持aspect_ratio和style
        if (uploadedImages.length === 0) {
          options.aspectRatio = viduAspectRatio
          options.style = viduStyle
        }
      } else if (viduMode === 'start-end-frame') {
        // 首尾帧：必须2张图片
        if (uploadedImages.length < 2) {
          alert('首尾帧模式需要至少2张图片')
          return
        }
        options.images = uploadedImages.slice(0, 2)
        const p2: string[] = []
        for (const data of uploadedImages.slice(0, 2)) {
          const blob = await dataUrlToBlob(data)
          const saved = await saveUploadImage(blob)
          p2.push(saved.fullPath)
        }
        options.uploadedFilePaths = p2
        setUploadedFilePaths(p2)
      } else if (viduMode === 'reference-to-video') {
        // 参考生视频：1-7张图片，必须prompt
        if (uploadedImages.length < 1 || uploadedImages.length > 7) {
          alert('参考生视频模式需要1-7张图片')
          return
        }
        if (!input.trim()) {
          alert('参考生视频模式必须提供文本提示词')
          return
        }
        options.images = uploadedImages.slice(0, 7)
        const p7: string[] = []
        for (const data of uploadedImages.slice(0, 7)) {
          const blob = await dataUrlToBlob(data)
          const saved = await saveUploadImage(blob)
          p7.push(saved.fullPath)
        }
        options.uploadedFilePaths = p7
        setUploadedFilePaths(p7)
        options.aspectRatio = viduAspectRatio
      }
      
      console.log('[MediaGenerator] Vidu Q1 生成参数:', {
        mode: viduMode,
        imageCount: uploadedImages.length,
        options
      })
    } else if (currentModel?.type === 'video' && selectedModel === 'kling-2.5-turbo') {
      options.duration = videoDuration
      options.cfgScale = klingCfgScale
      options.negativePrompt = videoNegativePrompt
      if (uploadedImages.length === 0) {
        options.aspectRatio = videoAspectRatio
      } else {
        options.images = [uploadedImages[0]]
        const blob = await dataUrlToBlob(uploadedImages[0])
        const saved = await saveUploadImage(blob)
        options.uploadedFilePaths = [saved.fullPath]
        setUploadedFilePaths([saved.fullPath])
      }
      
    } else if (currentModel?.type === 'video' && selectedModel === 'minimax-hailuo-2.3') {
      options.duration = videoDuration || 6
      options.resolution = videoResolution || '768P'
      options.promptExtend = minimaxEnablePromptExpansion
      if (uploadedImages.length > 0) {
        options.images = [uploadedImages[0]]
        const blob = await dataUrlToBlob(uploadedImages[0])
        const saved = await saveUploadImage(blob)
        options.uploadedFilePaths = [saved.fullPath]
        setUploadedFilePaths([saved.fullPath])
      }
      if (uploadedImages.length > 0) {
        ;(options as any).hailuoFast = hailuoFastMode
      }
    } else if (currentModel?.type === 'video' && selectedModel === 'minimax-hailuo-02') {
      options.duration = videoDuration || 6
      options.resolution = videoResolution || '768P'
      options.promptExtend = minimaxEnablePromptExpansion
      if (uploadedImages.length > 0) {
        const take = Math.min(uploadedImages.length, 2)
        options.images = uploadedImages.slice(0, take)
        const paths: string[] = []
        for (const data of uploadedImages.slice(0, take)) {
          const blob = await dataUrlToBlob(data)
          const saved = await saveUploadImage(blob)
          paths.push(saved.fullPath)
        }
        options.uploadedFilePaths = paths
        setUploadedFilePaths(paths)
      }
    } else if (currentModel?.type === 'video' && selectedModel === 'pixverse-v4.5') {
      options.resolution = videoResolution
      options.negativePrompt = videoNegativePrompt
      options.fastMode = pixFastMode
      options.style = pixStyle
      if (uploadedImages.length === 0) {
        options.aspectRatio = videoAspectRatio
      } else {
        options.images = [uploadedImages[0]]
        const blob = await dataUrlToBlob(uploadedImages[0])
        const saved = await saveUploadImage(blob)
        options.uploadedFilePaths = [saved.fullPath]
        setUploadedFilePaths([saved.fullPath])
      }
      if (videoSeed !== undefined) options.seed = videoSeed
    } else if (currentModel?.type === 'video' && selectedModel === 'wan-2.5-preview') {
      options.duration = videoDuration
      options.promptExtend = wanPromptExtend
      options.watermark = wanWatermark
      options.audio = wanAudio
      options.audioUrl = wanAudioUrl || undefined
      if (uploadedImages.length > 0) {
        options.imageUrl = wanImageUrl
        options.resolution = wanResolution
      } else {
        options.size = wanSize
      }
      options.negativePrompt = videoNegativePrompt
      if (videoSeed !== undefined) options.seed = videoSeed
    } else if (currentModel?.type === 'video' && (selectedModel === 'seedance-v1-lite' || selectedModel === 'seedance-v1-pro')) {
      options.resolution = seedanceResolution
      options.aspectRatio = seedanceAspectRatio
      options.duration = seedanceDuration
      options.cameraFixed = seedanceCameraFixed
      if (uploadedImages.length > 0) {
        options.images = [uploadedImages[0]]
        const blob = await dataUrlToBlob(uploadedImages[0])
        const saved = await saveUploadImage(blob)
        options.uploadedFilePaths = [saved.fullPath]
        setUploadedFilePaths([saved.fullPath])
        if (selectedModel === 'seedance-v1-lite' && seedanceUseLastImage && uploadedImages.length > 1) {
          options.lastImage = uploadedImages[uploadedImages.length - 1]
        }
      }
      if (videoSeed !== undefined) options.seed = videoSeed
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

  const handleImageFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) {
      // 计算最大图片数
      let maxImageCount = 6 // 默认图片模型最多6张
        
      if (selectedModel === 'vidu-q1') {
        if (viduMode === 'text-image-to-video') {
          maxImageCount = 1
        } else if (viduMode === 'start-end-frame') {
          maxImageCount = 2
        } else if (viduMode === 'reference-to-video') {
          maxImageCount = 7
        }
      } else if (selectedModel === 'kling-2.5-turbo') {
        maxImageCount = 1
      }
        
      for (const file of files) {
        if (file) {
          const saved = await saveUploadImage(file, 'memory')
          setUploadedImages(prev => {
            if (prev.length >= maxImageCount) return prev
            return [...prev, saved.dataUrl]
          })
          setMediaType('image')
        }
      }
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    if (selectedModel === 'kling-2.5-turbo' && uploadedImages.length >= 1) {
      return
    }
    const items = e.clipboardData.items
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const blob = items[i].getAsFile()
        if (blob) {
          const reader = new FileReader()
          reader.onload = (event) => {
            if (event.target?.result) {
              setUploadedImages(prev => {
                if (selectedModel === 'kling-2.5-turbo' && prev.length >= 1) return prev
                return [...prev, event.target?.result as string]
              })
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
    setRemovingImages(prev => new Set(prev).add(imageToRemove))
    setTimeout(() => {
      setUploadedImages(prev => prev.filter((_, i) => i !== index))
      setUploadedFilePaths(prev => prev.filter((_, i) => i !== index))
      setRemovingImages(prev => {
        const s = new Set(prev)
        s.delete(imageToRemove)
        return s
      })
    }, 250)
  }

  const clearAllImages = async () => {
    setUploadedImages([])
    setUploadedFilePaths([])
  }

  // 处理拖拽图片
  const handleImageFileDrop = async (files: File[]) => {
    // 计算最大图片数
    let maxImageCount = 6 // 默认图片模型最多6张
      
    if (selectedModel === 'vidu-q1') {
      if (viduMode === 'text-image-to-video') {
        maxImageCount = 1
      } else if (viduMode === 'start-end-frame') {
        maxImageCount = 2
      } else if (viduMode === 'reference-to-video') {
        maxImageCount = 7
      }
    } else if (selectedModel === 'kling-2.5-turbo') {
      maxImageCount = 1
    }
      
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const saved = await saveUploadImage(file, 'memory')
        setUploadedImages(prev => {
          if (prev.length >= maxImageCount) return prev
          return [...prev, saved.dataUrl]
        })
      }
    }
  }

  const handleModelSelect = (providerId: string, modelId: string) => {
    setSelectedProvider(providerId)
    setSelectedModel(modelId)

    const getMaxImageCount = (m: string, mode?: string): number => {
      if (m === 'kling-2.5-turbo') return 1
      if (m === 'minimax-hailuo-2.3') return 1
      if (m === 'minimax-hailuo-02') return 2
      if (m === 'vidu-q1') {
        if (mode === 'start-end-frame') return 2
        if (mode === 'reference-to-video') return 7
        return 1
      }
      return 6
    }

    // 当切换到 Vidu Q1 时，根据图片数量自动选择模式
    if (modelId === 'vidu-q1') {
      const count = uploadedImages.length
      if (count >= 3) {
        // 3-7 张走参考生视频，截断到 7
        setViduMode('reference-to-video')
        if (count > 7) {
          setUploadedImages(prev => prev.slice(0, 7))
          setUploadedFilePaths(prev => prev.slice(0, 7))
        }
      } else if (count === 2) {
        setViduMode('start-end-frame')
      } else {
        setViduMode('text-image-to-video')
      }
    } else {
      // 非 Vidu：按目标模型最大支持数截断图片
      const max = getMaxImageCount(modelId, undefined)
      if (uploadedImages.length > max) {
        setUploadedImages(prev => prev.slice(0, max))
        setUploadedFilePaths(prev => prev.slice(0, max))
      }
    }
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

  const bulkTooltipTimerRef = useRef<number | null>(null)
  const [bulkTooltipVisible, setBulkTooltipVisible] = useState(false)
  const [bulkTooltipClosing, setBulkTooltipClosing] = useState(false)

  return (
    <div className="w-full max-w-5xl mx-auto">
      {/* 模型选择器、分辨率设置和即梦参数设置 */}
      <div className="flex flex-wrap gap-3 mb-4">
        {/* 合并的提供商和模型选择器 - 缩短宽度 */}
        <div className="w-auto min-w-[180px] relative" ref={modelRef}>
          <label className="block text-sm font-medium mb-1 text-zinc-300">模型</label>
          <div 
            className="bg-zinc-800/70 backdrop-blur-lg border border-[rgba(46,46,46,0.8)] rounded-lg px-3 py-2 h-[38px] focus:outline-none focus:ring-2 focus:ring-[#007eff]/50 transition-all duration-300 cursor-pointer flex items-center justify-between whitespace-nowrap"
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
              className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ml-2 ${isModelDropdownOpen ? 'rotate-180' : ''}`} 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
            </svg>
          </div>
          
          {(isModelDropdownOpen || modelDropdownClosing) && (
            <div
              className={`absolute z-20 mb-1 w-[720px] h-[420px] flex flex-col overflow-hidden bg-zinc-800 border border-[rgba(46,46,46,0.8)] rounded-lg shadow-2xl bottom-full left-1/2 -ml-[360px] mb-2 ${
                modelDropdownClosing ? 'animate-scale-out' : 'animate-scale-in'
              }`}
            >
              <div className="p-4 h-full flex flex-col">
                <div className="mb-3">
                  <div className="text-xs text-zinc-400 mb-2">供应商</div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setModelFilterProvider('all')}
                      className={`px-3 py-2 text-xs rounded transition-all duration-300 ${
                        modelFilterProvider === 'all' ? 'bg-[#007eff] text-white' : 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50'
                      }`}
                    >全部</button>
                    {providers.map(p => (
                      <button
                        key={p.id}
                        onClick={() => setModelFilterProvider(p.id)}
                        className={`px-3 py-2 text-xs rounded transition-all duration-300 ${
                          modelFilterProvider === p.id ? 'bg-[#007eff] text-white' : 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50'
                        }`}
                      >{p.name}</button>
                    ))}
                  </div>
                </div>
                <div className="mb-3">
                  <div className="text-xs text-zinc-400 mb-2">类型</div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: '全部', value: 'all' },
                      { label: '图片', value: 'image' },
                      { label: '视频', value: 'video' },
                      { label: '音频', value: 'audio' }
                    ].map(t => (
                      <button
                        key={t.value}
                        onClick={() => setModelFilterType(t.value as 'all' | 'image' | 'video' | 'audio')}
                        className={`px-3 py-2 text-xs rounded transition-all duration-300 ${
                          modelFilterType === t.value ? 'bg-[#007eff] text-white' : 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50'
                        }`}
                      >{t.label}</button>
                    ))}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <div className="grid grid-cols-3 gap-2">
                    {providers
                      .flatMap(p => p.models.map(m => ({ p, m })))
                      .filter(item => (modelFilterProvider === 'all' ? true : item.p.id === modelFilterProvider))
                      .filter(item => (modelFilterType === 'all' ? true : item.m.type === modelFilterType))
                      .map(({ p, m }) => (
                        <div
                          key={`${p.id}-${m.id}`}
                          onClick={() => handleModelSelect(p.id, m.id)}
                          className={`px-3 py-3 cursor-pointer transition-colors duration-200 rounded-lg border ${
                            selectedProvider === p.id && selectedModel === m.id
                              ? 'bg-[#007eff]/20 text-[#66b3ff] border-[#007eff]/30'
                              : 'bg-zinc-700/40 hover:bg-zinc-700/60 border-[rgba(46,46,46,0.8)]'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm">{m.name}</span>
                            <span className="text-[11px] text-zinc-400">{m.type === 'image' ? '图片' : m.type === 'video' ? '视频' : '音频'}</span>
                          </div>
                          <div className="mt-1 text-[11px] text-zinc-500">{p.name}</div>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 分辨率设置按钮 - 仅对图片模型显示 */}
        {currentModel?.type === 'image' && (
          <div className="relative" ref={resolutionRef}>
            <label className="block text-sm font-medium mb-1 text-zinc-300">分辨率</label>
            <button
              onClick={() => setIsResolutionDropdownOpen(!isResolutionDropdownOpen)}
              className="bg-zinc-800/70 backdrop-blur-lg border border-[rgba(46,46,46,0.8)] rounded-lg px-3 py-2 h-[38px] w-[80px] outline-none focus:outline-none focus-visible:outline-none active:outline-none ring-0 focus:ring-0 focus-visible:ring-0 transition-all duration-300 flex items-center justify-between"
            >
              <span className="text-sm whitespace-nowrap">
                {selectedResolution === 'smart' 
                  ? '智能' 
                  : selectedResolution}
              </span>
              <svg 
                className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ${isResolutionDropdownOpen ? 'rotate-180' : ''}`} 
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
                className="absolute z-20 mb-1 w-80 bg-zinc-800 border border-[rgba(46,46,46,0.8)] rounded-lg shadow-2xl bottom-full right-0 mb-2 animate-scale-in"
              >
                <div className="p-4">
                  {/* 选择比例 */}
                  <div className="mb-3">
                    <label className="block text-xs text-zinc-400 mb-2">选择比例</label>
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
                              ? 'bg-[#007eff] text-white'
                              : 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50'
                          }`}
                        >
                          {resolution.ratio && (
                            <div className="flex items-center justify-center h-8">
                              <div 
                                className={`border-2 border-white ${
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
                    <label className="block text-xs text-zinc-400 mb-2">选择分辨率</label>
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
                              ? 'bg-[#007eff] text-white'
                              : 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50'
                          }`}
                        >
                          {res.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 尺寸 */}
                  <div>
                    <label className="block text-xs text-zinc-400 mb-2">尺寸</label>
                    <div className="flex gap-2 items-center">
                      <div className="flex-1">
                        <input
                          type="number"
                          value={customWidth}
                          onChange={(e) => handleManualWidthChange(e.target.value)}
                          disabled={selectedResolution === 'smart'}
                          placeholder="2048"
                          className={`w-full bg-zinc-700/50 border border-[rgba(46,46,46,0.8)] rounded px-3 py-2 text-sm ${
                            selectedResolution === 'smart' ? 'opacity-50 cursor-not-allowed' : ''
                          }`}
                          min="1024"
                          max="8192"
                        />
                      </div>
                      <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path>
                      </svg>
                      <div className="flex-1">
                        <input
                          type="number"
                          value={customHeight}
                          onChange={(e) => handleManualHeightChange(e.target.value)}
                          disabled={selectedResolution === 'smart'}
                          placeholder="2048"
                          className={`w-full bg-zinc-700/50 border border-[rgba(46,46,46,0.8)] rounded px-3 py-2 text-sm ${
                            selectedResolution === 'smart' ? 'opacity-50 cursor-not-allowed' : ''
                          }`}
                          min="1024"
                          max="8192"
                        />
                      </div>
                      <span className="text-xs text-zinc-400">PX</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Vidu Q1 参数设置 - 仅对Vidu Q1模型显示 */}
        {selectedModel === 'vidu-q1' && (
          <>
            <div className="w-auto min-w-[120px] relative" ref={viduModeRef}>
              <label className="block text-sm font-medium mb-1 text-zinc-300">模式</label>
              <div
                className="bg-zinc-800/70 backdrop-blur-lg border border-[rgba(46,46,46,0.8)] rounded-lg px-3 py-2 h-[38px] focus:outline-none focus:ring-2 focus:ring-[#007eff]/50 transition-all duration-300 cursor-pointer flex items-center justify-between whitespace-nowrap"
                onClick={() => {
                  if (isViduModeDropdownOpen) {
                    handleCloseViduModeDropdown()
                  } else {
                    setIsViduModeDropdownOpen(true)
                  }
                }}
              >
                <span className="text-sm">{viduMode === 'text-image-to-video' ? '文/图生视频' : viduMode === 'start-end-frame' ? '首尾帧' : '参考生视频'}</span>
                <svg
                  className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ml-2 ${isViduModeDropdownOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                </svg>
              </div>
              {(isViduModeDropdownOpen || viduModeDropdownClosing) && (
                <div
                  className={`absolute z-20 mt-1 w-full bg-zinc-800/90 backdrop-blur-xl border border-[rgba(46,46,46,0.8)] rounded-lg shadow-lg ${viduModeDropdownClosing ? 'animate-scale-out' : 'animate-scale-in'}`}
                >
                  <div className="max-h-60 overflow-y-auto">
                    {[
                      { value: 'text-image-to-video', label: '文/图生视频' },
                      { value: 'start-end-frame', label: '首尾帧' },
                      { value: 'reference-to-video', label: '参考生视频' }
                    ].map(opt => (
                      <div
                        key={opt.value}
                        className={`px-3 py-2 cursor-pointer transition-colors duration-200 ${viduMode === opt.value ? 'bg-[#007eff]/20 text-[#66b3ff]' : 'hover:bg-zinc-700/50'}`}
                        onClick={() => {
                          setViduMode(opt.value as any)
                          handleCloseViduModeDropdown()
                        }}
                      >
                        <span className="text-sm">{opt.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 宽高比 - 仅文生视频和参考生视频支持 */}
            {(viduMode === 'text-image-to-video' && uploadedImages.length === 0 || viduMode === 'reference-to-video') && (
              <div className="w-auto min-w-[80px] relative" ref={viduAspectRef}>
                <label className="block text-sm font-medium mb-1 text-zinc-300">宽高比</label>
                <div
                  className="bg-zinc-800/70 backdrop-blur-lg border border-[rgba(46,46,46,0.8)] rounded-lg px-3 py-2 h-[38px] focus:outline-none focus:ring-2 focus:ring-[#007eff]/50 transition-all duration-300 cursor-pointer flex items-center justify-between whitespace-nowrap"
                  onClick={() => {
                    if (isViduAspectDropdownOpen) {
                      handleCloseViduAspectDropdown()
                    } else {
                      setIsViduAspectDropdownOpen(true)
                    }
                  }}
                >
                  <span className="text-sm">{viduAspectRatio}</span>
                  <svg
                    className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ml-2 ${isViduAspectDropdownOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                  </svg>
                </div>
                {(isViduAspectDropdownOpen || viduAspectDropdownClosing) && (
                <div
                  className={`absolute z-20 mt-1 w-full bg-zinc-800/90 backdrop-blur-xl border border-[rgba(46,46,46,0.8)] rounded-lg shadow-lg ${viduAspectDropdownClosing ? 'animate-scale-out' : 'animate-scale-in'}`}
                  >
                    <div className="max-h-60 overflow-y-auto">
                      {['16:9', '9:16', '1:1'].map(r => (
                        <div
                          key={r}
                          className={`px-3 py-2 cursor-pointer transition-colors duration-200 ${viduAspectRatio === r ? 'bg-[#007eff]/20 text-[#66b3ff]' : 'hover:bg-zinc-700/50'}`}
                          onClick={() => {
                            setViduAspectRatio(r)
                            handleCloseViduAspectDropdown()
                          }}
                        >
                          <span className="text-sm">{r}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 风格 - 仅文生视频支持 */}
            {viduMode === 'text-image-to-video' && uploadedImages.length === 0 && (
              <div className="w-auto min-w-[80px] relative" ref={viduStyleRef}>
                <label className="block text-sm font-medium mb-1 text-zinc-300">风格</label>
                <div
                  className="bg-zinc-800/70 backdrop-blur-lg border border-[rgba(46,46,46,0.8)] rounded-lg px-3 py-2 h-[38px] focus:outline-none focus:ring-2 focus:ring-[#007eff]/50 transition-all duration-300 cursor-pointer flex items-center justify-between whitespace-nowrap"
                  onClick={() => {
                    if (isViduStyleDropdownOpen) {
                      handleCloseViduStyleDropdown()
                    } else {
                      setIsViduStyleDropdownOpen(true)
                    }
                  }}
                >
                  <span className="text-sm">{viduStyle === 'general' ? '通用' : '动漫'}</span>
                  <svg
                    className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ml-2 ${isViduStyleDropdownOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                  </svg>
                </div>
                {(isViduStyleDropdownOpen || viduStyleDropdownClosing) && (
                <div
                  className={`absolute z-20 mt-1 w-full bg-zinc-800/90 backdrop-blur-xl border border-[rgba(46,46,46,0.8)] rounded-lg shadow-lg ${viduStyleDropdownClosing ? 'animate-scale-out' : 'animate-scale-in'}`}
                  >
                    <div className="max-h-60 overflow-y-auto">
                      {[
                        { value: 'general', label: '通用' },
                        { value: 'anime', label: '动漫' }
                      ].map(opt => (
                        <div
                          key={opt.value}
                          className={`px-3 py-2 cursor-pointer transition-colors duration-200 ${viduStyle === opt.value ? 'bg-[#007eff]/20 text-[#66b3ff]' : 'hover:bg-zinc-700/50'}`}
                          onClick={() => {
                            setViduStyle(opt.value)
                            handleCloseViduStyleDropdown()
                          }}
                        >
                          <span className="text-sm">{opt.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="w-auto min-w-[80px] relative" ref={viduMovementRef}>
              <label className="block text-sm font-medium mb-1 text-zinc-300">运动幅度</label>
              <div
                className="bg-zinc-800/70 backdrop-blur-lg border border-[rgba(46,46,46,0.8)] rounded-lg px-3 py-2 h-[38px] focus:outline-none focus:ring-2 focus:ring-[#007eff]/50 transition-all duration-300 cursor-pointer flex items-center justify-between whitespace-nowrap"
                onClick={() => {
                  if (isViduMovementDropdownOpen) {
                    handleCloseViduMovementDropdown()
                  } else {
                    setIsViduMovementDropdownOpen(true)
                  }
                }}
              >
                <span className="text-sm">{viduMovementAmplitude === 'auto' ? '自动' : viduMovementAmplitude === 'small' ? '小' : viduMovementAmplitude === 'medium' ? '中' : '大'}</span>
                <svg
                  className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ml-2 ${isViduMovementDropdownOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                </svg>
              </div>
              {(isViduMovementDropdownOpen || viduMovementDropdownClosing) && (
                <div
                  className={`absolute z-20 mt-1 w-full bg-zinc-800/90 backdrop-blur-xl border border-[rgba(46,46,46,0.8)] rounded-lg shadow-lg ${viduMovementDropdownClosing ? 'animate-scale-out' : 'animate-scale-in'}`}
                >
                  <div className="max-h-60 overflow-y-auto">
                    {[
                      { value: 'auto', label: '自动' },
                      { value: 'small', label: '小' },
                      { value: 'medium', label: '中' },
                      { value: 'large', label: '大' }
                    ].map(opt => (
                      <div
                        key={opt.value}
                        className={`px-3 py-2 cursor-pointer transition-colors duration-200 ${viduMovementAmplitude === opt.value ? 'bg-[#007eff]/20 text-[#66b3ff]' : 'hover:bg-zinc-700/50'}`}
                        onClick={() => {
                          setViduMovementAmplitude(opt.value)
                          handleCloseViduMovementDropdown()
                        }}
                      >
                        <span className="text-sm">{opt.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="w-auto min-w-[80px] relative" ref={viduBgmRef}>
              <label className="block text-sm font-medium mb-1 text-zinc-300">BGM</label>
              <div
                className="bg-zinc-800/70 backdrop-blur-lg border border-[rgba(46,46,46,0.8)] rounded-lg px-3 py-2 h-[38px] focus:outline-none focus:ring-2 focus:ring-[#007eff]/50 transition-all duration-300 cursor-pointer flex items-center justify-between whitespace-nowrap"
                onClick={() => {
                  if (isViduBgmDropdownOpen) {
                    handleCloseViduBgmDropdown()
                  } else {
                    setIsViduBgmDropdownOpen(true)
                  }
                }}
              >
                <span className="text-sm">{viduBgm ? '开启' : '关闭'}</span>
                <svg
                  className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ml-2 ${isViduBgmDropdownOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                </svg>
              </div>
              {(isViduBgmDropdownOpen || viduBgmDropdownClosing) && (
                <div
                  className={`absolute z-20 mt-1 w-full bg-zinc-800/90 backdrop-blur-xl border border-[rgba(46,46,46,0.8)] rounded-lg shadow-lg ${viduBgmDropdownClosing ? 'animate-scale-out' : 'animate-scale-in'}`}
                >
                  <div className="max-h-60 overflow-y-auto">
                    {[
                      { value: false, label: '关闭' },
                      { value: true, label: '开启' }
                    ].map(opt => (
                      <div
                        key={String(opt.value)}
                        className={`px-3 py-2 cursor-pointer transition-colors duration-200 ${viduBgm === opt.value ? 'bg-[#007eff]/20 text-[#66b3ff]' : 'hover:bg-zinc-700/50'}`}
                        onClick={() => {
                          setViduBgm(opt.value)
                          handleCloseViduBgmDropdown()
                        }}
                      >
                        <span className="text-sm">{opt.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {currentModel?.type === 'video' && selectedModel !== 'vidu-q1' && (
          <>
            {selectedModel !== 'pixverse-v4.5' && (
            <div className="w-auto min-w-[80px] relative" ref={(selectedModel === 'minimax-hailuo-2.3' || selectedModel === 'minimax-hailuo-02') ? hailuoDurationRef : klingDurationRef}>
              <label className="block text-sm font-medium mb-1 text-zinc-300">时长</label>
              {(selectedModel === 'minimax-hailuo-2.3' || selectedModel === 'minimax-hailuo-02') ? (
                <div
                  className="bg-zinc-800/70 backdrop-blur-lg border border-[rgba(46,46,46,0.8)] rounded-lg px-3 py-2 h-[38px] focus:outline-none focus:ring-2 focus:ring-[#007eff]/50 transition-all duration-300 cursor-pointer flex items-center justify-between whitespace-nowrap"
                  onClick={() => {
                    if (isHailuoDurationDropdownOpen) {
                      handleCloseHailuoDurationDropdown()
                    } else {
                      setIsHailuoDurationDropdownOpen(true)
                    }
                  }}
                >
                  <span className="text-sm">{videoDuration || 6}</span>
                  <svg className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ml-2 ${isHailuoDurationDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                  </svg>
                </div>
              ) : (
                <div
                  className="bg-zinc-800/70 backdrop-blur-lg border border-[rgba(46,46,46,0.8)] rounded-lg px-3 py-2 h-[38px] focus:outline-none focus:ring-2 focus:ring-[#007eff]/50 transition-all duration-300 cursor-pointer flex items-center justify-between whitespace-nowrap"
                  onClick={() => {
                    if (isKlingDurationDropdownOpen) {
                      handleCloseKlingDurationDropdown()
                    } else {
                      setIsKlingDurationDropdownOpen(true)
                    }
                  }}
                >
                  <span className="text-sm">{videoDuration}</span>
                  <svg className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ml-2 ${isKlingDurationDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                  </svg>
                </div>
              )}
              {(isHailuoDurationDropdownOpen || hailuoDurationDropdownClosing) && (selectedModel === 'minimax-hailuo-2.3' || selectedModel === 'minimax-hailuo-02') && (
                <div className={`absolute z-20 mt-1 w-full bg-zinc-800/90 backdrop-blur-xl border border-[rgba(46,46,46,0.8)] rounded-lg shadow-lg ${hailuoDurationDropdownClosing ? 'animate-scale-out' : 'animate-scale-in'}`}>
                  <div className="max-h-60 overflow-y-auto">
                    {[6, 10].map(val => (
                      <div key={val} className={`px-3 py-2 cursor-pointer transition-colors duration-200 ${ (videoDuration || 6) === val ? 'bg-[#007eff]/20 text-[#66b3ff]' : 'hover:bg-zinc-700/50'}`} onClick={() => { setVideoDuration(val); handleCloseHailuoDurationDropdown() }}>
                        <span className="text-sm">{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(isKlingDurationDropdownOpen || klingDurationDropdownClosing) && selectedModel === 'kling-2.5-turbo' && (
                <div className={`absolute z-20 mt-1 w-full bg-zinc-800/90 backdrop-blur-xl border border-[rgba(46,46,46,0.8)] rounded-lg shadow-lg ${klingDurationDropdownClosing ? 'animate-scale-out' : 'animate-scale-in'}`}>
                  <div className="max-h-60 overflow-y-auto">
                    {[5, 10].map(val => (
                      <div key={val} className={`px-3 py-2 cursor-pointer transition-colors duration-200 ${videoDuration === val ? 'bg-[#007eff]/20 text-[#66b3ff]' : 'hover:bg-zinc-700/50'}`} onClick={() => { setVideoDuration(val); handleCloseKlingDurationDropdown() }}>
                        <span className="text-sm">{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            )}

            {(selectedModel === 'kling-2.5-turbo' || selectedModel === 'pixverse-v4.5') && uploadedImages.length === 0 && (
              selectedModel === 'kling-2.5-turbo' ? (
                <div className="w-auto min-w-[80px] relative" ref={klingAspectRef}>
                  <label className="block text-sm font-medium mb-1 text-zinc-300">宽高比</label>
                  <div
                    className="bg-zinc-800/70 backdrop-blur-lg border border-[rgba(46,46,46,0.8)] rounded-lg px-3 py-2 h-[38px] focus:outline-none focus:ring-2 focus:ring-[#007eff]/50 transition-all duration-300 cursor-pointer flex items-center justify-between whitespace-nowrap"
                    onClick={() => {
                      if (isKlingAspectDropdownOpen) {
                        handleCloseKlingAspectDropdown()
                      } else {
                        setIsKlingAspectDropdownOpen(true)
                      }
                    }}
                  >
                    <span className="text-sm">{videoAspectRatio}</span>
                    <svg className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ml-2 ${isKlingAspectDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                    </svg>
                  </div>
                  {(isKlingAspectDropdownOpen || klingAspectDropdownClosing) && (
                    <div className={`absolute z-20 mt-1 w-full bg-zinc-800/90 backdrop-blur-xl border border-[rgba(46,46,46,0.8)] rounded-lg shadow-lg ${klingAspectDropdownClosing ? 'animate-scale-out' : 'animate-scale-in'}`}>
                      <div className="max-h-60 overflow-y-auto">
                        {['16:9', '9:16', '1:1'].map(r => (
                          <div key={r} className={`px-3 py-2 cursor-pointer transition-colors duration-200 ${videoAspectRatio === r ? 'bg-[#007eff]/20 text-[#66b3ff]' : 'hover:bg-zinc-700/50'}`} onClick={() => { setVideoAspectRatio(r); handleCloseKlingAspectDropdown() }}>
                            <span className="text-sm">{r}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="w-auto min-w-[80px] relative" ref={pixAspectRef}>
                  <label className="block text-sm font-medium mb-1 text-zinc-300">宽高比</label>
                  <div
                    className="bg-zinc-800/70 backdrop-blur-lg border border-[rgba(46,46,46,0.8)] rounded-lg px-3 py-2 h-[38px] focus:outline-none focus:ring-2 focus:ring-[#007eff]/50 transition-all duration-300 cursor-pointer flex items-center justify-between whitespace-nowrap"
                    onClick={() => {
                      if (isPixAspectDropdownOpen) {
                        handleClosePixAspectDropdown()
                      } else {
                        setIsPixAspectDropdownOpen(true)
                      }
                    }}
                  >
                    <span className="text-sm">{videoAspectRatio}</span>
                    <svg className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ml-2 ${isPixAspectDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                    </svg>
                  </div>
                  {(isPixAspectDropdownOpen || pixAspectDropdownClosing) && (
                    <div className={`absolute z-20 mt-1 w-full bg-zinc-800/90 backdrop-blur-xl border border-[rgba(46,46,46,0.8)] rounded-lg shadow-lg ${pixAspectDropdownClosing ? 'animate-scale-out' : 'animate-scale-in'}`}>
                      <div className="max-h-60 overflow-y-auto">
                        {['16:9', '9:16', '1:1'].map(r => (
                          <div key={r} className={`px-3 py-2 cursor-pointer transition-colors duration-200 ${videoAspectRatio === r ? 'bg-[#007eff]/20 text-[#66b3ff]' : 'hover:bg-zinc-700/50'}`} onClick={() => { setVideoAspectRatio(r); handleClosePixAspectDropdown() }}>
                            <span className="text-sm">{r}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            )}

            {selectedModel === 'pixverse-v4.5' && (
              <div className="w-auto min-w-[80px] relative" ref={pixResolutionRef}>
                <label className="block text-sm font-medium mb-1 text-zinc-300">分辨率</label>
                <div
                  className="bg-zinc-800/70 backdrop-blur-lg border border-[rgba(46,46,46,0.8)] rounded-lg px-3 py-2 h-[38px] text-sm focus:outline-none focus:ring-2 focus:ring-[#007eff]/50 transition-all duration-300 cursor-pointer flex items-center justify-between whitespace-nowrap"
                  onClick={() => {
                    if (isPixResolutionDropdownOpen) {
                      handleClosePixResolutionDropdown()
                    } else {
                      setIsPixResolutionDropdownOpen(true)
                    }
                  }}
                >
                  <span className="text-sm">{videoResolution}</span>
                  <svg className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ml-2 ${isPixResolutionDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                  </svg>
                </div>
                {(isPixResolutionDropdownOpen || pixResolutionDropdownClosing) && (
                  <div className={`absolute z-20 mt-1 w-full bg-zinc-800/90 backdrop-blur-xl border border-[rgba(46,46,46,0.8)] rounded-lg shadow-lg ${pixResolutionDropdownClosing ? 'animate-scale-out' : 'animate-scale-in'}`}>
                    <div className="max-h-60 overflow-y-auto">
                      {[...(pixFastMode ? ['360p','540p','720p'] : ['360p','540p','720p','1080p'])].map(val => (
                        <div key={val} className={`px-3 py-2 cursor-pointer transition-colors duration-200 ${ (videoResolution || '540p') === val ? 'bg-[#007eff]/20 text-[#66b3ff]' : 'hover:bg-zinc-700/50'}`} onClick={() => { setVideoResolution(val); handleClosePixResolutionDropdown() }}>
                          <span className="text-sm">{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {(selectedModel === 'minimax-hailuo-2.3' || selectedModel === 'minimax-hailuo-02') && (
              <div className="w-auto min-w-[80px] relative" ref={hailuoResolutionRef}>
                <label className="block text-sm font-medium mb-1 text-zinc-300">分辨率</label>
                <div
                  className="bg-zinc-800/70 backdrop-blur-lg border border-[rgba(46,46,46,0.8)] rounded-lg px-3 py-2 h-[38px] text-sm focus:outline-none focus:ring-2 focus:ring-[#007eff]/50 transition-all duration-300 cursor-pointer flex items-center justify-between whitespace-nowrap"
                  onClick={() => {
                    if (isHailuoResolutionDropdownOpen) {
                      handleCloseHailuoResolutionDropdown()
                    } else {
                      setIsHailuoResolutionDropdownOpen(true)
                    }
                  }}
                >
                  <span className="text-sm">{videoResolution || '768P'}</span>
                  <svg className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ml-2 ${isHailuoResolutionDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                  </svg>
                </div>
                {(isHailuoResolutionDropdownOpen || hailuoResolutionDropdownClosing) && (
                  <div className={`absolute z-20 mt-1 w-full bg-zinc-800/90 backdrop-blur-xl border border-[rgba(46,46,46,0.8)] rounded-lg shadow-lg ${hailuoResolutionDropdownClosing ? 'animate-scale-out' : 'animate-scale-in'}`}>
                    <div className="max-h-60 overflow-y-auto">
                      {([...(videoDuration === 6 ? ['768P','1080P'] : ['768P'])] as string[]).map(val => (
                        <div key={val} className={`px-3 py-2 cursor-pointer transition-colors duration-200 ${ (videoResolution || '768P') === val ? 'bg-[#007eff]/20 text-[#66b3ff]' : 'hover:bg-zinc-700/50'}`} onClick={() => { setVideoResolution(val); handleCloseHailuoResolutionDropdown() }}>
                          <span className="text-sm">{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {selectedModel === 'minimax-hailuo-2.3' && uploadedImages.length > 0 && (
              <div className="w-auto min-w-[80px]">
                <label className="block text-sm font-medium mb-1 text-zinc-300">Fast模式</label>
                <button onClick={() => setHailuoFastMode(!hailuoFastMode)} className={`px-3 py-2 h-[38px] rounded-lg border ${hailuoFastMode ? 'bg-[#007eff] text-white border-[#007eff]' : 'bg-zinc-800/70 text-zinc-300 border-zinc-700/50'}`}>{hailuoFastMode ? '开启' : '关闭'}</button>
              </div>
            )}

            {/* 移除 PixVerse 风格组件 */}

            {(selectedModel === 'pixverse-v4.5') && (
              <div className="w-auto min-w-[80px]">
                <label className="block text-sm font-medium mb-1 text-zinc-300">快速模式</label>
                <button onClick={() => setPixFastMode(!pixFastMode)} className={`px-3 py-2 h-[38px] rounded-lg border ${pixFastMode ? 'bg-[#007eff] text-white border-[#007eff]' : 'bg-zinc-800/70 text-zinc-300 border-zinc-700/50'}`}>{pixFastMode ? '开启' : '关闭'}</button>
              </div>
            )}

            {(selectedModel === 'kling-2.5-turbo') && (
              <div className="w-auto min-w-[150px]">
                <label className="block text-sm font-medium mb-1 text-zinc-300">CFG Scale</label>
                <div className="relative inline-block">
                  <input
                    type="number"
                    value={Number.isFinite(klingCfgScale) ? klingCfgScale.toFixed(2) : '0.00'}
                    onChange={(e) => {
                      const raw = parseFloat(e.target.value)
                      const clamped = Math.min(1, Math.max(0, isNaN(raw) ? 0 : raw))
                      const rounded = Math.round(clamped * 100) / 100
                      setKlingCfgScale(rounded)
                    }}
                    className="w-24 bg-zinc-800/70 backdrop-blur-lg border border-[rgba(46,46,46,0.8)] rounded-lg px-3 pr-8 py-2 h-[38px] text-sm focus:outline-none focus:ring-2 focus:ring-[#007eff]/50 transition-all duration-300"
                    min="0"
                    max="1"
                    step="0.01"
                  />
                  <div className="absolute inset-y-0 right-1 flex flex-col justify-center gap-1">
                    <button
                      type="button"
                      onClick={() => setKlingCfgScale(prev => {
                        const v = typeof prev === 'number' ? prev : 0
                        const next = Math.min(1, v + 0.1)
                        return Math.round(next * 100) / 100
                      })}
                      className="w-6 h-4 bg-transparent text-zinc-300 text-[10px] leading-none hover:text-zinc-200 outline-none focus:outline-none ring-0 focus:ring-0 cursor-pointer"
                    >▲</button>
                    <button
                      type="button"
                      onClick={() => setKlingCfgScale(prev => {
                        const v = typeof prev === 'number' ? prev : 0
                        const next = Math.max(0, v - 0.1)
                        return Math.round(next * 100) / 100
                      })}
                      className="w-6 h-4 bg-transparent text-zinc-300 text-[10px] leading-none hover:text-zinc-200 outline-none focus:outline-none ring-0 focus:ring-0 cursor-pointer"
                    >▼</button>
                  </div>
                </div>
              </div>
            )}

            {(selectedModel === 'minimax-hailuo-2.3' || selectedModel === 'minimax-hailuo-2.3-fast') && (
              <div className="w-auto min-w-[80px]">
                <label className="block text-sm font-medium mb-1 text-zinc-300">提示词优化</label>
                <button onClick={() => setMinimaxEnablePromptExpansion(!minimaxEnablePromptExpansion)} className={`px-3 py-2 h-[38px] rounded-lg border ${minimaxEnablePromptExpansion ? 'bg-[#007eff] text-white border-[#007eff]' : 'bg-zinc-800/70 text-zinc-300 border-zinc-700/50'}`}>{minimaxEnablePromptExpansion ? '开启' : '关闭'}</button>
              </div>
            )}

            {selectedModel === 'wan-2.5-preview' && uploadedImages.length === 0 && (
              <div className="w-auto min-w-[140px]">
                <label className="block text-sm font-medium mb-1 text-zinc-300">尺寸</label>
                <input value={wanSize} onChange={(e) => setWanSize(e.target.value)} className="bg-zinc-800/70 border border-zinc-700/50 rounded-lg px-3 py-2 h-[38px] text-sm" />
              </div>
            )}
            {selectedModel === 'wan-2.5-preview' && uploadedImages.length > 0 && (
              <>
                <div className="w-auto min-w-[80px]">
                  <label className="block text-sm font-medium mb-1 text-zinc-300">分辨率</label>
                  <select value={wanResolution} onChange={(e) => setWanResolution(e.target.value)} className="bg-zinc-800/70 border border-zinc-700/50 rounded-lg px-3 py-2 h-[38px] text-sm">
                    <option value="480P">480P</option>
                    <option value="720P">720P</option>
                    <option value="1080P">1080P</option>
                  </select>
                </div>
                <div className="w-auto min-w-[200px]">
                  <label className="block text-sm font-medium mb-1 text-zinc-300">图片 URL</label>
                  <input value={wanImageUrl} onChange={(e) => setWanImageUrl(e.target.value)} placeholder="https://..." className="bg-zinc-800/70 border border-zinc-700/50 rounded-lg px-3 py-2 h-[38px] text-sm" />
                </div>
              </>
            )}
            {selectedModel === 'wan-2.5-preview' && (
              <>
                <div className="w-auto min-w-[200px]">
                  <label className="block text-sm font-medium mb-1 text-zinc-300">音频 URL</label>
                  <input value={wanAudioUrl} onChange={(e) => setWanAudioUrl(e.target.value)} placeholder="https://..." className="bg-zinc-800/70 border border-zinc-700/50 rounded-lg px-3 py-2 h-[38px] text-sm" />
                </div>
                <div className="w-auto min-w-[80px]">
                  <label className="block text-sm font-medium mb-1 text-zinc-300">智能改写</label>
                  <button onClick={() => setWanPromptExtend(!wanPromptExtend)} className={`px-3 py-2 h-[38px] rounded-lg border ${wanPromptExtend ? 'bg-[#007eff] text-white border-[#007eff]' : 'bg-zinc-800/70 text-zinc-300 border-zinc-700/50'}`}>{wanPromptExtend ? '开启' : '关闭'}</button>
                </div>
                <div className="w-auto min-w-[80px]">
                  <label className="block text-sm font-medium mb-1 text-zinc-300">水印</label>
                  <button onClick={() => setWanWatermark(!wanWatermark)} className={`px-3 py-2 h-[38px] rounded-lg border ${wanWatermark ? 'bg-[#007eff] text-white border-[#007eff]' : 'bg-zinc-800/70 text-zinc-300 border-zinc-700/50'}`}>{wanWatermark ? '开启' : '关闭'}</button>
                </div>
                <div className="w-auto min-w-[80px]">
                  <label className="block text-sm font-medium mb-1 text-zinc-300">音频</label>
                  <button onClick={() => setWanAudio(!wanAudio)} className={`px-3 py-2 h-[38px] rounded-lg border ${wanAudio ? 'bg-[#007eff] text-white border-[#007eff]' : 'bg-zinc-800/70 text-zinc-300 border-zinc-700/50'}`}>{wanAudio ? '开启' : '关闭'}</button>
                </div>
              </>
            )}

            {(selectedModel === 'seedance-v1-lite' || selectedModel === 'seedance-v1-pro') && (
              <>
                <div className="w-auto min-w-[80px]">
                  <label className="block text-sm font-medium mb-1 text-zinc-300">分辨率</label>
                  <select value={seedanceResolution} onChange={(e) => setSeedanceResolution(e.target.value)} className="bg-zinc-800/70 border border-zinc-700/50 rounded-lg px-3 py-2 h-[38px] text-sm">
                    <option value="480p">480p</option>
                    <option value="720p">720p</option>
                    <option value="1080p">1080p</option>
                  </select>
                </div>
                <div className="w-auto min-w-[80px]">
                  <label className="block text-sm font-medium mb-1 text-zinc-300">宽高比</label>
                  <select value={seedanceAspectRatio} onChange={(e) => setSeedanceAspectRatio(e.target.value)} className="bg-zinc-800/70 border border-zinc-700/50 rounded-lg px-3 py-2 h-[38px] text-sm">
                    <option value="21:9">21:9</option>
                    <option value="16:9">16:9</option>
                    <option value="4:3">4:3</option>
                    <option value="1:1">1:1</option>
                    <option value="3:4">3:4</option>
                    <option value="9:16">9:16</option>
                    <option value="9:21">9:21</option>
                  </select>
                </div>
                <div className="w-auto min-w-[80px]">
                  <label className="block text-sm font-medium mb-1 text-zinc-300">相机固定</label>
                  <button onClick={() => setSeedanceCameraFixed(!seedanceCameraFixed)} className={`px-3 py-2 h-[38px] rounded-lg border ${seedanceCameraFixed ? 'bg-[#007eff] text-white border-[#007eff]' : 'bg-zinc-800/70 text-zinc-300 border-zinc-700/50'}`}>{seedanceCameraFixed ? '是' : '否'}</button>
                </div>
                {selectedModel === 'seedance-v1-lite' && (
                  <div className="w-auto min-w-[120px]">
                    <label className="block text-sm font-medium mb-1 text-zinc-300">使用最后图为结束</label>
                    <button onClick={() => setSeedanceUseLastImage(!seedanceUseLastImage)} className={`px-3 py-2 h-[38px] rounded-lg border ${seedanceUseLastImage ? 'bg-[#007eff] text-white border-[#007eff]' : 'bg-zinc-800/70 text-zinc-300 border-zinc-700/50'}`}>{seedanceUseLastImage ? '开启' : '关闭'}</button>
                  </div>
                )}
              </>
            )}

            {selectedModel !== 'minimax-hailuo-2.3' && selectedModel !== 'minimax-hailuo-2.3-fast' && selectedModel !== 'minimax-hailuo-02' && (
              <div className="w-auto flex-1 min-w-[200px]">
                <label className="block text-sm font-medium mb-1 text-zinc-300">负面提示</label>
                <input value={videoNegativePrompt} onChange={(e) => setVideoNegativePrompt(e.target.value)} placeholder="不希望出现的内容" className="w-full bg-zinc-800/70 border border-zinc-700/50 rounded-lg px-3 py-2 h-[38px] text-sm" />
              </div>
            )}
            {selectedModel !== 'kling-2.5-turbo' && selectedModel !== 'minimax-hailuo-2.3' && selectedModel !== 'minimax-hailuo-2.3-fast' && selectedModel !== 'minimax-hailuo-02' && selectedModel !== 'pixverse-v4.5' && (
              <div className="w-auto min-w-[120px]">
                <label className="block text-sm font-medium mb-1 text-zinc-300">随机种子</label>
                <input type="number" value={videoSeed || ''} onChange={(e) => setVideoSeed(e.target.value ? parseInt(e.target.value) : undefined)} placeholder="可选" className="bg-zinc-800/70 border border-zinc-700/50 rounded-lg px-3 py-2 h-[38px] text-sm" />
              </div>
            )}
          </>
        )}

        {/* 即梦图片生成4.0参数设置 - 仅对即梦模型显示 */}
        {selectedModel === 'seedream-4.0' && (
          <>
            {/* 批量生成开关 */}
            <div>
              <label className="block text-sm font-medium mb-1 text-zinc-300">
                <span
                  className="relative"
                  onMouseEnter={() => {
                    if (bulkTooltipTimerRef.current) { window.clearTimeout(bulkTooltipTimerRef.current) }
                    bulkTooltipTimerRef.current = window.setTimeout(() => {
                      setBulkTooltipVisible(true)
                      setBulkTooltipClosing(false)
                    }, 500)
                  }}
                  onMouseLeave={() => {
                    if (bulkTooltipTimerRef.current) { window.clearTimeout(bulkTooltipTimerRef.current); bulkTooltipTimerRef.current = null }
                    if (bulkTooltipVisible) {
                      setBulkTooltipClosing(true)
                      window.setTimeout(() => {
                        setBulkTooltipVisible(false)
                        setBulkTooltipClosing(false)
                      }, 300)
                    }
                  }}
                >
                  批量生成
                  <span
                    className={`absolute z-20 left-1/2 -translate-x-1/2 bottom-full mb-2 w-[280px] bg-zinc-800/90 border border-[rgba(46,46,46,0.8)] rounded-lg shadow-lg text-xs text-white p-3 ${bulkTooltipVisible ? (bulkTooltipClosing ? 'animate-fade-out' : 'animate-fade-in') : 'hidden'}`}
                  >
                    设置为自动时，可以通过提示词描述控制生成的图片数量，例如：生成4张图片。实际数量会受限于最大数量的设置，同时参考图+想要生成图片的数量无法超过15张。
                  </span>
                </span>
              </label>
              <div className="flex gap-1 h-[38px]">
                <button
                  onClick={() => setSequentialImageGeneration('auto')}
                  className={`px-3 py-2 text-sm rounded-lg transition-all duration-300 ${
                    sequentialImageGeneration === 'auto'
                      ? 'bg-[#007eff] text-white'
                      : 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50'
                  }`}
                >
                  自动
                </button>
                <button
                  onClick={() => setSequentialImageGeneration('disabled')}
                  className={`px-3 py-2 text-sm rounded-lg transition-all duration-300 ${
                    sequentialImageGeneration === 'disabled'
                      ? 'bg-[#007eff] text-white'
                      : 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50'
                  }`}
                >
                  禁用
                </button>
              </div>
            </div>

            {/* 最大图像数量 */}
              {sequentialImageGeneration === 'auto' && (
              <div>
                <label className="block text-sm font-medium mb-1 text-zinc-300">最大数量</label>
                <div className="relative inline-block">
                  <input
                    type="number"
                    value={maxImages}
                    onChange={(e) => setMaxImages(Math.min(15, Math.max(1, parseInt(e.target.value) || 1)))}
                    className="w-20 bg-zinc-700/50 border border-[rgba(46,46,46,0.8)] rounded-lg px-3 pr-8 py-2 h-[38px] text-sm transition-all duration-300 outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 focus-visible:ring-0"
                    min="1"
                    max="15"
                  />
                  <div className="absolute inset-y-0 right-1 flex flex-col justify-center gap-1">
                    <button
                      type="button"
                      onClick={() => setMaxImages(prev => Math.min(15, (typeof prev === 'number' ? prev : 1) + 1))}
                      className="w-6 h-4 bg-transparent text-zinc-300 text-[10px] leading-none hover:text-zinc-200 outline-none focus:outline-none ring-0 focus:ring-0 cursor-pointer"
                    >▲</button>
                    <button
                      type="button"
                      onClick={() => setMaxImages(prev => Math.max(1, (typeof prev === 'number' ? prev : 1) - 1))}
                      className="w-6 h-4 bg-transparent text-zinc-300 text-[10px] leading-none hover:text-zinc-200 outline-none focus:outline-none ring-0 focus:ring-0 cursor-pointer"
                    >▼</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 输入区域 */}
      <div className="relative bg-[#131313]/70 rounded-xl border border-[rgba(46,46,46,0.8)] p-4">
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

            {/* 上传按钮 - 紧跟在图片之后，根据模型和模式限制 */}
            {(() => {
              // 计算最大图片数
              let maxImageCount = 6 // 默认图片模型最多6张
              
              if (selectedModel === 'vidu-q1') {
                if (viduMode === 'text-image-to-video') {
                  maxImageCount = 1 // 文/图生视频最多1张
                } else if (viduMode === 'start-end-frame') {
                  maxImageCount = 2 // 首尾帧需要2张
                } else if (viduMode === 'reference-to-video') {
                  maxImageCount = 7 // 参考生视频最多7张
                }
              } else if (selectedModel === 'kling-2.5-turbo') {
                maxImageCount = 1
              } else if (selectedModel === 'minimax-hailuo-2.3') {
                maxImageCount = 1
              } else if (selectedModel === 'minimax-hailuo-02') {
                maxImageCount = 2
              }
              
              const canUploadMore = uploadedImages.length < maxImageCount
              
              return canUploadMore ? (
                <div 
                  key={`upload-btn-${uploadedImages.length}`}
                  className="w-12 h-16 bg-zinc-700/80 backdrop-blur-sm rounded-lg shadow-lg border-2 border-dashed border-[rgba(46,46,46,0.8)] hover:border-[rgba(46,46,46,0.8)] flex items-center justify-center transition-all duration-200 cursor-pointer flex-shrink-0"
                  onClick={() => imageFileInputRef.current?.click()}
                  style={{
                    animation: 'imageSlideIn 0.25s ease-out forwards'
                  }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </div>
              ) : null
            })()}
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
            className="w-full bg-transparent backdrop-blur-lg rounded-xl p-4 pr-14 min-h-[100px] resize-none focus:outline-none focus:ring-2 focus:ring-white/20 transition-shadow duration-300 ease-in-out text-white placeholder-zinc-400"
            disabled={isLoading}
          />
          
          {/* 生成按钮 */}
          <button
            onClick={handleGenerate}
            disabled={isLoading || (!input.trim() && uploadedImages.length === 0)}
            className={`absolute bottom-3 right-3 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${
              isLoading || (!input.trim() && uploadedImages.length === 0)
                ? 'bg-zinc-700/50 text-zinc-500 cursor-not-allowed'
                : 'bg-[#007eff] hover:brightness-110 text-white shadow-lg hover:shadow-xl transform hover:scale-105'
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
          className="px-4 py-2 bg-zinc-700/50 hover:bg-zinc-600/50 backdrop-blur-lg rounded-lg transition-all duration-300 border border-[rgba(46,46,46,0.8)] flex items-center text-sm"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          清除
        </button>
        
        {/* 设置按钮 */}
        <button
          onClick={onOpenSettings}
          className="px-4 py-2 bg-zinc-700/50 hover:bg-zinc-600/50 backdrop-blur-lg rounded-lg transition-all duration-300 border border-[rgba(46,46,46,0.8)] flex items-center text-sm"
          title="设置"
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
        multiple={(selectedModel === 'vidu-q1' && viduMode === 'reference-to-video') || selectedModel === 'minimax-hailuo-02' ? true : (selectedModel === 'kling-2.5-turbo' || selectedModel === 'minimax-hailuo-2.3' ? false : true)}
        className="hidden"
      />
    </div>
  )
}

export default MediaGenerator
