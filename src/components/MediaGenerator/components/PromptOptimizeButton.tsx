import { createLogger } from '@/core/logging'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import PanelTrigger from '@/components/ui/PanelTrigger'
import { AlertDialog, UI_TEXT_META_CLASS, UiButton } from '@/components/ui'
import { LLM_CONFIG_CHANGED_EVENT } from '@/core/llm/events'
import {
  renderPromptOptimizationTemplate,
  type PromptOptimizationTargetModel,
} from '@/core/llm/promptOptimization'
import {
  PROMPT_OPTIMIZATION_BUTTON_BEHAVIOR_CHANGED_EVENT,
  readPromptOptimizationButtonBehavior,
  type PromptOptimizationButtonBehavior,
} from '@/core/llm/promptOptimizationBehavior'
import type {
  LlmConfigState,
  PromptOptimizationProfile,
} from '@/core/llm/types'
import { llmCancelTask, llmChatStream } from '@/commands/llmRuntime'
import {
  ensurePromptOptimizationModelSelection,
  llmConfigService,
  resolvePromptOptimizationReadiness,
  type PromptOptimizationReadiness,
} from '@/services/llm'
import { openSettingsPanel } from '@/stores/uiStore'
import { UploadService } from '@/services/upload/UploadService'
import { PromptOptimizationProfilesPanel } from './PromptOptimizationProfilesPanel'
import { PromptOptimizationSelectorPanel } from './PromptOptimizationSelectorPanel'
import {
  buildPromptOptimizationUserMessageWithAttachments,
  resolvePromptOptimizationProfile,
} from './promptOptimizeRequest'
const logger = createLogger('components.MediaGenerator.PromptOptimizeButton')
const PANEL_SWITCH_ANIMATION_MS = 220

type PromptOptimizationGuidance = Exclude<PromptOptimizationReadiness['status'], 'ready'>

/**
 * 缺配置时的引导文案。两种缺口要去的地方不同：没有密钥去全局设置的大语言模型分区，
 * 有密钥但没有可用模型去优化配置面板自己选。
 */
const PROMPT_OPTIMIZATION_GUIDANCE: Record<PromptOptimizationGuidance, { title: string; message: string }> = {
  'missing-provider-key': {
    title: '还没有可用的大语言模型',
    message: '提示词优化需要大语言模型。请先在设置里填写供应商的 API 密钥，之后会自动选用该供应商下的第一个可用模型。',
  },
  'missing-model': {
    title: '优化配置还没有可用模型',
    message: '当前提示词优化配置没有可用模型。请在提示词优化配置里选择供应商和模型，或先在设置里启用该供应商下的模型。',
  },
}

function createPromptOptimizationRequestId(): string {
  return `prompt-optimizer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

interface PromptOptimizeButtonProps {
  prompt: string
  uploadedImages: string[]
  uploadedFilePaths: string[]
  uploadedVideos: string[]
  uploadedVideoFiles: File[]
  uploadedVideoFilePaths: string[]
  targetModel?: PromptOptimizationTargetModel
  disabled?: boolean
  onOptimized: (prompt: string) => void
  onStreamPreviewChange?: (preview: { active: boolean; reasoning: string; content: string }) => void
  onAlert: (title: string, message: string, type?: 'info' | 'warning' | 'error') => void
}

export const PromptOptimizeButton: React.FC<PromptOptimizeButtonProps> = ({
  prompt,
  uploadedImages,
  uploadedFilePaths,
  uploadedVideos,
  uploadedVideoFiles,
  uploadedVideoFilePaths,
  targetModel,
  disabled,
  onOptimized,
  onStreamPreviewChange,
  onAlert,
}) => {
  const [config, setConfig] = useState<LlmConfigState | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [output, setOutput] = useState('')
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [panelMode, setPanelMode] = useState<'selector' | 'editor'>('selector')
  const [configuredProviderIds, setConfiguredProviderIds] = useState<readonly string[] | undefined>(undefined)
  const [guidance, setGuidance] = useState<PromptOptimizationGuidance | null>(null)
  const [buttonBehavior, setButtonBehavior] = useState<PromptOptimizationButtonBehavior>(
    readPromptOptimizationButtonBehavior()
  )
  const activeRequestIdRef = useRef<string | null>(null)
  const cancelledRequestIdRef = useRef<string | null>(null)
  const closePanelRef = useRef<() => void>(() => undefined)
  const openPanelRef = useRef<() => void>(() => undefined)
  const panelSwitchTimerRef = useRef<number | null>(null)

  const enabledProfiles = useMemo(() => {
    return config?.promptProfiles.filter(profile => profile.enabled) ?? []
  }, [config])

  const selectedProfile = useMemo(() => {
    return resolvePromptOptimizationProfile(config, selectedProfileId)
  }, [config, selectedProfileId])

  /**
   * `ensureModelSelection` 只在打开面板这类用户主动动作时开启：它要查一次密钥状态，
   * 而编辑模板时每次输入都会保存配置并触发一次重载，没必要跟着查。
   */
  const loadConfig = useCallback(async (
    options?: { ensureModelSelection?: boolean }
  ): Promise<void> => {
    try {
      const loadedConfig = await llmConfigService.getConfig()
      const resolved = options?.ensureModelSelection
        ? await ensurePromptOptimizationModelSelection(loadedConfig)
        : { config: loadedConfig, configuredProviderIds: undefined }
      const nextConfig = resolved.config
      setConfig(nextConfig)
      if (options?.ensureModelSelection) {
        setConfiguredProviderIds(resolved.configuredProviderIds)
      }
      setSelectedProfileId((previousSelectedProfileId) => {
        const profile = resolvePromptOptimizationProfile(nextConfig, previousSelectedProfileId)
        return profile?.id ?? ''
      })
    } catch (error) {
      logger.error('[PromptOptimize] 配置加载失败', error)
    }
  }, [])

  useEffect(() => {
    void loadConfig({ ensureModelSelection: true })
  }, [loadConfig])

  useEffect(() => {
    const reload = (): void => {
      void loadConfig()
    }
    window.addEventListener(LLM_CONFIG_CHANGED_EVENT, reload)
    return () => window.removeEventListener(LLM_CONFIG_CHANGED_EVENT, reload)
  }, [loadConfig])

  useEffect(() => {
    const syncBehavior = (): void => {
      setButtonBehavior(readPromptOptimizationButtonBehavior())
    }
    window.addEventListener(PROMPT_OPTIMIZATION_BUTTON_BEHAVIOR_CHANGED_EVENT, syncBehavior)
    return () => window.removeEventListener(PROMPT_OPTIMIZATION_BUTTON_BEHAVIOR_CHANGED_EVENT, syncBehavior)
  }, [])

  useEffect(() => {
    return () => {
      if (panelSwitchTimerRef.current !== null) {
        window.clearTimeout(panelSwitchTimerRef.current)
      }
    }
  }, [])

  const finishStreaming = useCallback((): void => {
    activeRequestIdRef.current = null
    onStreamPreviewChange?.({ active: false, reasoning: '', content: '' })
    setStreaming(false)
  }, [onStreamPreviewChange])

  const cancelOptimize = useCallback((): void => {
    const requestId = activeRequestIdRef.current
    if (!requestId) return
    cancelledRequestIdRef.current = requestId
    void llmCancelTask(requestId).catch(error => {
      logger.error('[PromptOptimize] 取消优化失败', error)
    })
    finishStreaming()
  }, [finishStreaming])

  useEffect(() => {
    if (!streaming) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      cancelOptimize()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [cancelOptimize, streaming])

  const rememberSelectedProfile = useCallback(async (profileId: string): Promise<void> => {
    setSelectedProfileId(profileId)
    if (!config || config.selectedPromptProfileId === profileId) {
      return
    }

    const nextConfig = {
      ...config,
      selectedPromptProfileId: profileId,
    }
    setConfig(nextConfig)
    try {
      await llmConfigService.saveConfig(nextConfig)
    } catch (error) {
      logger.error('[PromptOptimize] 保存所选配置失败', error)
    }
  }, [config])

  /**
   * 触发优化前的统一闸门：能用就返回可用的方案（可能已自动补选模型），不能用就弹引导。
   */
  const resolveReadiness = useCallback(async (
    profileOverride?: PromptOptimizationProfile
  ): Promise<Extract<PromptOptimizationReadiness, { status: 'ready' }> | null> => {
    const profile = profileOverride
      ?? selectedProfile
      ?? resolvePromptOptimizationProfile(config, selectedProfileId)
    const readiness = await resolvePromptOptimizationReadiness(config, profile)
    if (readiness.status !== 'ready') {
      setGuidance(readiness.status)
      return null
    }
    if (readiness.config !== config) {
      setConfig(readiness.config)
    }
    return readiness
  }, [config, selectedProfile, selectedProfileId])

  const runOptimize = useCallback(async (
    profileOverride?: PromptOptimizationProfile
  ): Promise<boolean> => {
    const currentPrompt = prompt.trim()
    if (!currentPrompt) {
      onAlert('缺少提示词', '请输入提示词后再优化。', 'warning')
      return false
    }

    const readiness = await resolveReadiness(profileOverride)
    if (!readiness) return false

    const profile = readiness.profile
    const provider = readiness.config.providers.find(item => item.providerId === profile.providerId) ?? null
    /*
     * 思考能力要按所选模型如实声明。
     *
     * 主进程按 `capabilities.reasoning` 决定要不要下发思考参数（见 providerReasoningRequest.ts），
     * 这里漏声明的话，供应商的思考模式设置对提示词优化就是不生效的。
     */
    const optimizerModel = readiness.config.models.find(item => (
      item.providerId === profile.providerId && item.modelId === profile.modelId
    )) ?? null
    const uploadService = UploadService.getInstance()
    setStreaming(true)
    setOutput('')
    const requestId = createPromptOptimizationRequestId()
    activeRequestIdRef.current = requestId
    cancelledRequestIdRef.current = null
    let nextOutput = ''
    let nextReasoning = ''
    onStreamPreviewChange?.({ active: true, reasoning: '', content: '' })

    try {
      const templateContext = {
        prompt: currentPrompt,
        imageCount: uploadedImages.length,
        videoCount: uploadedVideos.length,
        targetModel,
      }
      const userMessage = await buildPromptOptimizationUserMessageWithAttachments(
        currentPrompt,
        profile,
        uploadedImages,
        uploadedFilePaths,
        uploadedVideos,
        uploadedVideoFiles,
        uploadedVideoFilePaths,
        targetModel,
      )
      await llmChatStream({
        requestId,
        providerId: profile.providerId,
        modelId: profile.modelId,
        adapter: provider?.adapter ?? profile.providerId,
        baseUrl: provider?.baseUrl,
        reasoning: provider?.reasoning,
        messages: [
          { role: 'system', content: renderPromptOptimizationTemplate(profile.systemPrompt, templateContext) },
          userMessage,
        ],
        capabilities: {
          text: true,
          image: profile.capabilities.image,
          video: profile.capabilities.video,
          streaming: true,
          reasoning: optimizerModel?.capabilities.reasoning === true,
        },
        metadata: {
          source: 'prompt-optimizer',
          imageCount: uploadedImages.length,
          videoCount: uploadedVideos.length,
          __upload_provider: uploadService.getCurrentProvider(),
          __upload_fallback: uploadService.isFallbackEnabled(),
        },
      }, (event) => {
        if (cancelledRequestIdRef.current === requestId || activeRequestIdRef.current !== requestId) {
          return
        }

        if (event.type === 'Token') {
          nextOutput += event.data
          setOutput(nextOutput)
          onStreamPreviewChange?.({ active: true, reasoning: '', content: nextOutput })
        } else if (event.type === 'ReasoningToken') {
          nextReasoning += event.data
          onStreamPreviewChange?.({
            active: true,
            reasoning: nextOutput ? '' : nextReasoning,
            content: nextOutput,
          })
        } else if (event.type === 'Done') {
          const trimmed = nextOutput.trim()
          if (trimmed) {
            finishStreaming()
            onOptimized(trimmed)
            return
          }
          finishStreaming()
        } else if (event.type === 'Error') {
          onAlert('提示词优化失败', event.data, 'error')
          finishStreaming()
        }
      })
      return true
    } catch (error) {
      if (cancelledRequestIdRef.current === requestId) {
        cancelledRequestIdRef.current = null
        return false
      }
      const message = error instanceof Error ? error.message : String(error)
      onAlert('提示词优化失败', message, 'error')
      finishStreaming()
      return false
    }
  }, [
    finishStreaming,
    onAlert,
    onOptimized,
    onStreamPreviewChange,
    prompt,
    resolveReadiness,
    targetModel,
    uploadedFilePaths,
    uploadedImages,
    uploadedVideoFiles,
    uploadedVideoFilePaths,
    uploadedVideos,
  ])

  const openSelectorPanel = useCallback((openPanel: () => void): void => {
    void loadConfig({ ensureModelSelection: true })
    setPanelMode('selector')
    openPanel()
  }, [loadConfig])

  const openEditorPanel = useCallback((openPanel?: () => void): void => {
    void loadConfig({ ensureModelSelection: true })
    setPanelMode('editor')
    openPanel?.()
  }, [loadConfig])

  const switchToEditorPanel = useCallback((): void => {
    if (panelSwitchTimerRef.current !== null) {
      window.clearTimeout(panelSwitchTimerRef.current)
    }
    closePanelRef.current()
    panelSwitchTimerRef.current = window.setTimeout(() => {
      setPanelMode('editor')
      void loadConfig({ ensureModelSelection: true })
      openPanelRef.current()
      panelSwitchTimerRef.current = null
    }, PANEL_SWITCH_ANIMATION_MS)
  }, [loadConfig])

  const guidanceContent = guidance ? PROMPT_OPTIMIZATION_GUIDANCE[guidance] : null

  const applyGuidance = useCallback((): void => {
    const target = guidance
    setGuidance(null)
    if (target === 'missing-provider-key') {
      openSettingsPanel({ tab: 'api', sectionId: 'api-llm' })
      return
    }
    openEditorPanel(openPanelRef.current)
  }, [guidance, openEditorPanel])

  return (
    <>
      <PanelTrigger
        display={streaming ? '优化中' : '优化'}
        disabled={disabled || streaming}
        className="w-auto"
        panelWidth={panelMode === 'selector' ? 360 : 820}
        alignment="aboveCenter"
        stableHeight
        stableHeightKey={panelMode}
        closeOnPanelClick={false}
        renderPanel={() => (
          panelMode === 'selector'
            ? (
              <PromptOptimizationSelectorPanel
                profiles={enabledProfiles}
                selectedProfileId={selectedProfile?.id ?? ''}
                optimizing={streaming}
                onOpenEditor={switchToEditorPanel}
                onSelectProfile={(profileId) => {
                  const profile = enabledProfiles.find(item => item.id === profileId)
                  if (!profile) return
                  closePanelRef.current()
                  void rememberSelectedProfile(profileId)
                  void runOptimize(profile)
                }}
              />
              )
            : (
              <div className="flex max-h-[min(760px,calc(100vh-96px))] flex-col p-1">
                <PromptOptimizationProfilesPanel
                  config={config}
                  configuredProviderIds={configuredProviderIds}
                  selectedProfileId={selectedProfileId}
                  onSelectedProfileIdChange={setSelectedProfileId}
                  onConfigChange={setConfig}
                />
                {streaming && output ? (
                  <div className={`mx-4 mb-4 rounded-lg border border-border-dark bg-app p-3 leading-5 ${UI_TEXT_META_CLASS}`}>
                    {output}
                  </div>
                ) : null}
              </div>
              )
        )}
      >
        {({ openPanel, closePanel }) => {
          closePanelRef.current = closePanel
          openPanelRef.current = openPanel
          return (
            <UiButton
              type="button"
              variant="muted"
              onClick={() => {
                if (streaming) return
                if (buttonBehavior !== 'select-profile') {
                  void runOptimize()
                  return
                }
                // 选择配置模式下先确认有可用模型，缺配置时直接引导，不打开一个选不出结果的面板
                void resolveReadiness().then((readiness) => {
                  if (!readiness) return
                  openSelectorPanel(openPanel)
                })
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                if (streaming) return
                openEditorPanel(openPanel)
              }}
              disabled={disabled}
              aria-disabled={disabled || streaming}
              title={buttonBehavior === 'select-profile' ? '左键先选择配置，右键管理配置' : '左键直接优化，右键管理配置'}
              className={`prompt-optimize-button h-9 px-4 ${streaming ? 'is-streaming' : ''}`}
              data-panel-trigger-button
            >
              <Sparkles size={16} className="prompt-optimize-button__icon mr-2" />
              <span className="prompt-optimize-button__label">{streaming ? '优化中' : '优化'}</span>
            </UiButton>
          )
        }}
      </PanelTrigger>
      {guidanceContent ? (
        <AlertDialog
          isOpen
          type="warning"
          title={guidanceContent.title}
          message={guidanceContent.message}
          closeLabel="取消"
          actions={[{ label: '去设置', variant: 'primary', onClick: applyGuidance }]}
          onClose={() => setGuidance(null)}
        />
      ) : null}
    </>
  )
}
