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

const logger = createLogger('components.Settings.AgentUserInstructionsSection')

export default function AgentUserInstructionsSection(): JSX.Element {
  const [document, setDocument] = useState<PromptDocumentV1>(
    createPlainTextPromptDocument('')
  )
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('正在读取用户指令…')
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
      setStatus('用户指令已加载；每次新任务都会从主进程重新读取。')
      logger.info('读取智能助手用户指令完成', {
        event: 'settings.agent_user_instructions.read.completed',
      })
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '读取用户指令失败')
      logger.error('读取智能助手用户指令失败', error, {
        event: 'settings.agent_user_instructions.read.failed',
      })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const save = async (): Promise<void> => {
    setBusy(true)
    setStatus('正在保存…')
    logger.info('保存智能助手用户指令开始', {
      event: 'settings.agent_user_instructions.save.start',
    })
    try {
      const instructions = await updateAssistantUserInstructions({ content })
      setDocument(createPlainTextPromptDocument(instructions.content))
      setStatus('已保存。新指令会从下一次助手任务开始生效。')
      logger.info('保存智能助手用户指令完成', {
        event: 'settings.agent_user_instructions.save.completed',
      })
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存用户指令失败')
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
      setStatus('已清空用户指令。')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '清空用户指令失败')
    } finally {
      setBusy(false)
    }
  }

  const openFile = async (): Promise<void> => {
    try {
      const filePath = await openAssistantUserInstructionsFile()
      setStatus(`已打开用户指令文件：${filePath}。编辑保存后请点击“重新读取”。`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '打开用户指令文件失败')
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
        label="用户指令"
        hint="直接用自然语言描述长期偏好和工作习惯。除安全、权限、审批、真实能力和当前明确要求等硬约束外，用户指令优先于产品默认与模型描述。"
      >
        <PromptEditor
          mode="edit"
          preset="plain"
          layout="fill-scroll"
          value={document}
          onChange={setDocument}
          ariaLabel="智能助手用户指令"
          placeholder={'例如：\n图片生成优先使用派欧云；兼容时优先质量。\n回答尽量简洁，修改代码后先完成自动化检查。'}
          disabled={busy}
          maxCharacters={ASSISTANT_USER_INSTRUCTIONS_MAX_CHARACTERS}
          showCharacterCount
          error={warnings.length > 0}
          errorMessage={warnings.join('；')}
          editorShellClassName="bg-surface-dark"
          editorClassName={`ui-scrollbar min-h-[220px] max-h-[360px] px-3 py-2.5 ${UI_TEXT_BODY_CLASS}`}
        />
        <p className={`mt-3 leading-5 ${UI_TEXT_META_CLASS}`}>
          这里只保存你主动填写或明确要求助手修改的内容。密钥、令牌、授权头和密码会在进入模型前自动脱敏；其他正常内容会完整传递。助手不会自动把对话、推断、日志或文件写入这里。
        </p>
      </UiFormRow>

      <div className="flex flex-wrap items-center gap-2">
        <UiButton type="button" size="sm" variant="primary" disabled={busy} onClick={() => void save()}>
          <Save size={14} className="mr-1.5" />
          保存指令
        </UiButton>
        <UiButton type="button" size="sm" variant="muted" disabled={busy} onClick={() => void load()}>
          <RefreshCw size={14} className="mr-1.5" />
          重新读取
        </UiButton>
        <UiButton type="button" size="sm" variant="muted" disabled={busy} onClick={() => void openFile()}>
          <ExternalLink size={14} className="mr-1.5" />
          打开指令文件
        </UiButton>
        <UiButton type="button" size="sm" variant="muted" disabled={busy} onClick={() => void reset()}>
          <RotateCcw size={14} className="mr-1.5" />
          清空指令
        </UiButton>
      </div>
      {/* 「打开指令文件」的状态行会带出本地绝对路径，它不是输入控件，必须显式声明为
          观察敏感区域，否则会被 Surface 截图原样带给模型。 */}
      <p data-observation-sensitive className={`break-all leading-5 ${UI_TEXT_META_CLASS}`}>{status}</p>
    </div>
  )
}
