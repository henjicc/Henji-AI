import { ExternalLink, RefreshCw, RotateCcw, Save } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

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
import SettingsDialog from '../components/SettingsDialog'

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
  const [status, setStatus] = useState<StatusLine>(() => info(t('agentInstructions.reading')))
  const [confirmReset, setConfirmReset] = useState(false)
  const content = useMemo(() => toModelPromptText(document), [document])
  const warnings = useMemo(
    () => getAssistantUserInstructionsWarnings(content),
    [content]
  )

  const load = async (): Promise<void> => {
    setBusy(true)
    logger.info('读取智能助手用户指令开始', {
      event: 'settings.agent_user_instructions.read.start',
    })
    try {
      const instructions = await getAssistantUserInstructions()
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
    setBusy(true)
    try {
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
      <UiFormRow
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
          editorClassName={`min-h-56 max-h-96 px-3 py-2.5 ${UI_TEXT_BODY_CLASS}`}
        />
        <p className={`mt-3 leading-5 ${UI_TEXT_META_CLASS}`}>{t('agentInstructions.privacy')}</p>
      </UiFormRow>

      <div className="flex flex-wrap items-center gap-2">
        <UiButton type="button" variant="primary" disabled={busy} onClick={() => void save()}>
          <Save className="h-4 w-4" />
          {t('agentInstructions.save')}
        </UiButton>
        <UiButton type="button" variant="secondary" disabled={busy} onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" />
          {t('agentInstructions.reload')}
        </UiButton>
        <UiButton type="button" variant="secondary" disabled={busy} onClick={() => void openFile()}>
          <ExternalLink className="h-4 w-4" />
          {t('agentInstructions.openFile')}
        </UiButton>
        {/* 清空会丢掉已写的全部指令：危险档（静息静默、悬停显红），点后二次确认 */}
        <UiButton type="button" variant="danger" disabled={busy} onClick={() => setConfirmReset(true)}>
          <RotateCcw className="h-4 w-4" />
          {t('agentInstructions.clear')}
        </UiButton>
      </div>
      {/* 「打开指令文件」的状态行会带出本地绝对路径，它不是输入控件，必须显式声明为
          观察敏感区域，否则会被 Surface 截图原样带给模型。 */}
      {status.text ? (
        <p data-observation-sensitive className={`break-all leading-5 ${status.failed ? 'text-2xs font-medium text-danger-text' : UI_TEXT_META_CLASS}`}>{status.text}</p>
      ) : null}

      <SettingsDialog
        open={confirmReset}
        title={t('agentInstructions.clearTitle')}
        description={t('agentInstructions.clearDescription')}
        onClose={() => setConfirmReset(false)}
        actions={[
          { label: t('agentInstructions.cancel'), onClick: () => setConfirmReset(false), variant: 'secondary' },
          { label: t('agentInstructions.clearConfirm'), variant: 'danger', onClick: () => { setConfirmReset(false); void reset() } },
        ]}
      />
    </div>
  )
}
