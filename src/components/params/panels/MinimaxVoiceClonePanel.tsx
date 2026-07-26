import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Dropdown from '@/components/ui/Dropdown'
import Toggle from '@/components/ui/Toggle'
import { UiButton, UiInput } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { showAlertDialog } from '@/stores/alertDialogStore'
import { createLogger } from '@/core/logging'
import { GenerationService } from '@/core/services/GenerationService'
import type { MinimaxVoiceClonePanelConfig } from '@/core/types/PanelTypes'
import { deleteUploads, saveAudioFromUrl, saveUploadAudio } from '@/utils/save'
import { voiceLibraryService } from '@/services/voiceLibrary/VoiceLibraryService'
import { AudioPreviewCard } from './minimaxVoiceClone/AudioPreviewCard'
import {
  AUDIO_ACCEPT,
  DEFAULT_VALUE,
  DEFAULT_PREVIEW_MODELS,
  type MinimaxVoiceClonePanelValue,
  type StatusMessage,
} from './minimaxVoiceClone/types'
import {
  extractPreviewAudioUrl,
  extractVoiceId,
  normalizeNumber,
  normalizeString,
  normalizeValue,
  parseAudioError,
} from './minimaxVoiceClone/utils'
import { useAudioPreviewSource } from './minimaxVoiceClone/useAudioPreviewSource'

const logger = createLogger('components.params.panels.MinimaxVoiceClonePanel')
let hasResetClonePanelOnSessionStart = false

interface MinimaxVoiceClonePanelProps {
  value: DynamicValue
  onChange: (value: DynamicValueMap) => void
  config?: MinimaxVoiceClonePanelConfig
}

export const MinimaxVoiceClonePanel: React.FC<MinimaxVoiceClonePanelProps> = ({
  value,
  onChange,
  config,
}) => {
  const panelValue = useMemo(() => normalizeValue(value), [value])
  const previewModels = useMemo(
    () => (Array.isArray(config?.previewModels) && config.previewModels.length > 0
      ? config.previewModels
      : DEFAULT_PREVIEW_MODELS),
    [config?.previewModels]
  )
  const providerId = normalizeString(config?.providerId) || 'ppio'
  const modelId = normalizeString(config?.modelId) || 'ppio-minimax-speech'

  const cloneAudioInputRef = useRef<HTMLInputElement | null>(null)
  const promptAudioInputRef = useRef<HTMLInputElement | null>(null)
  const [cloneAudioFile, setCloneAudioFile] = useState<File | null>(null)
  const [promptAudioFile, setPromptAudioFile] = useState<File | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null)
  const panelValueRef = useRef(panelValue)
  const previousResultAudioFilePathRef = useRef(panelValue.lastPreviewAudioFilePath)
  const isPersistingResultAudioRef = useRef(false)

  const cloneAudioPreviewSrc = useAudioPreviewSource(cloneAudioFile, panelValue.cloneAudioFilePath)
  const promptAudioPreviewSrc = useAudioPreviewSource(promptAudioFile, panelValue.promptAudioFilePath)
  const resultPreviewFilePath = normalizeString(panelValue.lastPreviewAudioFilePath)
  const resultPreviewSrc = useAudioPreviewSource(null, resultPreviewFilePath || panelValue.lastPreviewAudioUrl)
  const hasCloneAudio = Boolean(cloneAudioFile || panelValue.cloneAudioFilePath)
  const hasPromptAudio = Boolean(promptAudioFile || panelValue.promptAudioFilePath)
  const hasPreviewText = panelValue.previewText.trim().length > 0
  const hasPromptText = panelValue.promptText.trim().length > 0
  const promptPairValid = hasPromptAudio === hasPromptText
  const hasResultPreview = resultPreviewSrc.length > 0

  const patchValue = useCallback((patch: Partial<MinimaxVoiceClonePanelValue>): void => {
    onChange({ ...panelValueRef.current, ...patch })
  }, [onChange])

  useEffect(() => {
    if (hasResetClonePanelOnSessionStart) {
      return
    }
    hasResetClonePanelOnSessionStart = true
    const shouldReset = Object.entries(DEFAULT_VALUE).some(([key, defaultValue]) => {
      const currentValue = panelValue[key as keyof MinimaxVoiceClonePanelValue]
      return currentValue !== defaultValue
    })
    if (shouldReset) {
      patchValue(DEFAULT_VALUE)
    }
  }, [panelValue, patchValue])

  useEffect(() => {
    panelValueRef.current = panelValue
  }, [panelValue])

  useEffect(() => {
    const previousPath = previousResultAudioFilePathRef.current
    const currentPath = panelValue.lastPreviewAudioFilePath
    if (previousPath && previousPath !== currentPath) {
      void deleteUploads([previousPath])
    }
    previousResultAudioFilePathRef.current = currentPath
  }, [panelValue.lastPreviewAudioFilePath])

  useEffect(() => {
    const previewUrl = normalizeString(panelValue.lastPreviewAudioUrl)
    const previewFilePath = normalizeString(panelValue.lastPreviewAudioFilePath)
    if (!previewUrl || previewFilePath || isPersistingResultAudioRef.current) {
      return
    }
    isPersistingResultAudioRef.current = true
    let cancelled = false
    ;(async () => {
      try {
        const saved = await saveAudioFromUrl(previewUrl)
        if (!cancelled) {
          patchValue({ lastPreviewAudioFilePath: saved.fullPath })
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error)
          logger.warn('[MinimaxVoiceClonePanel] 试听结果补落盘失败，继续使用远程地址', message)
        }
      } finally {
        isPersistingResultAudioRef.current = false
      }
    })()
    return () => {
      cancelled = true
    }
  }, [panelValue.lastPreviewAudioUrl, panelValue.lastPreviewAudioFilePath, patchValue])

  const showWarningDialog = (message: string): void => {
    showAlertDialog({
      title: '参数未完成',
      message,
      type: 'warning',
    })
  }

  const getValidationErrors = (): string[] => {
    const errors: string[] = []
    if (!panelValue.voiceName.trim()) {
      errors.push('请先填写音色名称。')
    }
    if (!hasCloneAudio) {
      errors.push('请先上传复刻音频文件。')
    }
    if (!hasPreviewText) {
      errors.push('请先填写试听文本。')
    }
    if (!promptPairValid) {
      if (hasPromptAudio) {
        errors.push('已上传 Prompt 音频，请补充对应文本。')
      } else {
        errors.push('已填写 Prompt 文本，请上传对应示例音频。')
      }
    }
    return errors
  }

  const formatValidationMessage = (errors: string[]): string => {
    if (errors.length <= 1) {
      return errors[0] || '请先完善必填项。'
    }
    return `请先完成以下内容：\n${errors.map((item, index) => `${index + 1}. ${item}`).join('\n')}`
  }

  const checkVoiceNameDuplicated = async (voiceName: string): Promise<'ok' | 'duplicated' | 'error'> => {
    try {
      const voices = await voiceLibraryService.listVoices({ providerId, modelId })
      const normalized = voiceName.toLocaleLowerCase()
      const duplicated = voices.some((item) => item.voiceName.trim().toLocaleLowerCase() === normalized)
      return duplicated ? 'duplicated' : 'ok'
    } catch (error) {
      logger.error('[MinimaxVoiceClonePanel] 音色名称重名校验失败', error)
      const message = error instanceof Error ? error.message : String(error)
      showAlertDialog({
        title: '校验失败',
        message: message || '检查音色名称是否重复失败，请稍后重试。',
        type: 'error',
        detail: message,
      })
      return 'error'
    }
  }

  const handleSelectAudioFile = async (
    file: File,
    target: 'clone' | 'prompt'
  ): Promise<void> => {
    const fileError = parseAudioError(file)
    if (fileError) {
      setStatusMessage({ type: 'error', text: fileError })
      return
    }
    if (target === 'clone') {
      setCloneAudioFile(file)
      patchValue({ cloneAudioFileName: file.name, cloneAudioFilePath: '' })
    } else {
      setPromptAudioFile(file)
      patchValue({ promptAudioFileName: file.name, promptAudioFilePath: '' })
    }
    try {
      const saved = await saveUploadAudio(file, 'persist')
      if (target === 'clone') {
        patchValue({ cloneAudioFileName: file.name, cloneAudioFilePath: saved.fullPath })
        setCloneAudioFile(null)
      } else {
        patchValue({ promptAudioFileName: file.name, promptAudioFilePath: saved.fullPath })
        setPromptAudioFile(null)
      }
      setStatusMessage(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatusMessage({ type: 'error', text: message || '音频保存失败，请重试' })
    }
  }

  const runClone = async (): Promise<void> => {
    setStatusMessage(null)
    const validationErrors = getValidationErrors()
    if (validationErrors.length > 0) {
      showWarningDialog(formatValidationMessage(validationErrors))
      return
    }
    const voiceName = panelValue.voiceName.trim()
    const duplicateState = await checkVoiceNameDuplicated(voiceName)
    if (duplicateState === 'error') {
      return
    }
    if (duplicateState === 'duplicated') {
      showAlertDialog({
        title: '音色名称重复',
        message: `音色名称“${voiceName}”已存在，请更换后再克隆。`,
        type: 'warning',
      })
      return
    }
    const previewText = panelValue.previewText.trim()

    try {
      setIsSubmitting(true)

      let cloneAudioFilePath = panelValue.cloneAudioFilePath
      let cloneAudioFileName = panelValue.cloneAudioFileName
      if (cloneAudioFile) {
        const saved = await saveUploadAudio(cloneAudioFile, 'persist')
        cloneAudioFilePath = saved.fullPath
        cloneAudioFileName = cloneAudioFile.name
      }
      if (!cloneAudioFilePath) {
        setStatusMessage({ type: 'error', text: '请先上传复刻音频文件' })
        return
      }

      let promptAudioFilePath = panelValue.promptAudioFilePath
      let promptAudioFileName = panelValue.promptAudioFileName
      if (hasPromptAudio && promptAudioFile) {
        const saved = await saveUploadAudio(promptAudioFile, 'persist')
        promptAudioFilePath = saved.fullPath
        promptAudioFileName = promptAudioFile.name
      }

      if (!hasPromptAudio) {
        promptAudioFilePath = ''
        promptAudioFileName = ''
      }

      const submitPayload: MinimaxVoiceClonePanelValue = {
        ...panelValue,
        voiceName,
        promptEnabled: hasPromptAudio && hasPromptText,
        cloneAudioFilePath,
        cloneAudioFileName,
        promptAudioFilePath,
        promptAudioFileName,
      }
      patchValue(submitPayload)

      const generationService = GenerationService.getInstance()
      const runtimeParams: DynamicValueMap = {
        minimaxCloneOperation: 'clone',
        text: previewText,
        prompt: previewText,
        minimaxVoiceClonePanel: submitPayload,
        minimaxCloneAudioFilePath: cloneAudioFilePath,
      }
      if (promptAudioFilePath) {
        runtimeParams.minimaxClonePromptAudioFilePath = promptAudioFilePath
      }

      let result = await generationService.generate(modelId, runtimeParams)
      if (result.status === 'pending' && result.taskId) {
        result = await generationService.continuePolling(modelId, result.taskId, runtimeParams)
      }

      const voiceId = extractVoiceId(result.metadata)
      if (!voiceId) {
        throw new Error('克隆完成但未返回可用音色，请稍后重试')
      }
      const previewAudioUrl = extractPreviewAudioUrl(result)
      let previewAudioFilePath = normalizeString(result.filePath)
      if (!previewAudioFilePath && previewAudioUrl) {
        try {
          const savedPreviewAudio = await saveAudioFromUrl(previewAudioUrl)
          previewAudioFilePath = savedPreviewAudio.fullPath
        } catch (previewSaveError) {
          logger.warn('[MinimaxVoiceClonePanel] 试听音频落地失败，回退远程链接播放', previewSaveError)
        }
      }
      await voiceLibraryService.upsertVoice({
        voiceId,
        voiceName,
        description: submitPayload.promptText || undefined,
        providerId,
        modelId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })

      patchValue({
        ...submitPayload,
        lastPreviewAudioUrl: previewAudioUrl,
        lastPreviewAudioFilePath: previewAudioFilePath,
      })
      setStatusMessage(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('[MinimaxVoiceClonePanel] 克隆失败', error)
      setStatusMessage({ type: 'error', text: message || '音色克隆失败，请稍后重试' })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="relative flex h-[820px] max-h-[96vh] min-h-[660px] w-full min-w-[760px] max-w-[960px] flex-col overflow-hidden rounded-[inherit]">
      <div className="flex h-full w-full flex-col p-4">
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          <div className="space-y-3 pb-2">
          <div className="grid grid-cols-[minmax(280px,1.45fr)_auto_auto_auto_minmax(240px,1fr)] items-end gap-3">
            <div className="min-w-0 space-y-2">
              <label className="block text-xs text-text-muted">音色名称</label>
              <UiInput
                value={panelValue.voiceName}
                onChange={(event) => patchValue({ voiceName: event.target.value })}
                placeholder="必填，用于保存到音色库"
                maxLength={40}
                className="h-[38px]"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-xs text-text-muted">降噪</label>
              <Toggle
                checked={panelValue.needNoiseReduction}
                onChange={(next) => patchValue({ needNoiseReduction: next })}
                onText="开启"
                offText="关闭"
                className="w-auto"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-xs text-text-muted">音量归一化</label>
              <Toggle
                checked={panelValue.needVolumeNormalization}
                onChange={(next) => patchValue({ needVolumeNormalization: next })}
                onText="开启"
                offText="关闭"
                className="w-auto"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-xs text-text-muted">校验阈值</label>
              <NumberInput
                value={panelValue.accuracy}
                onChange={(next) => patchValue({
                  accuracy: Math.max(0, Math.min(1, normalizeNumber(next, panelValue.accuracy))),
                })}
                min={0}
                max={1}
                step={0.01}
                precision={2}
                widthClassName="w-[92px]"
              />
            </div>
            <div className="min-w-0 space-y-2">
              <label className="block text-xs text-text-muted">试听模型</label>
              <Dropdown
                value={panelValue.previewModel}
                display={panelValue.previewModel}
                options={previewModels}
                onSelect={(next) => patchValue({ previewModel: String(next) })}
                buttonClassName="w-full"
                panelWidthStrategy="options"
              />
            </div>
          </div>

          <UiInput
            ref={cloneAudioInputRef}
            type="file"
            accept={AUDIO_ACCEPT}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void handleSelectAudioFile(file, 'clone')
            }}
          />
          <AudioPreviewCard
            title="复刻音频预览"
            src={cloneAudioPreviewSrc}
            filePath={panelValue.cloneAudioFilePath || undefined}
            emptyText="上传后可在此预览复刻音频"
            size="compact"
            playerRightActions={cloneAudioPreviewSrc ? (
              <UiButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => cloneAudioInputRef.current?.click()}
                className="!h-7 !px-1.5 border-0 bg-transparent text-accent hover:bg-transparent hover:underline"
                title="重新上传音频"
              >
                重新上传音频
              </UiButton>
            ) : undefined}
            uploadButtonText={panelValue.cloneAudioFilePath || panelValue.cloneAudioFileName ? '重新上传音频' : '上传音频'}
            uploadHintText="支持拖放 mp3 / m4a / wav"
            onUploadClick={() => cloneAudioInputRef.current?.click()}
            onFileDrop={(file) => { void handleSelectAudioFile(file, 'clone') }}
          />

          <div className="space-y-2">
            <label className="text-xs text-text-muted">试听文本</label>
            <UiInput
              value={panelValue.previewText}
              onChange={(event) => patchValue({ previewText: event.target.value })}
              placeholder="输入用于试听合成的文本"
              className="h-[38px] w-full"
            />
          </div>

          <UiInput
            ref={promptAudioInputRef}
            type="file"
            accept={AUDIO_ACCEPT}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void handleSelectAudioFile(file, 'prompt')
            }}
          />
          <AudioPreviewCard
            title="使用音频 Prompt（可选）"
            src={promptAudioPreviewSrc}
            filePath={panelValue.promptAudioFilePath || undefined}
            emptyText="上传示例音频后可启用音频 Prompt（需与下方文本同时填写）"
            size="compact"
            playerRightActions={promptAudioPreviewSrc ? (
              <UiButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => promptAudioInputRef.current?.click()}
                className="!h-7 !px-1.5 border-0 bg-transparent text-accent hover:bg-transparent hover:underline"
                title="重新上传示例音频"
              >
                重新上传示例音频
              </UiButton>
            ) : undefined}
            uploadButtonText={panelValue.promptAudioFilePath || panelValue.promptAudioFileName ? '重新上传示例音频' : '上传示例音频'}
            uploadHintText="支持拖放 mp3 / m4a / wav"
            onUploadClick={() => promptAudioInputRef.current?.click()}
            onFileDrop={(file) => { void handleSelectAudioFile(file, 'prompt') }}
          />
            <div className="w-full space-y-2">
              <label className="text-xs text-text-muted">Prompt 对应文本（与示例音频一致）</label>
              <UiInput
                value={panelValue.promptText}
                onChange={(event) => patchValue({ promptText: event.target.value })}
                placeholder="可选；填写时需同时上传示例音频"
                maxLength={400}
                className="h-[38px] w-full"
              />
            </div>
          </div>
        </div>

        <div className="mt-3 shrink-0 border-t border-border-dark pt-3">
          <AudioPreviewCard
            title="试听结果预览"
            subtitle={hasResultPreview ? '克隆完成，已保存到音色库，可在“音色 ID”中选择使用' : undefined}
            src={resultPreviewSrc}
            filePath={resultPreviewFilePath || undefined}
            emptyText="克隆完成后会在这里显示试听音频"
            size="compact"
            playerRightActions={hasResultPreview ? (
              <UiButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => { void runClone() }}
                disabled={isSubmitting}
                className="!h-7 !px-1.5 border-0 bg-transparent text-accent hover:bg-transparent hover:underline disabled:opacity-40"
                title="重新克隆"
              >
                重新克隆
              </UiButton>
            ) : undefined}
            contentAction={hasResultPreview ? undefined : (
              <UiButton type="button" variant="primary" disabled={isSubmitting} onClick={() => void runClone()}>
                {isSubmitting ? '克隆中...' : '开始克隆'}
              </UiButton>
            )}
          />

          {statusMessage?.type === 'error' && (
            <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {statusMessage.text}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}

export default MinimaxVoiceClonePanel
