import { ExternalLink, RefreshCw, RotateCcw, Save } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  getAssistantUserInstructions,
  openAssistantUserInstructionsFile,
  resetAssistantUserInstructions,
  updateAssistantUserInstructions,
} from '@/commands/assistant'
import {
  PromptEditor,
  UI_FORM_ROW_GAP_CLASS,
  UI_TEXT_BODY_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiFormRow,
  UiError,
  UiLoading,
} from '@/components/ui'
import {
  ASSISTANT_USER_INSTRUCTIONS_MAX_CHARACTERS,
  getAssistantUserInstructionsWarnings,
} from '@/core/assistant/userInstructions'
import {
  createPlainTextPromptDocument,
  toModelPromptText,
  type PromptDocumentV1,
} from '@/core/inputs/promptDocument'
import { createLogger } from '@/core/logging'
import { useI18n } from '@/hooks/useI18n'

const logger = createLogger('components.Settings.AgentUserInstructionsSection')

/** 状态行：失败用危险文字色，与进行中、已完成的提示区分开（5.6 第二批）。 */
interface StatusLine { text: string; failed: boolean }
const info = (text: string): StatusLine => ({ text, failed: false })
const failure = (text: string): StatusLine => ({ text, failed: true })

export default function AgentUserInstructionsSection(): JSX.Element {
  const { t } = useI18n('settings')
  const [document, setDocument] = useState<PromptDocumentV1>(
    createPlainTextPromptDocument('')
  )
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const retry = useRef<() => Promise<void>>(async () => {})
  const [status, setStatus] = useState<StatusLine>(() => info(t('agentInstructions.reading')))
  const content = useMemo(() => toModelPromptText(document), [document])
  const warnings = useMemo(
    () => getAssistantUserInstructionsWarnings(content),
    [content]
  )

  const load = async (): Promise<void> => {
    retry.current = load
    setStatus(info(''))
    setBusy(true)
    logger.info('读取智能助手用户指令开始', {
      event: 'settings.agent_user_instructions.read.start',
    })
    try {
      const instructions = await getAssistantUserInstructions()
      setLoaded(true)
      setDocument(createPlainTextPromptDocument(instructions.content))
      // 加载完成不再常驻一句实现说明（原文写着“从主进程重新读取”），状态行留空
      setStatus(info(''))
      logger.info('读取智能助手用户指令完成', {
        event: 'settings.agent_user_instructions.read.completed',
      })
    } catch (error) {
      setStatus(failure(error instanceof Error ? error.message : t('agentInstructions.readFailed')))
      logger.error('读取智能助手用户指令失败', error, {
        event: 'settings.agent_user_instructions.read.failed',
      })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load()
    // 只在打开分节时读取一次；切换界面语言不应重新读取并覆盖正在编辑的指令
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = async (): Promise<void> => {
    retry.current = save
    setStatus(info(''))
    setBusy(true)
    setStatus(info(t('agentInstructions.saving')))
    logger.info('保存智能助手用户指令开始', {
      event: 'settings.agent_user_instructions.save.start',
    })
    try {
      const instructions = await updateAssistantUserInstructions({ content })
      setDocument(createPlainTextPromptDocument(instructions.content))
      setStatus(info(t('agentInstructions.saved')))
      logger.info('保存智能助手用户指令完成', {
        event: 'settings.agent_user_instructions.save.completed',
      })
    } catch (error) {
      setStatus(failure(error instanceof Error ? error.message : t('agentInstructions.saveFailed')))
      logger.error('保存智能助手用户指令失败', error, {
        event: 'settings.agent_user_instructions.save.failed',
      })
    } finally {
      setBusy(false)
    }
  }

  const reset = async (): Promise<void> => {
    retry.current = reset
    setStatus(info(''))
    setBusy(true)
    try {
      // 编辑中的文字也先交给同一个文件回收链路，清空不会丢掉尚未点保存的内容。
      if (content) await updateAssistantUserInstructions({ content })
      const instructions = await resetAssistantUserInstructions()
      setDocument(createPlainTextPromptDocument(instructions.content))
      setStatus(info(t('agentInstructions.cleared')))
    } catch (error) {
      setStatus(failure(error instanceof Error ? error.message : t('agentInstructions.clearFailed')))
    } finally {
      setBusy(false)
    }
  }

  const openFile = async (): Promise<void> => {
    retry.current = openFile
    setStatus(info(''))
    try {
      const filePath = await openAssistantUserInstructionsFile()
      setStatus(info(t('agentInstructions.fileOpened', { path: filePath })))
    } catch (error) {
      setStatus(failure(error instanceof Error ? error.message : t('agentInstructions.openFileFailed')))
    }
  }

  return (
    <div className={UI_FORM_ROW_GAP_CLASS}>
      {/*
        分节标题已经由 SettingsSection 渲染成「助手用户指令」，这里不再重复一个「用户指令」标题。
        剩下的两段文字：第一段是写之前必须知道的优先级规则（常驻），
        第二段是"这里会保存什么、不会保存什么"的隐私边界（也常驻——不看可能误填密钥）。
      */}
      {status.failed && <UiError size="sm" align="start" title={t('agentInstructions.failedTitle')} message={status.text} onRetry={() => void retry.current()} retryLabel={t('agentInstructions.retry')} />}
      {!loaded ? (!status.failed && <UiLoading size="sm" message={t('agentInstructions.reading')} />) : <UiFormRow
        label={t('agentInstructions.label')}
        hint={t('agentInstructions.hint')}
      >
        <PromptEditor
          mode="edit"
          preset="plain"
          layout="fill-scroll"
          value={document}
          onChange={setDocument}
          ariaLabel={t('agentInstructions.editorLabel')}
          placeholder={t('agentInstructions.placeholder')}
          disabled={busy}
          maxCharacters={ASSISTANT_USER_INSTRUCTIONS_MAX_CHARACTERS}
          showCharacterCount
          error={warnings.length > 0}
          errorMessage={warnings.join(t('agentInstructions.warningSeparator'))}
          height="tall" className="max-h-96" editorClassName={` px-3 py-3 ${UI_TEXT_BODY_CLASS}`}
        />
        <p className={`mt-3 leading-5 ${UI_TEXT_META_CLASS}`}>{t('agentInstructions.privacy')}</p>
      </UiFormRow>}

      <div className="flex flex-wrap items-center gap-2">
        <UiButton type="button" variant="primary" disabled={busy || !loaded} onClick={() => void save()}>
          <Save  />
          {t('agentInstructions.save')}
        </UiButton>
        <UiButton type="button" variant="secondary" disabled={busy} onClick={() => void load()}>
          <RefreshCw  />
          {t('agentInstructions.reload')}
        </UiButton>
        <UiButton type="button" variant="secondary" disabled={busy} onClick={() => void openFile()}>
          <ExternalLink  />
          {t('agentInstructions.openFile')}
        </UiButton>
        <UiButton type="button" variant="danger" disabled={busy || !loaded} onClick={() => void reset()}>
          <RotateCcw  />
          {t('agentInstructions.clear')}
        </UiButton>
      </div>
    </div>
  )
}
