import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Dropdown from '@/components/ui/Dropdown'
import { UI_TEXT_BODY_CLASS, UiButton, UiCheckbox, UiFormRow, UiGroup, UiInput, UiSpecialPanel } from '@/components/ui'
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
      let previewAudioFilePath = normalizeString(result.filePaths[0])
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

  // 特殊面板两栏（重要记录 021）：左边参考音频、提示音频与试听结果，右边各项设置；底部一行放状态与“开始克隆”
  const footerStatus = statusMessage?.type === 'error'
    ? <span className="text-danger-text">{statusMessage.text}</span>
    : hasResultPreview
      ? <span className="text-text2">克隆完成，已保存到音色库，可在“音色”里选择使用</span>
      : <span className="text-text3">克隆完成后在左边试听</span>

  return (
    <UiSpecialPanel
      status={footerStatus}
      action={(
        <UiButton type="button" variant="primary" size="sm" disabled={isSubmitting} onClick={() => void runClone()}>
          {isSubmitting ? '克隆中…' : hasResultPreview ? '重新克隆' : '开始克隆'}
        </UiButton>
      )}
    >
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
      <div className="flex gap-4">
        <div className="flex w-80 shrink-0 flex-col gap-3">
          <AudioPreviewCard
            title="参考音频"
            src={cloneAudioPreviewSrc}
            filePath={panelValue.cloneAudioFilePath || undefined}
            emptyText="上传后可在这里试听"
            size="compact"
            playerRightActions={cloneAudioPreviewSrc ? (
              <UiButton type="button" variant="link" onClick={() => cloneAudioInputRef.current?.click()}>重新上传</UiButton>
            ) : undefined}
            uploadButtonText={panelValue.cloneAudioFilePath || panelValue.cloneAudioFileName ? '重新上传音频' : '上传音频'}
            uploadHintText="支持拖放 mp3 / m4a / wav"
            onUploadClick={() => cloneAudioInputRef.current?.click()}
            onFileDrop={(file) => { void handleSelectAudioFile(file, 'clone') }}
          />
          <AudioPreviewCard
            title="提示音频（可选）"
            src={promptAudioPreviewSrc}
            filePath={panelValue.promptAudioFilePath || undefined}
            emptyText="上传示例音频并填写对应文本后启用"
            size="compact"
            playerRightActions={promptAudioPreviewSrc ? (
              <UiButton type="button" variant="link" onClick={() => promptAudioInputRef.current?.click()}>重新上传</UiButton>
            ) : undefined}
            uploadButtonText={panelValue.promptAudioFilePath || panelValue.promptAudioFileName ? '重新上传示例音频' : '上传示例音频'}
            uploadHintText="支持拖放 mp3 / m4a / wav"
            onUploadClick={() => promptAudioInputRef.current?.click()}
            onFileDrop={(file) => { void handleSelectAudioFile(file, 'prompt') }}
          />
          {hasResultPreview ? (
            <AudioPreviewCard
              title="试听结果"
              src={resultPreviewSrc}
              filePath={resultPreviewFilePath || undefined}
              emptyText=""
              size="compact"
            />
          ) : null}
        </div>
        <span className="w-px shrink-0 bg-line" aria-hidden />
        <UiGroup labelWidth={72} className="w-80 shrink-0">
          <UiFormRow label="音色名称" density="compact">
            <UiInput
              size="sm"
              value={panelValue.voiceName}
              onChange={(event) => patchValue({ voiceName: event.target.value })}
              placeholder="必填，保存到音色库用"
              maxLength={40}
            />
          </UiFormRow>
          <UiFormRow label="试听模型" density="compact">
            <Dropdown
              size="sm"
              value={panelValue.previewModel}
              display={panelValue.previewModel}
              options={previewModels}
              onSelect={(next) => patchValue({ previewModel: String(next) })}
              buttonClassName="w-full"
              panelWidthStrategy="options"
            />
          </UiFormRow>
          <UiFormRow label="试听文本" density="compact">
            <UiInput
              size="sm"
              value={panelValue.previewText}
              onChange={(event) => patchValue({ previewText: event.target.value })}
              placeholder="用于试听合成的文本"
            />
          </UiFormRow>
          <UiFormRow label="提示文本" density="compact" info="与提示音频说的内容一致；填写时需同时上传提示音频">
            <UiInput
              size="sm"
              value={panelValue.promptText}
              onChange={(event) => patchValue({ promptText: event.target.value })}
              placeholder="可选"
              maxLength={400}
            />
          </UiFormRow>
          <UiFormRow label="校验阈值" density="compact">
            <NumberInput
              size="sm"
              value={panelValue.accuracy}
              onChange={(next) => patchValue({
                accuracy: Math.max(0, Math.min(1, normalizeNumber(next, panelValue.accuracy))),
              })}
              min={0}
              max={1}
              step={0.01}
              precision={2}
            />
          </UiFormRow>
          <div className={`flex items-center gap-4 pt-1 ${UI_TEXT_BODY_CLASS}`}>
            <label className="inline-flex items-center gap-2">
              <UiCheckbox checked={panelValue.needNoiseReduction} onCheckedChange={next => patchValue({ needNoiseReduction: next })} />
              降噪
            </label>
            <label className="inline-flex items-center gap-2">
              <UiCheckbox checked={panelValue.needVolumeNormalization} onCheckedChange={next => patchValue({ needVolumeNormalization: next })} />
              音量归一化
            </label>
          </div>
        </UiGroup>
      </div>
    </UiSpecialPanel>
  )
}

export default MinimaxVoiceClonePanel
