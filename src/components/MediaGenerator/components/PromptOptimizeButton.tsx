import { createLogger } from '@/core/logging'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import PanelTrigger from '@/components/ui/PanelTrigger'
import { UiButton } from '@/components/ui'
import { LLM_CONFIG_CHANGED_EVENT } from '@/core/llm/events'
import {
  buildPromptOptimizationUserMessage,
  getDefaultPromptProfile,
  renderPromptOptimizationTemplate,
  type PromptOptimizationTargetModel,
} from '@/core/llm/promptOptimization'
import type { LlmConfigState, LlmChatMessage, LlmMessageContentPart } from '@/core/llm/types'
import { llmCancelTask, llmChatStream } from '@/commands/llmRuntime'
import { llmConfigService } from '@/services/llm'
import { PromptOptimizationProfilesPanel } from './PromptOptimizationProfilesPanel'

const logger = createLogger('components.MediaGenerator.PromptOptimizeButton')

function createPromptOptimizationRequestId(): string {
  return `prompt-optimizer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

interface PromptOptimizeButtonProps {
  prompt: string
  uploadedImages: string[]
  uploadedVideos: string[]
  uploadedVideoFiles: File[]
  targetModel?: PromptOptimizationTargetModel
  disabled?: boolean
  onOptimized: (prompt: string) => void
  onStreamPreviewChange?: (preview: { active: boolean; reasoning: string; content: string }) => void
  onAlert: (title: string, message: string, type?: 'info' | 'warning' | 'error') => void
}

export const PromptOptimizeButton: React.FC<PromptOptimizeButtonProps> = ({
  prompt,
  uploadedImages,
  uploadedVideos,
  uploadedVideoFiles,
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
  const activeRequestIdRef = useRef<string | null>(null)
  const cancelledRequestIdRef = useRef<string | null>(null)

  const selectedProfile = useMemo(() => {
    if (!config) return null
    return config.promptProfiles.find(profile => profile.id === selectedProfileId)
      ?? (config.selectedPromptProfileId
        ? config.promptProfiles.find(profile => profile.id === config.selectedPromptProfileId)
        : null)
      ?? getDefaultPromptProfile(config)
  }, [config, selectedProfileId])

  const selectedProvider = useMemo(() => {
    if (!config || !selectedProfile) return null
    return config.providers.find(provider => provider.providerId === selectedProfile.providerId) ?? null
  }, [config, selectedProfile])

  const loadConfig = async (): Promise<void> => {
    try {
      const nextConfig = await llmConfigService.getConfig()
      setConfig(nextConfig)
      setSelectedProfileId(previousSelectedProfileId => {
        if (nextConfig.promptProfiles.some(profile => profile.id === previousSelectedProfileId)) {
          return previousSelectedProfileId
        }
        if (
          nextConfig.selectedPromptProfileId
          && nextConfig.promptProfiles.some(profile => profile.id === nextConfig.selectedPromptProfileId)
        ) {
          return nextConfig.selectedPromptProfileId
        }
        const profile = getDefaultPromptProfile(nextConfig)
        return profile?.id ?? ''
      })
    } catch (error) {
      logger.error('[PromptOptimizeButton] load config failed', error)
    }
  }

  useEffect(() => {
    void loadConfig()
  }, [])

  useEffect(() => {
    const reload = (): void => {
      void loadConfig()
    }
    window.addEventListener(LLM_CONFIG_CHANGED_EVENT, reload)
    return () => window.removeEventListener(LLM_CONFIG_CHANGED_EVENT, reload)
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
      logger.error('[PromptOptimizeButton] cancel optimization failed', error)
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

  const fileToDataUrl = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
      reader.onerror = () => reject(reader.error ?? new Error('读取视频失败'))
      reader.readAsDataURL(file)
    })
  }, [])

  const buildUserMessage = useCallback(async (
    currentPrompt: string
  ): Promise<LlmChatMessage> => {
    const profile = selectedProfile ?? (config ? getDefaultPromptProfile(config) : null)
    const templateContext = {
      prompt: currentPrompt,
      imageCount: uploadedImages.length,
      videoCount: uploadedVideos.length,
      targetModel,
    }
    const baseText = buildPromptOptimizationUserMessage(profile!, templateContext)
    const shouldAttachImages = profile?.capabilities.image === true && uploadedImages.length > 0
    const shouldAttachVideos = profile?.capabilities.video === true && uploadedVideoFiles.length > 0

    if (!shouldAttachImages && !shouldAttachVideos) {
      return {
        role: 'user',
        content: baseText,
      }
    }

    const content: LlmMessageContentPart[] = [
      { type: 'text', text: baseText },
    ]

    if (shouldAttachImages) {
      uploadedImages.forEach((url) => {
        if (!url.trim()) return
        content.push({
          type: 'image_url',
          imageUrl: { url },
        })
      })
    }

    if (shouldAttachVideos) {
      const videoUrls = await Promise.all(
        uploadedVideoFiles.map(async (file) => fileToDataUrl(file))
      )
      videoUrls.forEach((url) => {
        if (!url.trim()) return
        content.push({
          type: 'video_url',
          videoUrl: { url },
        })
      })
    }

    return {
      role: 'user',
      content,
    }
  }, [config, fileToDataUrl, selectedProfile, targetModel, uploadedImages, uploadedVideoFiles, uploadedVideos.length])

  const runOptimize = async (): Promise<void> => {
    const currentPrompt = prompt.trim()
    if (!currentPrompt) {
      onAlert('缺少提示词', '请输入提示词后再优化。', 'warning')
      return
    }
    const profile = selectedProfile ?? (config ? getDefaultPromptProfile(config) : null)
    if (!profile) {
      onAlert('未配置优化器', '请右键优化按钮创建提示词优化配置。', 'warning')
      return
    }

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
      const userMessage = await buildUserMessage(currentPrompt)
      await llmChatStream({
        requestId,
        providerId: profile.providerId,
        modelId: profile.modelId,
        adapter: selectedProvider?.adapter ?? profile.providerId,
        baseUrl: selectedProvider?.baseUrl,
        reasoning: selectedProvider?.reasoning,
        messages: [
          { role: 'system', content: renderPromptOptimizationTemplate(profile.systemPrompt, templateContext) },
          userMessage,
        ],
        capabilities: {
          text: true,
          image: profile.capabilities.image,
          video: profile.capabilities.video,
          streaming: true,
        },
        metadata: {
          source: 'prompt-optimizer',
          imageCount: uploadedImages.length,
          videoCount: uploadedVideos.length,
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
          onStreamPreviewChange?.({ active: true, reasoning: nextOutput ? '' : nextReasoning, content: nextOutput })
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
    } catch (error) {
      if (cancelledRequestIdRef.current === requestId) {
        cancelledRequestIdRef.current = null
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      onAlert('提示词优化失败', message, 'error')
      finishStreaming()
    }
  }

  return (
    <PanelTrigger
      display={streaming ? '优化中' : '优化'}
      disabled={disabled || streaming}
      className="w-auto"
      panelWidth={820}
      alignment="aboveCenter"
      stableHeight
      closeOnPanelClick={false}
      renderPanel={() => (
        <div className="flex max-h-[min(760px,calc(100vh-96px))] flex-col p-1">
          <PromptOptimizationProfilesPanel
            config={config}
            selectedProfileId={selectedProfileId}
            onSelectedProfileIdChange={setSelectedProfileId}
            onConfigChange={setConfig}
          />
          {streaming && output ? (
            <div className="mx-4 mb-4 max-h-28 overflow-y-auto rounded-lg border border-border-dark bg-app p-3 text-xs leading-5 text-text-muted">
              {output}
            </div>
          ) : null}
        </div>
      )}
    >
      {({ openPanel }) => (
        <UiButton
          type="button"
          variant="muted"
          onClick={() => {
            if (streaming) return
            void runOptimize()
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (streaming) return
            void loadConfig()
            openPanel()
          }}
          disabled={disabled}
          aria-disabled={disabled || streaming}
          title="左键优化，右键管理配置"
          className={`prompt-optimize-button h-9 px-4 ${streaming ? 'is-streaming' : ''}`}
          data-panel-trigger-button
        >
          <Sparkles size={16} className="prompt-optimize-button__icon mr-2" />
          <span className="prompt-optimize-button__label">{streaming ? '优化中' : '优化'}</span>
        </UiButton>
      )}
    </PanelTrigger>
  )
}
