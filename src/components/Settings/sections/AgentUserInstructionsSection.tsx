import { ExternalLink, RefreshCw, RotateCcw, Save } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import {
  getAssistantUserInstructions,
  openAssistantUserInstructionsFile,
  resetAssistantUserInstructions,
  updateAssistantUserInstructions,
} from '@/commands/assistant'
import { PromptEditor, UiButton } from '@/components/ui'
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

import SectionCard from '../components/SectionCard'

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
    <div className="space-y-5">
      <SectionCard
        title="用户指令"
        description="直接用自然语言描述长期偏好和工作习惯。除安全、权限、审批、真实能力和当前明确要求等硬约束外，用户指令优先于产品默认与模型描述。"
        titleClassName="text-sm normal-case tracking-normal text-text-dark"
      >
        <PromptEditor
          mode="edit"
          preset="plain"
          value={document}
          onChange={setDocument}
          ariaLabel="智能助手用户指令"
          placeholder={'例如：\n图片生成优先使用 PPIO；兼容时优先质量。\n回答尽量简洁，修改代码后先完成自动化检查。'}
          disabled={busy}
          maxCharacters={ASSISTANT_USER_INSTRUCTIONS_MAX_CHARACTERS}
          showCharacterCount
          error={warnings.length > 0}
          errorMessage={warnings.join('；')}
          editorShellClassName="bg-surface-dark"
          editorClassName="ui-scrollbar min-h-[220px] max-h-[360px] overflow-y-auto px-3 py-2.5 text-sm"
        />
        <p className="mt-3 text-xs leading-5 text-text-muted">
          这里只保存你主动填写或明确要求助手修改的内容。密钥、令牌、授权头和密码会在进入模型前自动脱敏；其他正常内容会完整传递。助手不会自动把对话、推断、日志或文件写入这里。
        </p>
      </SectionCard>

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
      <p className="break-all text-xs leading-5 text-text-muted">{status}</p>
    </div>
  )
}
