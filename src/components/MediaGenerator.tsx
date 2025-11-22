import React, { useState, useRef, useEffect } from 'react'
import { providers } from '../config/providers'
import { saveUploadImage, dataUrlToBlob } from '@/utils/save'
import ParamRow from './ui/ParamRow'
import Toggle from './ui/Toggle'
import NumberInput from './ui/NumberInput'
import TextInput from './ui/TextInput'
import PanelTrigger from './ui/PanelTrigger'
import FileUploader from './ui/FileUploader'
import SchemaForm from './ui/SchemaForm'
import PriceEstimate from './ui/PriceEstimate'
import { wan25Params, viduParams, klingParams, hailuoParams, pixverseParams, seedanceParams, seedreamParams, minimaxSpeechBasicParams, minimaxSpeechAdvancedParams, nanoBananaParams, nanoBananaProParams } from '../schemas/modelParams'

interface MediaGeneratorProps {
  onGenerate: (input: string, model: string, type: 'image' | 'video' | 'audio', options?: any) => void
  isLoading: boolean
  onOpenSettings: () => void
  onOpenClearHistory: () => void
}

const MediaGenerator: React.FC<MediaGeneratorProps> = ({ onGenerate, isLoading, onOpenSettings, onOpenClearHistory }) => {
  const [input, setInput] = useState('')
  const [selectedProvider, setSelectedProvider] = useState('piaoyun')
  const [selectedModel, setSelectedModel] = useState('seedream-4.0')
  const [uploadedImages, setUploadedImages] = useState<string[]>([])
  const [uploadedFilePaths, setUploadedFilePaths] = useState<string[]>([])
  const [removingImages, setRemovingImages] = useState<Set<string>>(new Set())
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false)
  const [_modelDropdownClosing, setModelDropdownClosing] = useState(false)

  const [modelFilterProvider, setModelFilterProvider] = useState<string>('all')
  const [modelFilterType, setModelFilterType] = useState<'all' | 'image' | 'video' | 'audio'>('all')
  const [modelFilterFunction, setModelFilterFunction] = useState<string>('all')
  const [isResolutionDropdownOpen, setIsResolutionDropdownOpen] = useState(false)
  const [selectedResolution, setSelectedResolution] = useState('smart')  // 默认为智能模式
  const [resolutionQuality, setResolutionQuality] = useState<'2K' | '4K'>('2K') // 2K/4K切换，默认2K
  const [customWidth, setCustomWidth] = useState('')
  const [customHeight, setCustomHeight] = useState('')
  const [isManualInput, setIsManualInput] = useState(false) // 标记是否手动输入
  const [maxImages, setMaxImages] = useState<number>(1)
  const [isViduStyleDropdownOpen, setIsViduStyleDropdownOpen] = useState(false)
  const [_viduStyleDropdownClosing, setViduStyleDropdownClosing] = useState(false)



  // Vidu Q1 参数
  const [viduMode, setViduMode] = useState<'text-image-to-video' | 'start-end-frame' | 'reference-to-video'>('text-image-to-video')
  const [viduAspectRatio, setViduAspectRatio] = useState('16:9')
  const [viduStyle, setViduStyle] = useState('general')
  const [_viduDuration, _setViduDuration] = useState(5)

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
  const [wanAudio, setWanAudio] = useState(true)
  const [seedanceResolution, setSeedanceResolution] = useState('720p')
  const [seedanceAspectRatio, setSeedanceAspectRatio] = useState('16:9')

  const [seedanceCameraFixed, setSeedanceCameraFixed] = useState(false)

  // Nano Banana 和 Nano Banana Pro 参数
  const [numImages, setNumImages] = useState(1)
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [resolution, setResolution] = useState('1K')  // nano-banana-pro 分辨率

  const [seedanceVariant, setSeedanceVariant] = useState<'lite' | 'pro'>('lite')
  const [isKlingDurationDropdownOpen, setIsKlingDurationDropdownOpen] = useState(false)
  const [klingDurationDropdownClosing, setKlingDurationDropdownClosing] = useState(false)
  const [isKlingAspectDropdownOpen, setIsKlingAspectDropdownOpen] = useState(false)
  const [klingAspectDropdownClosing, setKlingAspectDropdownClosing] = useState(false)

  const [isHailuoResolutionDropdownOpen, setIsHailuoResolutionDropdownOpen] = useState(false)

  const [isPixAspectDropdownOpen, setIsPixAspectDropdownOpen] = useState(false)
  const [pixAspectDropdownClosing, setPixAspectDropdownClosing] = useState(false)
  const [isPixResolutionDropdownOpen, setIsPixResolutionDropdownOpen] = useState(false)
  const [pixResolutionDropdownClosing, setPixResolutionDropdownClosing] = useState(false)

  const [_hailuoResolutionDropdownClosing, _setHailuoResolutionDropdownClosing] = useState(false)
  const [_seedanceVariantDropdownClosing, _setSeedanceVariantDropdownClosing] = useState(false)
  const [_seedanceResolutionDropdownClosing, _setSeedanceResolutionDropdownClosing] = useState(false)
  const [_seedanceAspectDropdownClosing, _setSeedanceAspectDropdownClosing] = useState(false)
  const [_wanResolutionDropdownClosing, _setWanResolutionDropdownClosing] = useState(false)
  const [_voiceDropdownClosing, _setVoiceDropdownClosing] = useState(false)
  const [_stableHeight, _setStableHeight] = useState(false)

  // Position states for dropdown positioning
  const [_klingAspectPos, setKlingAspectPos] = useState<{ top: number, left: number, width: number }>({ top: 0, left: 0, width: 0 })
  const [_klingDurationPos, setKlingDurationPos] = useState<{ top: number, left: number, width: number }>({ top: 0, left: 0, width: 0 })
  const [_pixAspectPos, setPixAspectPos] = useState<{ top: number, left: number, width: number }>({ top: 0, left: 0, width: 0 })
  const [_pixResolutionPos, setPixResolutionPos] = useState<{ top: number, left: number, width: number }>({ top: 0, left: 0, width: 0 })

  const [isWanResolutionDropdownOpen, setIsWanResolutionDropdownOpen] = useState(false)

  const [isSeedanceVariantDropdownOpen, setIsSeedanceVariantDropdownOpen] = useState(false)

  const [isSeedanceResolutionDropdownOpen, setIsSeedanceResolutionDropdownOpen] = useState(false)

  const [isSeedanceAspectDropdownOpen, setIsSeedanceAspectDropdownOpen] = useState(false)



  const modelRef = useRef<HTMLDivElement>(null)
  const resolutionRef = useRef<HTMLDivElement>(null)

  const viduStyleRef = useRef<HTMLDivElement>(null)

  const klingDurationRef = useRef<HTMLDivElement>(null)
  const klingAspectRef = useRef<HTMLDivElement>(null)

  const hailuoResolutionRef = useRef<HTMLDivElement>(null)
  const pixAspectRef = useRef<HTMLDivElement>(null)
  const pixResolutionRef = useRef<HTMLDivElement>(null)

  const wanResolutionRef = useRef<HTMLDivElement>(null)
  const seedanceVariantRef = useRef<HTMLDivElement>(null)
  const seedanceResolutionRef = useRef<HTMLDivElement>(null)
  const seedanceAspectRef = useRef<HTMLDivElement>(null)

  const [audioSpeed, setAudioSpeed] = useState<number>(1.0)
  const [audioEmotion, setAudioEmotion] = useState<string>('neutral')
  const [voiceId, setVoiceId] = useState<string>('male-qn-jingying')
  const [isVoiceDropdownOpen, setIsVoiceDropdownOpen] = useState(false)

  const [voiceFilterGender, setVoiceFilterGender] = useState<'all' | 'male' | 'female' | 'child' | 'other'>('all')
  const voiceRef = useRef<HTMLDivElement>(null)
  const [audioVol, setAudioVol] = useState<number>(1.0)
  const [audioPitch, setAudioPitch] = useState<number>(0)
  const [audioSampleRate, setAudioSampleRate] = useState<number>(32000)
  const [audioBitrate, setAudioBitrate] = useState<number>(128000)
  const [audioFormat, setAudioFormat] = useState<string>('mp3')
  const [audioChannel, setAudioChannel] = useState<number>(1)
  const [latexRead, setLatexRead] = useState<boolean>(false)
  const [textNormalization, setTextNormalization] = useState<boolean>(false)
  const [languageBoost, setLanguageBoost] = useState<string>('auto')
  const [audioSpec, setAudioSpec] = useState<'hd' | 'turbo'>('hd')







  // Nano Banana 和 Nano Banana Pro: 根据是否上传图片动态调整 aspect_ratio 默认值
  useEffect(() => {
    if (isRestoringRef.current) return
    if (selectedModel === 'nano-banana' || selectedModel === 'nano-banana-pro') {
      if (uploadedImages.length > 0) {
        // 图生图模式：默认 auto
        setAspectRatio('auto')
      } else {
        // 文生图模式：默认 1:1
        if (aspectRatio === 'auto') {
          setAspectRatio('1:1')
        }
      }
    }
  }, [uploadedImages.length, selectedModel])

  useEffect(() => {
    if ((isKlingAspectDropdownOpen || klingAspectDropdownClosing) && klingAspectRef.current) {
      const rect = klingAspectRef.current.getBoundingClientRect()
      setKlingAspectPos({ top: rect.bottom + 8, left: rect.left, width: rect.width })
    }
  }, [isKlingAspectDropdownOpen, klingAspectDropdownClosing])

  useEffect(() => {
    if ((isKlingDurationDropdownOpen || klingDurationDropdownClosing) && klingDurationRef.current) {
      const rect = klingDurationRef.current.getBoundingClientRect()
      setKlingDurationPos({ top: rect.bottom + 8, left: rect.left, width: rect.width })
    }
  }, [isKlingDurationDropdownOpen, klingDurationDropdownClosing])

  useEffect(() => {
    if ((isPixAspectDropdownOpen || pixAspectDropdownClosing) && pixAspectRef.current) {
      const rect = pixAspectRef.current.getBoundingClientRect()
      setPixAspectPos({ top: rect.bottom + 8, left: rect.left, width: rect.width })
    }
  }, [isPixAspectDropdownOpen, pixAspectDropdownClosing])

  useEffect(() => {
    if ((isPixResolutionDropdownOpen || pixResolutionDropdownClosing) && pixResolutionRef.current) {
      const rect = pixResolutionRef.current.getBoundingClientRect()
      setPixResolutionPos({ top: rect.bottom + 8, left: rect.left, width: rect.width })
    }
  }, [isPixResolutionDropdownOpen, pixResolutionDropdownClosing])

  const voicePresets: { id: string; name: string; gender: 'male' | 'female' | 'child' | 'other' }[] = [
    { id: 'male-qn-qingse', name: '青涩青年', gender: 'male' },
    { id: 'male-qn-jingying', name: '精英青年', gender: 'male' },
    { id: 'male-qn-badao', name: '霸道青年', gender: 'male' },
    { id: 'male-qn-daxuesheng', name: '青年大学生', gender: 'male' },
    { id: 'female-shaonv', name: '少女', gender: 'female' },
    { id: 'female-yujie', name: '御姐', gender: 'female' },
    { id: 'female-chengshu', name: '成熟女性', gender: 'female' },
    { id: 'female-tianmei', name: '甜美女性', gender: 'female' },
    { id: 'presenter_male', name: '男性主持人', gender: 'male' },
    { id: 'presenter_female', name: '女性主持人', gender: 'female' },
    { id: 'audiobook_male_1', name: '男性有声书1', gender: 'male' },
    { id: 'audiobook_male_2', name: '男性有声书2', gender: 'male' },
    { id: 'audiobook_female_1', name: '女性有声书1', gender: 'female' },
    { id: 'audiobook_female_2', name: '女性有声书2', gender: 'female' },
    { id: 'clever_boy', name: '聪明男童', gender: 'child' },
    { id: 'cute_boy', name: '可爱男童', gender: 'child' },
    { id: 'lovely_girl', name: '萌萌女童', gender: 'child' },
    { id: 'cartoon_pig', name: '卡通猪小琪', gender: 'other' }
  ]


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
    if (isRestoringRef.current) return
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

  useEffect(() => {
    if (isRestoringRef.current) return
    const first = uploadedImages[0]
    if (!first) return
    if (selectedModel === 'seedance-v1' || selectedModel === 'seedance-v1-lite' || selectedModel === 'seedance-v1-pro') {
      const allowed = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21']
      const img = new Image()
      img.onload = () => {
        const w = img.width || 1
        const h = img.height || 1
        const target = w / h
        const toVal = (s: string) => {
          const parts = s.split(':')
          const a = parseFloat(parts[0])
          const b = parseFloat(parts[1])
          return a / b
        }
        let best = allowed[0]
        let bestDiff = Math.abs(target - toVal(best))
        for (let i = 1; i < allowed.length; i++) {
          const diff = Math.abs(target - toVal(allowed[i]))
          if (diff < bestDiff) {
            best = allowed[i]
            bestDiff = diff
          }
        }
        setSeedanceAspectRatio(best)
      }
      img.src = first
    }
  }, [uploadedImages, selectedModel])

  // PixVerse 分辨率规范化
  useEffect(() => {
    if (isRestoringRef.current) return
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
        if (aspectRatio < 1 / 16 || aspectRatio > 16) {
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

  const isRestoringRef = useRef(false)

  // 监听重新编辑事件
  useEffect(() => {
    const handleReedit = (event: CustomEvent) => {
      const { prompt, images, uploadedFilePaths, model, provider, options } = event.detail as any

      // 标记正在恢复状态，防止 useEffect 重置参数
      isRestoringRef.current = true

      setInput(prompt || '')

      // 恢复模型选择
      if (model) {
        let targetProvider = provider
        if (!targetProvider) {
          // 如果 provider 缺失（旧历史记录），尝试从 model 推断
          const p = providers.find(p => p.models.some(m => m.id === model))
          if (p) targetProvider = p.id
        }

        if (targetProvider) {
          handleModelSelect(targetProvider, model)
        }
      }

      // 恢复图片
      if (images && Array.isArray(images)) {
        setUploadedImages(images)
      }
      if (uploadedFilePaths && Array.isArray(uploadedFilePaths)) {
        setUploadedFilePaths(uploadedFilePaths)
      } else {
        setUploadedFilePaths([])
      }

      // 恢复参数
      if (options) {
        // 通用参数
        if (options.num_images) setNumImages(options.num_images)
        if (options.aspect_ratio) setAspectRatio(options.aspect_ratio)
        if (options.resolution) setResolution(options.resolution)

        // Seedream
        if (options.maxImages) setMaxImages(options.maxImages)

        // Video parameters
        if (options.duration) setVideoDuration(options.duration)
        if (options.aspectRatio) setVideoAspectRatio(options.aspectRatio) // 注意：视频参数可能是 camelCase
        if (options.resolution) setVideoResolution(options.resolution)
        if (options.negativePrompt) setVideoNegativePrompt(options.negativePrompt)
        if (options.seed) setVideoSeed(options.seed)

        // Kling
        if (options.cfg_scale) setKlingCfgScale(options.cfg_scale)

        // Hailuo
        if (options.hailuoFast) setHailuoFastMode(options.hailuoFast)

        // PixVerse
        if (options.fastMode) setPixFastMode(options.fastMode)
        if (options.style) setPixStyle(options.style)

        // Seedance
        if (options.seedanceVariant) setSeedanceVariant(options.seedanceVariant)
        if (options.cameraFixed !== undefined) setSeedanceCameraFixed(options.cameraFixed)

        // Vidu
        if (options.viduMode) setViduMode(options.viduMode)
        if (options.viduStyle) setViduStyle(options.viduStyle)
        if (options.viduMovementAmplitude) setViduMovementAmplitude(options.viduMovementAmplitude)
        if (options.viduBgm) setViduBgm(options.viduBgm)

        // Audio
        if (options.speed) setAudioSpeed(options.speed)
        if (options.emotion) setAudioEmotion(options.emotion)
        if (options.voiceId) setVoiceId(options.voiceId)
        if (options.spec) setAudioSpec(options.spec)
        if (options.vol) setAudioVol(options.vol)
        if (options.pitch) setAudioPitch(options.pitch)
        if (options.sample_rate) setAudioSampleRate(options.sample_rate)
        if (options.bitrate) setAudioBitrate(options.bitrate)
        if (options.format) setAudioFormat(options.format)
        if (options.channel) setAudioChannel(options.channel)
        if (options.latex_read !== undefined) setLatexRead(options.latex_read)
        if (options.text_normalization !== undefined) setTextNormalization(options.text_normalization)
        if (options.language_boost !== undefined) setLanguageBoost(options.language_boost)
        if (options.language_boost !== undefined) setLanguageBoost(options.language_boost)
      }

      // 恢复完成后重置标记
      setTimeout(() => {
        isRestoringRef.current = false
      }, 100)
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
      if (viduStyleRef.current && !viduStyleRef.current.contains(event.target as Node) && isViduStyleDropdownOpen) {
        handleCloseViduStyleDropdown()
      }
      if (klingDurationRef.current && !klingDurationRef.current.contains(event.target as Node) && isKlingDurationDropdownOpen) {
        handleCloseKlingDurationDropdown()
      }
      if (klingAspectRef.current && !klingAspectRef.current.contains(event.target as Node) && isKlingAspectDropdownOpen) {
        handleCloseKlingAspectDropdown()
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

      if (wanResolutionRef.current && !wanResolutionRef.current.contains(event.target as Node) && isWanResolutionDropdownOpen) {
        handleCloseWanResolutionDropdown()
      }
      if (seedanceVariantRef.current && !seedanceVariantRef.current.contains(event.target as Node) && isSeedanceVariantDropdownOpen) {
        handleCloseSeedanceVariantDropdown()
      }
      if (seedanceResolutionRef.current && !seedanceResolutionRef.current.contains(event.target as Node) && isSeedanceResolutionDropdownOpen) {
        handleCloseSeedanceResolutionDropdown()
      }
      if (seedanceAspectRef.current && !seedanceAspectRef.current.contains(event.target as Node) && isSeedanceAspectDropdownOpen) {
        handleCloseSeedanceAspectDropdown()
      }

    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isModelDropdownOpen, isResolutionDropdownOpen, isViduStyleDropdownOpen, isKlingDurationDropdownOpen, isKlingAspectDropdownOpen, isHailuoResolutionDropdownOpen, isPixAspectDropdownOpen, isPixResolutionDropdownOpen, isWanResolutionDropdownOpen, isSeedanceVariantDropdownOpen, isSeedanceResolutionDropdownOpen, isSeedanceAspectDropdownOpen])

  const handleCloseModelDropdown = () => {
    setModelDropdownClosing(true)
    setTimeout(() => {
      setIsModelDropdownOpen(false)
      setModelDropdownClosing(false)
    }, 200)
  }


  const handleCloseViduStyleDropdown = () => {
    setViduStyleDropdownClosing(true)
    setTimeout(() => {
      setIsViduStyleDropdownOpen(false)
      setViduStyleDropdownClosing(false)
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


  const handleCloseHailuoResolutionDropdown = () => {
    _setHailuoResolutionDropdownClosing(true)
    setTimeout(() => {
      setIsHailuoResolutionDropdownOpen(false)
      _setHailuoResolutionDropdownClosing(false)
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
  const handleCloseSeedanceVariantDropdown = () => {
    _setSeedanceVariantDropdownClosing(true)
    setTimeout(() => {
      setIsSeedanceVariantDropdownOpen(false)
      _setSeedanceVariantDropdownClosing(false)
    }, 200)
  }
  const handleCloseSeedanceResolutionDropdown = () => {
    _setSeedanceResolutionDropdownClosing(true)
    setTimeout(() => {
      setIsSeedanceResolutionDropdownOpen(false)
      _setSeedanceResolutionDropdownClosing(false)
    }, 200)
  }
  const handleCloseSeedanceAspectDropdown = () => {
    _setSeedanceAspectDropdownClosing(true)
    setTimeout(() => {
      setIsSeedanceAspectDropdownOpen(false)
      _setSeedanceAspectDropdownClosing(false)
    }, 200)
  }



  const handleCloseWanResolutionDropdown = () => {
    _setWanResolutionDropdownClosing(true)
    setTimeout(() => {
      setIsWanResolutionDropdownOpen(false)
      _setWanResolutionDropdownClosing(false)
    }, 200)
  }



  const handleGenerate = async () => {
    if ((!input.trim() && uploadedImages.length === 0) || isLoading) return

    // 构建生成选项
    const options: any = {}

    // 如果是图片模型，添加图片和分辨率选项
    // 图片模型的通用处理（排除 nano-banana 和 nano-banana-pro，它们有独立的参数处理）
    if (currentModel?.type === 'image' && selectedModel !== 'nano-banana' && selectedModel !== 'nano-banana-pro') {
      if (uploadedImages.length > 0) {
        options.images = uploadedImages
        const paths: string[] = [...uploadedFilePaths]
        for (let i = 0; i < uploadedImages.length; i++) {
          if (!paths[i]) {
            const blob = await dataUrlToBlob(uploadedImages[i])
            const saved = await saveUploadImage(blob)
            paths[i] = saved.fullPath
          }
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
        // 根据maxImages决定sequential_image_generation
        if (maxImages > 1) {
          options.sequential_image_generation = 'auto'
          options.max_images = maxImages
        } else {
          options.sequential_image_generation = 'disabled'
        }
        // 默认不添加水印
        options.watermark = false
      }
    }

    if (currentModel?.type === 'video' && selectedModel === 'vidu-q1') {
      options.mode = viduMode
      options.duration = _viduDuration
      options.movementAmplitude = viduMovementAmplitude
      options.bgm = viduBgm

      // 根据模式添加不同的参数
      if (viduMode === 'text-image-to-video') {
        // 文/图生视频：最多1张图片
        if (uploadedImages.length > 0) {
          options.images = [uploadedImages[0]]
          const p0 = uploadedFilePaths[0]
          if (p0) {
            options.uploadedFilePaths = [p0]
          } else {
            const blob = await dataUrlToBlob(uploadedImages[0])
            const saved = await saveUploadImage(blob)
            options.uploadedFilePaths = [saved.fullPath]
            setUploadedFilePaths([saved.fullPath])
          }
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
        const existing = uploadedFilePaths.slice(0, 2)
        const paths: string[] = [...existing]
        for (let i = 0; i < options.images.length; i++) {
          if (!paths[i]) {
            const blob = await dataUrlToBlob(options.images[i])
            const saved = await saveUploadImage(blob)
            paths[i] = saved.fullPath
          }
        }
        options.uploadedFilePaths = paths
        setUploadedFilePaths(paths)
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
        const existing = uploadedFilePaths.slice(0, 7)
        const paths: string[] = [...existing]
        for (let i = 0; i < options.images.length; i++) {
          if (!paths[i]) {
            const blob = await dataUrlToBlob(options.images[i])
            const saved = await saveUploadImage(blob)
            paths[i] = saved.fullPath
          }
        }
        options.uploadedFilePaths = paths
        setUploadedFilePaths(paths)
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
        const p0 = uploadedFilePaths[0]
        if (p0) {
          options.uploadedFilePaths = [p0]
        } else {
          const blob = await dataUrlToBlob(uploadedImages[0])
          const saved = await saveUploadImage(blob)
          options.uploadedFilePaths = [saved.fullPath]
          setUploadedFilePaths([saved.fullPath])
        }
      }

    } else if (currentModel?.type === 'video' && selectedModel === 'minimax-hailuo-2.3') {
      options.duration = videoDuration || 6
      options.resolution = videoResolution || '768P'
      options.promptExtend = minimaxEnablePromptExpansion
      if (uploadedImages.length > 0) {
        options.images = [uploadedImages[0]]
        const p0 = uploadedFilePaths[0]
        if (p0) {
          options.uploadedFilePaths = [p0]
        } else {
          const blob = await dataUrlToBlob(uploadedImages[0])
          const saved = await saveUploadImage(blob)
          options.uploadedFilePaths = [saved.fullPath]
          setUploadedFilePaths([saved.fullPath])
        }
      }
      if (uploadedImages.length > 0) {
        ; (options as any).hailuoFast = hailuoFastMode
      }
    } else if (currentModel?.type === 'video' && selectedModel === 'minimax-hailuo-02') {
      options.duration = videoDuration || 6
      options.resolution = videoResolution || '768P'
      options.promptExtend = minimaxEnablePromptExpansion
      if (uploadedImages.length > 0) {
        const take = Math.min(uploadedImages.length, 2)
        options.images = uploadedImages.slice(0, take)
        const existing = uploadedFilePaths.slice(0, take)
        const paths: string[] = [...existing]
        for (let i = 0; i < options.images.length; i++) {
          if (!paths[i]) {
            const blob = await dataUrlToBlob(options.images[i])
            const saved = await saveUploadImage(blob)
            paths[i] = saved.fullPath
          }
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
        const p0 = uploadedFilePaths[0]
        if (p0) {
          options.uploadedFilePaths = [p0]
        } else {
          const blob = await dataUrlToBlob(uploadedImages[0])
          const saved = await saveUploadImage(blob)
          options.uploadedFilePaths = [saved.fullPath]
          setUploadedFilePaths([saved.fullPath])
        }
      }
      if (videoSeed !== undefined) options.seed = videoSeed
    } else if (currentModel?.type === 'video' && selectedModel === 'wan-2.5-preview') {
      options.duration = videoDuration
      options.promptExtend = wanPromptExtend
      options.audio = wanAudio
      if (uploadedImages.length > 0) {
        options.images = [uploadedImages[0]]
        const p0 = uploadedFilePaths[0]
        if (p0) {
          options.uploadedFilePaths = [p0]
        } else {
          const blob = await dataUrlToBlob(uploadedImages[0])
          const saved = await saveUploadImage(blob, 'persist', { maxDimension: 2000 })
          options.uploadedFilePaths = [saved.fullPath]
          setUploadedFilePaths([saved.fullPath])
        }
        options.resolution = wanResolution
      } else {
        options.size = wanSize
      }
      options.negativePrompt = videoNegativePrompt
    } else if (currentModel?.type === 'video' && selectedModel === 'seedance-v1') {
      options.resolution = seedanceResolution
      options.aspectRatio = seedanceAspectRatio
      options.duration = videoDuration
      options.cameraFixed = seedanceCameraFixed
        ; (options as any).seedanceVariant = seedanceVariant
      if (uploadedImages.length > 0) {
        const first = uploadedImages[0]
        options.images = [first]
        const paths: string[] = []
        const p0 = uploadedFilePaths[0]
        if (p0) {
          paths.push(p0)
        } else {
          const blob1 = await dataUrlToBlob(first)
          const saved1 = await saveUploadImage(blob1, 'persist', { maxDimension: 6000 })
          paths.push(saved1.fullPath)
        }
        if (uploadedImages.length > 1) {
          const last = uploadedImages[1]
          options.lastImage = last
          const p1 = uploadedFilePaths[1]
          if (p1) {
            paths.push(p1)
          } else {
            const blob2 = await dataUrlToBlob(last)
            const saved2 = await saveUploadImage(blob2, 'persist', { maxDimension: 6000 })
            paths.push(saved2.fullPath)
          }
        }
        options.uploadedFilePaths = paths
        setUploadedFilePaths(paths)
      }
    } else if (currentModel?.type === 'video' && (selectedModel === 'seedance-v1-lite' || selectedModel === 'seedance-v1-pro')) {
      options.resolution = seedanceResolution
      options.aspectRatio = seedanceAspectRatio
      options.duration = videoDuration
      options.cameraFixed = seedanceCameraFixed
      if (uploadedImages.length > 0) {
        const first = uploadedImages[0]
        options.images = [first]
        const paths: string[] = []
        const p0 = uploadedFilePaths[0]
        if (p0) {
          paths.push(p0)
        } else {
          const blob1 = await dataUrlToBlob(first)
          const saved1 = await saveUploadImage(blob1, 'persist', { maxDimension: 6000 })
          paths.push(saved1.fullPath)
        }
        if (selectedModel === 'seedance-v1-lite' && uploadedImages.length > 1) {
          const last = uploadedImages[1]
          options.lastImage = last
          const p1 = uploadedFilePaths[1]
          if (p1) {
            paths.push(p1)
          } else {
            const blob2 = await dataUrlToBlob(last)
            const saved2 = await saveUploadImage(blob2, 'persist', { maxDimension: 6000 })
            paths.push(saved2.fullPath)
          }
        }
        if (selectedModel === 'seedance-v1-pro' && uploadedImages.length > 1) {
          const last = uploadedImages[1]
          options.lastImage = last
          const p1 = uploadedFilePaths[1]
          if (p1) {
            paths.push(p1)
          } else {
            const blob2 = await dataUrlToBlob(last)
            const saved2 = await saveUploadImage(blob2, 'persist', { maxDimension: 6000 })
            paths.push(saved2.fullPath)
          }
        }
        options.uploadedFilePaths = paths
        setUploadedFilePaths(paths)
      }
    } else if (currentModel?.type === 'audio') {
      options.speed = audioSpeed
      options.emotion = audioEmotion
      options.voiceId = voiceId
      options.output_format = 'url'
      options.spec = audioSpec
      options.vol = audioVol
      options.pitch = audioPitch
      options.sample_rate = audioSampleRate
      options.bitrate = audioBitrate
      options.format = audioFormat
      options.channel = audioChannel
      options.latex_read = latexRead
      options.text_normalization = textNormalization
      options.language_boost = languageBoost
    } else if (currentModel?.type === 'image' && selectedModel === 'nano-banana') {
      // Nano Banana 参数
      options.num_images = numImages
      options.aspect_ratio = aspectRatio

      // 处理图片上传（图生图模式）
      if (uploadedImages.length > 0) {
        options.images = uploadedImages
        const paths: string[] = [...uploadedFilePaths]
        for (let i = 0; i < uploadedImages.length; i++) {
          if (!paths[i]) {
            const blob = await dataUrlToBlob(uploadedImages[i])
            const saved = await saveUploadImage(blob)
            paths[i] = saved.fullPath
          }
        }
        setUploadedFilePaths(paths)
        options.uploadedFilePaths = paths
      }
    } else if (currentModel?.type === 'image' && selectedModel === 'nano-banana-pro') {
      // Nano Banana Pro 参数
      options.model_id = 'nano-banana-pro'
      options.num_images = numImages
      options.aspect_ratio = aspectRatio
      options.resolution = resolution

      // 处理图片上传（图生图模式）
      if (uploadedImages.length > 0) {
        options.images = uploadedImages
        const paths: string[] = [...uploadedFilePaths]
        for (let i = 0; i < uploadedImages.length; i++) {
          if (!paths[i]) {
            const blob = await dataUrlToBlob(uploadedImages[i])
            const saved = await saveUploadImage(blob)
            paths[i] = saved.fullPath
          }
        }
        setUploadedFilePaths(paths)
        options.uploadedFilePaths = paths
      }
    }

    // 处理即梦4.0的批量生成前缀
    let finalInput = input
    if (selectedModel === 'seedream-4.0' && maxImages > 1) {
      finalInput = `生成${maxImages}张图片。${input}`
    }

    onGenerate(finalInput, selectedModel, currentModel?.type || 'image', options)
  }


  const handleImageFileUpload = async (files: File[]) => {
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
      } else if (selectedModel === 'wan-2.5-preview') {
        maxImageCount = 1
      } else if (selectedModel === 'seedance-v1') {
        maxImageCount = 2
      } else if (selectedModel === 'seedance-v1-lite') {
        maxImageCount = 2
      } else if (selectedModel === 'seedance-v1-pro') {
        maxImageCount = 2
      }

      for (const file of files) {
        if (file) {
          const saved = await saveUploadImage(file, 'memory')
          setUploadedImages(prev => {
            if (prev.length >= maxImageCount) return prev
            return [...prev, saved.dataUrl]
          })
        }
      }
    }
  }

  const handleImageReplace = async (index: number, newFile: File) => {
    const saved = await saveUploadImage(newFile, 'memory')
    setUploadedImages(prev => {
      const updated = [...prev]
      updated[index] = saved.dataUrl
      return updated
    })
    setUploadedFilePaths(prev => {
      const updated = [...prev]
      updated[index] = saved.fullPath
      return updated
    })
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    if ((selectedModel === 'kling-2.5-turbo' || selectedModel === 'wan-2.5-preview') && uploadedImages.length >= 1) {
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
                if ((selectedModel === 'kling-2.5-turbo' && prev.length >= 1)) return prev
                return [...prev, event.target?.result as string]
              })
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


  const handleSchemaChange = (id: string, value: any) => {
    switch (id) {
      case 'wanSize': setWanSize(value); break
      case 'wanResolution': setWanResolution(value); break
      case 'wanPromptExtend': setWanPromptExtend(value); break
      case 'wanAudio': setWanAudio(value); break
      case 'videoNegativePrompt': setVideoNegativePrompt(value); break
      // Vidu
      case 'viduMode': setViduMode(value); break
      case 'viduAspectRatio': setViduAspectRatio(value); break
      case 'viduStyle': setViduStyle(value); break
      case 'viduMovementAmplitude': setViduMovementAmplitude(value); break
      case 'viduBgm': setViduBgm(value); break
      // Kling
      case 'videoDuration': setVideoDuration(value); break
      case 'videoAspectRatio': setVideoAspectRatio(value); break
      case 'klingCfgScale': setKlingCfgScale(value); break
      // Hailuo
      case 'videoResolution': setVideoResolution(value); break
      case 'hailuoFastMode': setHailuoFastMode(value); break
      // PixVerse
      case 'pixFastMode': setPixFastMode(value); break
      // Seedance
      case 'seedanceVariant': setSeedanceVariant(value); break
      case 'seedanceResolution': setSeedanceResolution(value); break
      case 'seedanceAspectRatio': setSeedanceAspectRatio(value); break
      case 'seedanceCameraFixed': setSeedanceCameraFixed(value); break
      // Seedream
      case 'maxImages': setMaxImages(value); break
      // Minimax Speech
      case 'audioSpec': setAudioSpec(value); break
      case 'audioEmotion': setAudioEmotion(value); break
      case 'languageBoost': setLanguageBoost(value); break
      case 'audioVol': setAudioVol(value); break
      case 'audioPitch': setAudioPitch(value); break
      case 'audioSpeed': setAudioSpeed(value); break
      case 'audioSampleRate': setAudioSampleRate(value); break
      case 'audioBitrate': setAudioBitrate(value); break
      case 'audioFormat': setAudioFormat(value); break
      case 'audioChannel': setAudioChannel(value); break
      case 'latexRead': setLatexRead(value); break
      case 'textNormalization': setTextNormalization(value); break
      // Nano Banana & Nano Banana Pro
      case 'num_images': setNumImages(value); break
      case 'aspect_ratio': setAspectRatio(value); break
      case 'resolution': setResolution(value); break
    }
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
      if (m === 'wan-2.5-preview') return 1
      if (m === 'seedance-v1') return seedanceVariant === 'lite' ? 2 : 1
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



  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        _setVoiceDropdownClosing(true)
        setTimeout(() => {
          setIsVoiceDropdownOpen(false)
          _setVoiceDropdownClosing(false)
        }, 200)
      }
    }
    const onDoc = (e: MouseEvent) => {
      const el = voiceRef.current
      if (el && !el.contains(e.target as Node)) {
        _setVoiceDropdownClosing(true)
        setTimeout(() => {
          setIsVoiceDropdownOpen(false)
          _setVoiceDropdownClosing(false)
        }, 200)
      }
    }
    if (isVoiceDropdownOpen) {
      document.addEventListener('keydown', onKey)
      document.addEventListener('mousedown', onDoc)
    }
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDoc)
    }
  }, [isVoiceDropdownOpen])





  return (
    <div className="w-full max-w-5xl mx-auto">
      {/* 模型选择器、分辨率设置和即梦参数设置 */}
      <ParamRow className="mb-4">
        <PanelTrigger
          label="模型"
          display={`${currentProvider?.name}_${currentModel?.name || '选择'}`}
          className="w-auto min-w-[180px] flex-shrink-0"
          panelWidth={720}
          alignment="aboveCenter"
          stableHeight={true}
          closeOnPanelClick={(t) => !!(t as HTMLElement).closest('[data-close-on-select]')}
          renderPanel={() => (
            <div className="p-4 h-full flex flex-col">
              <div className="mb-3">
                <div className="text-xs text-zinc-400 mb-2">供应商 / 类型</div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setModelFilterProvider('all')} className={`px-3 py-2 text-xs rounded transition-all duration-300 ${modelFilterProvider === 'all' ? 'bg-[#007eff] text-white' : 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50'}`}>全部供应商</button>
                  {providers.map(p => (
                    <button key={p.id} onClick={() => setModelFilterProvider(p.id)} className={`px-3 py-2 text-xs rounded transition-all duration-300 ${modelFilterProvider === p.id ? 'bg-[#007eff] text-white' : 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50'}`}>{p.name}</button>
                  ))}
                  <div className="w-px bg-zinc-600/50 mx-1"></div>
                  {[
                    { label: '全部类型', value: 'all' },
                    { label: '图片', value: 'image' },
                    { label: '视频', value: 'video' },
                    { label: '音频', value: 'audio' }
                  ].map(t => (
                    <button key={t.value} onClick={() => setModelFilterType(t.value as 'all' | 'image' | 'video' | 'audio')} className={`px-3 py-2 text-xs rounded transition-all duration-300 ${modelFilterType === t.value ? 'bg-[#007eff] text-white' : 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50'}`}>{t.label}</button>
                  ))}
                </div>
              </div>
              <div className="mb-3">
                <div className="text-xs text-zinc-400 mb-2">功能</div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: '全部', value: 'all' },
                    { label: '图片生成', value: '图片生成' },
                    { label: '图片编辑', value: '图片编辑' },
                    { label: '文生视频', value: '文生视频' },
                    { label: '图生视频', value: '图生视频' },
                    { label: '首尾帧', value: '首尾帧' },
                    { label: '参考生视频', value: '参考生视频' },
                    { label: '语音合成', value: '语音合成' }
                  ].map(f => (
                    <button key={f.value} onClick={() => setModelFilterFunction(f.value)} className={`px-3 py-2 text-xs rounded transition-all duration-300 ${modelFilterFunction === f.value ? 'bg-[#007eff] text-white' : 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50'}`}>{f.label}</button>
                  ))}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                <div className="grid grid-cols-3 gap-2">
                  {providers
                    .flatMap(p => p.models.map(m => ({ p, m })))
                    .filter(item => (modelFilterProvider === 'all' ? true : item.p.id === modelFilterProvider))
                    .filter(item => (modelFilterType === 'all' ? true : item.m.type === modelFilterType))
                    .filter(item => (modelFilterFunction === 'all' ? true : item.m.functions.includes(modelFilterFunction)))
                    .map(({ p, m }) => (
                      <div key={`${p.id}-${m.id}`} data-close-on-select onClick={() => handleModelSelect(p.id, m.id)} className={`px-3 py-3 cursor-pointer transition-colors duration-200 rounded-lg border ${selectedProvider === p.id && selectedModel === m.id ? 'bg-[#007eff]/20 text-[#66b3ff] border-[#007eff]/30' : 'bg-zinc-700/40 hover:bg-zinc-700/60 border-zinc-700/50'}`}>
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
          )}
        />

        {/* 分辨率设置按钮 - 仅对图片模型显示（排除 nano-banana 和 nano-banana-pro，它们使用 aspect_ratio） */}
        {currentModel?.type === 'image' && selectedModel !== 'nano-banana' && selectedModel !== 'nano-banana-pro' && (
          <PanelTrigger
            label="分辨率"
            display={selectedResolution === 'smart' ? '智能' : selectedResolution}
            className="w-auto"
            panelWidth={320}
            alignment="aboveCenter"
            closeOnPanelClick={false}
            renderPanel={() => (
              <div className="p-4">
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
                      <button key={resolution.value} onClick={() => handleResolutionSelect(resolution.value)} className={`px-2 py-3 text-xs rounded flex flex-col items-center justify-center gap-2 transition-all duration-300 ${selectedResolution === resolution.value ? 'bg-[#007eff] text-white' : 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50'}`}>
                        {resolution.ratio && (
                          <div className="flex items-center justify-center h-8">
                            <div className={`border-2 border-white ${resolution.ratio === '21:9' ? 'w-8 h-3' : resolution.ratio === '16:9' ? 'w-8 h-4' : resolution.ratio === '3:2' ? 'w-7 h-5' : resolution.ratio === '4:3' ? 'w-7 h-5' : resolution.ratio === '1:1' ? 'w-6 h-6' : resolution.ratio === '3:4' ? 'w-5 h-7' : resolution.ratio === '2:3' ? 'w-5 h-7' : resolution.ratio === '9:16' ? 'w-4 h-8' : 'w-6 h-6'}`}></div>
                          </div>
                        )}
                        <span className="font-medium">{resolution.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mb-3">
                  <label className="block text-xs text-zinc-400 mb-2">选择分辨率</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: '高清 2K', value: '2K' },
                      { label: '超清 4K', value: '4K' }
                    ].map(res => (
                      <button key={res.value} onClick={() => handleQualitySelect(res.value as '2K' | '4K')} className={`px-3 py-2 text-sm rounded transition-all duration-300 ${resolutionQuality === res.value ? 'bg-[#007eff] text-white' : 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50'}`}>{res.label}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-2">尺寸</label>
                  <div className="flex gap-2 items-center">
                    <div className="flex-1">
                      <input type="number" value={customWidth} onChange={(e) => handleManualWidthChange(e.target.value)} disabled={selectedResolution === 'smart'} placeholder="2048" className={`w-full bg-zinc-700/50 border border-zinc-700/50 rounded px-3 py-2 text-sm ${selectedResolution === 'smart' ? 'opacity-50 cursor-not-allowed' : ''}`} min="1024" max="8192" />
                    </div>
                    <svg className="w-4 h-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path></svg>
                    <div className="flex-1">
                      <input type="number" value={customHeight} onChange={(e) => handleManualHeightChange(e.target.value)} disabled={selectedResolution === 'smart'} placeholder="2048" className={`w-full bg-zinc-700/50 border border-zinc-700/50 rounded px-3 py-2 text-sm ${selectedResolution === 'smart' ? 'opacity-50 cursor-not-allowed' : ''}`} min="1024" max="8192" />
                    </div>
                    <span className="text-xs text-zinc-400">PX</span>
                  </div>
                </div>
              </div>
            )}
          />
        )}

        {currentModel?.type === 'audio' && (
          <>
            {/* Minimax Speech - Spec */}
            {selectedModel === 'minimax-speech-2.6' && (
              <SchemaForm
                schema={minimaxSpeechBasicParams.slice(0, 1)}
                values={{ audioSpec }}
                onChange={handleSchemaChange}
              />
            )}

            {/* Voice PanelTrigger - Keep original */}
            <PanelTrigger
              label="音色"
              display={voicePresets.find(v => v.id === voiceId)?.name || voiceId}
              className="w-auto min-w-[140px] flex-shrink-0"
              panelWidth={720}
              alignment="aboveCenter"
              stableHeight={true}
              closeOnPanelClick={(t) => !!(t as HTMLElement).closest('[data-close-on-select]')}
              renderPanel={() => (
                <div className="p-4 h-full flex flex-col">
                  <div className="mb-3">
                    <div className="text-xs text-zinc-400 mb-2">性别</div>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { label: '全部', value: 'all' },
                        { label: '男', value: 'male' },
                        { label: '女', value: 'female' },
                        { label: '童声', value: 'child' },
                        { label: '其他', value: 'other' }
                      ].map(g => (
                        <button key={g.value} type="button" onClick={() => setVoiceFilterGender(g.value as any)} className={`px-3 py-2 text-xs rounded transition-all duration-300 outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 focus-visible:ring-0 ${voiceFilterGender === g.value ? 'bg-[#007eff] text-white' : 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50'}`}>{g.label}</button>
                      ))}
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    <div className="grid grid-cols-3 gap-2">
                      {voicePresets
                        .filter(v => voiceFilterGender === 'all' ? true : v.gender === voiceFilterGender)
                        .map(v => (
                          <div key={v.id} data-close-on-select onClick={() => { setVoiceId(v.id); }} className={`px-3 py-3 cursor-pointer transition-colors duration-200 rounded-lg border ${voiceId === v.id ? 'bg-[#007eff]/20 text-[#66b3ff] border-[#007eff]/30' : 'bg-zinc-700/40 hover:bg-zinc-700/60 border-zinc-700/50'}`}>
                            <div className="flex items-center justify-between">
                              <span className="text-sm">{v.name}</span>
                              <span className="text-[11px] text-zinc-400">{v.id}</span>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              )}
            />

            {/* Minimax Speech - Emotion & Language Boost */}
            {selectedModel === 'minimax-speech-2.6' && (
              <SchemaForm
                schema={minimaxSpeechBasicParams.slice(1, 3)}
                values={{ audioEmotion, languageBoost }}
                onChange={handleSchemaChange}
              />
            )}


            {/* Advanced Options PanelTrigger - Keep wrapper, replace content with SchemaForm */}
            <PanelTrigger
              label="高级选项"
              display="打开"
              className="w-auto min-w-[100px] flex-shrink-0"
              panelWidth={576}
              alignment="aboveCenter"
              closeOnPanelClick={false}
              renderPanel={() => (
                <div className="flex flex-col bg-white/95 dark:bg-zinc-800 rounded-lg max-h-[420px]">
                  <div className="p-4 flex flex-col gap-4 overflow-y-auto">
                    <div className="flex gap-4">
                      <SchemaForm
                        schema={minimaxSpeechAdvancedParams.slice(0, 3)}
                        values={{ audioVol, audioPitch, audioSpeed }}
                        onChange={handleSchemaChange}
                      />
                    </div>
                    <div className="flex gap-4">
                      <SchemaForm
                        schema={minimaxSpeechAdvancedParams.slice(3, 7)}
                        values={{ audioSampleRate, audioBitrate, audioFormat, audioChannel }}
                        onChange={handleSchemaChange}
                      />
                    </div>
                    <div className="flex gap-4">
                      <SchemaForm
                        schema={minimaxSpeechAdvancedParams.slice(7, 9)}
                        values={{ latexRead, textNormalization }}
                        onChange={handleSchemaChange}
                      />
                    </div>
                  </div>
                </div>
              )}
            />
          </>
        )}

        {/* Vidu Q1 参数设置 - 仅对Vidu Q1模型显示 */}
        {/* Vidu Q1 参数设置 - 仅对Vidu Q1模型显示 */}
        {selectedModel === 'vidu-q1' && (
          <SchemaForm
            schema={viduParams}
            values={{
              viduMode,
              viduAspectRatio,
              viduStyle,
              viduMovementAmplitude,
              viduBgm,
              uploadedImages // Needed for hidden logic
            }}
            onChange={handleSchemaChange}
          />
        )}

        {currentModel?.type === 'video' && selectedModel !== 'vidu-q1' && (
          <>

            {/* Hailuo Parameters */}
            {(selectedModel === 'minimax-hailuo-2.3' || selectedModel === 'minimax-hailuo-02') && (
              <SchemaForm
                schema={hailuoParams}
                values={{
                  videoDuration,
                  videoResolution,
                  hailuoFastMode,
                  selectedModel,
                  uploadedImages
                }}
                onChange={handleSchemaChange}
              />
            )}

            {/* PixVerse Parameters */}
            {selectedModel === 'pixverse-v4.5' && (
              <SchemaForm
                schema={pixverseParams}
                values={{
                  videoAspectRatio,
                  videoResolution,
                  pixFastMode,
                  uploadedImages
                }}
                onChange={handleSchemaChange}
              />
            )}

            {/* Kling Parameters */}
            {selectedModel === 'kling-2.5-turbo' && (
              <SchemaForm
                schema={klingParams}
                values={{
                  videoDuration,
                  videoAspectRatio,
                  klingCfgScale,
                  uploadedImages
                }}
                onChange={handleSchemaChange}
              />
            )}

            {(selectedModel === 'minimax-hailuo-2.3' || selectedModel === 'minimax-hailuo-2.3-fast') && (
              <Toggle label="提示词优化" checked={minimaxEnablePromptExpansion} onChange={setMinimaxEnablePromptExpansion} className="w-auto" />
            )}


            {selectedModel === 'wan-2.5-preview' && (
              <>
                <SchemaForm
                  schema={wan25Params}
                  values={{
                    wanSize,
                    wanResolution,
                    videoDuration,
                    wanPromptExtend,
                    wanAudio,
                    uploadedImages // Needed for hidden logic
                  }}
                  onChange={handleSchemaChange}
                />
                <TextInput label="负面提示" value={videoNegativePrompt} onChange={setVideoNegativePrompt} placeholder="不希望出现的内容" className="w-auto flex-1 min-w-[200px]" inputClassName="w-full" />
              </>
            )}

            {/* Seedance Parameters */}
            {(selectedModel === 'seedance-v1' || selectedModel === 'seedance-v1-lite' || selectedModel === 'seedance-v1-pro') && (
              <SchemaForm
                schema={seedanceParams}
                values={{
                  seedanceVariant,
                  videoDuration,
                  seedanceResolution,
                  seedanceAspectRatio,
                  seedanceCameraFixed,
                  selectedModel,
                  uploadedImages
                }}
                onChange={handleSchemaChange}
              />
            )}

            {selectedModel !== 'minimax-hailuo-2.3' && selectedModel !== 'minimax-hailuo-2.3-fast' && selectedModel !== 'minimax-hailuo-02' && selectedModel !== 'wan-2.5-preview' && selectedModel !== 'seedance-v1' && selectedModel !== 'seedance-v1-lite' && selectedModel !== 'seedance-v1-pro' && (
              <TextInput label="负面提示" value={videoNegativePrompt} onChange={setVideoNegativePrompt} placeholder="不希望出现的内容" className="w-auto flex-1 min-w-[200px]" inputClassName="w-full" />
            )}
            {selectedModel !== 'kling-2.5-turbo' && selectedModel !== 'minimax-hailuo-2.3' && selectedModel !== 'minimax-hailuo-2.3-fast' && selectedModel !== 'minimax-hailuo-02' && selectedModel !== 'pixverse-v4.5' && selectedModel !== 'wan-2.5-preview' && selectedModel !== 'seedance-v1' && selectedModel !== 'seedance-v1-lite' && selectedModel !== 'seedance-v1-pro' && (
              <NumberInput label="随机种子" value={typeof videoSeed === 'number' ? videoSeed : 0} onChange={(v) => setVideoSeed(Math.max(0, Math.round(v)))} min={0} step={1} widthClassName="w-20" className="w-auto min-w-[120px]" />
            )}
          </>
        )}

        {/* Seedream Parameters */}
        {selectedModel === 'seedream-4.0' && (
          <SchemaForm
            schema={seedreamParams}
            values={{
              maxImages
            }}
            onChange={handleSchemaChange}
          />
        )}

        {/* Nano Banana Parameters */}
        {selectedModel === 'nano-banana' && (
          <SchemaForm
            schema={nanoBananaParams}
            values={{
              num_images: numImages,
              aspect_ratio: aspectRatio,
              uploadedImages
            }}
            onChange={handleSchemaChange}
          />
        )}

        {/* Nano Banana Pro Parameters */}
        {selectedModel === 'nano-banana-pro' && (
          <SchemaForm
            schema={nanoBananaProParams}
            values={{
              num_images: numImages,
              aspect_ratio: aspectRatio,
              resolution: resolution,
              uploadedImages
            }}
            onChange={handleSchemaChange}
          />
        )}
      </ParamRow>

      {/* 输入区域 */}
      <div className="relative bg-[#131313]/70 rounded-xl border border-zinc-700/50 p-4">
        {/* 图片上传和预览区域 - 独立一行 */}
        {currentModel?.type !== 'audio' && (
          <div className="mb-3">
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
              } else if (selectedModel === 'seedance-v1' || selectedModel === 'seedance-v1-lite' || selectedModel === 'seedance-v1-pro') {
                maxImageCount = 2
              }

              return (
                <FileUploader
                  files={uploadedImages}
                  onUpload={handleImageFileUpload}
                  onRemove={removeImage}
                  onReplace={handleImageReplace}
                  accept="image/*"
                  multiple={(selectedModel === 'vidu-q1' && viduMode === 'reference-to-video') || selectedModel === 'minimax-hailuo-02' ? true : (selectedModel === 'kling-2.5-turbo' || selectedModel === 'minimax-hailuo-2.3' || selectedModel === 'wan-2.5-preview' ? false : true)}
                  maxCount={maxImageCount}
                  removingIndices={removingImages}
                />
              )
            })()}
          </div>
        )}

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
            placeholder={currentModel?.type === 'audio' ? '输入要合成的文本' : '描述想要生成的内容'}
            className={`w-full bg-transparent backdrop-blur-lg rounded-xl p-4 pr-14 ${currentModel?.type === 'audio' ? 'min-h-[140px]' : 'min-h-[100px]'} resize-none focus:outline-none focus:ring-2 focus:ring-white/20 transition-shadow duration-300 ease-in-out text-white placeholder-zinc-400`}
            disabled={isLoading}
          />

          {/* 生成按钮 */}
          <button
            onClick={handleGenerate}
            disabled={isLoading || (!input.trim() && (currentModel?.type !== 'audio' && uploadedImages.length === 0))}
            className={`absolute bottom-3 right-3 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${isLoading || (!input.trim() && uploadedImages.length === 0)
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
      <div className="flex flex-wrap gap-3 mt-4 justify-between items-center">
        <button
          onClick={onOpenClearHistory}
          disabled={isLoading}
          className="px-4 py-2 bg-red-600/60 hover:bg-red-600/80 backdrop-blur-lg rounded-lg transition-all duration-300 border border-red-700/50 flex items-center text-sm"
          title="清除历史"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          清除历史
        </button>
        <button
          onClick={onOpenSettings}
          className="px-4 py-2 bg-zinc-700/50 hover:bg-zinc-600/50 backdrop-blur-lg rounded-lg transition-all duration-300 border border-zinc-700/50 flex items-center text-sm"
          title="设置"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          设置
        </button>

        {/* 价格估算 - 放在操作按钮右侧 */}
        <div className="ml-auto">
          <PriceEstimate
            providerId={selectedProvider}
            modelId={selectedModel}
            params={{
              // 图片参数
              num_images: numImages,
              maxImages,
              uploadedImages,
              resolution,

              // 视频参数
              videoDuration,
              videoResolution,
              viduMode,
              hailuoFastMode,
              pixFastMode,
              seedanceVariant,
              seedanceResolution,
              seedanceAspectRatio,
              wanResolution,

              // 音频参数
              input,
              audioSpec
            }}
          />
        </div>
      </div>


    </div>
  )
}

export default MediaGenerator
