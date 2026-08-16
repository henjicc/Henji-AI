import type { AgentApprovalMode } from '../../../src/core/assistant/runtimeContracts'
import type { AgentTraceCaptureMode } from '../../../src/core/assistant/trace'

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000
const MAX_TIMEOUT_MS = 60 * 60 * 1_000

export interface AssistantCliOptions {
  goal: string
  approvalMode: AgentApprovalMode
  captureMode: AgentTraceCaptureMode
  printTrace: boolean
  awaitGeneration: boolean
  visible: boolean
  requireVerifiedWrite: boolean
  timeoutMs: number
  threadId?: string
}

export interface AssistantCliHelpOptions {
  help: true
}

export type ParsedAssistantCliArguments = AssistantCliOptions | AssistantCliHelpOptions

function requireValue(args: string[], index: number, name: string): string {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`参数 ${name} 缺少值`)
  return value
}

function parseApprovalMode(value: string): AgentApprovalMode {
  if (value === 'ask' || value === 'assistant_decides' || value === 'full_access') return value
  throw new Error('参数 --approval 仅支持 ask、assistant_decides 或 full_access')
}

function parseCaptureMode(value: string): AgentTraceCaptureMode {
  if (value === 'summary' || value === 'detailed') return value
  throw new Error('参数 --trace 仅支持 summary 或 detailed')
}

function parseTimeout(value: string): number {
  const timeoutMs = Number(value)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`参数 --timeout 必须是 1000 到 ${MAX_TIMEOUT_MS} 之间的整数毫秒数`)
  }
  return timeoutMs
}

export function isAssistantCliMode(argv: string[] = process.argv.slice(1)): boolean {
  return argv.includes('--assistant-cli')
}

export function parseAssistantCliArguments(argv: string[] = process.argv.slice(1)): ParsedAssistantCliArguments {
  if (!isAssistantCliMode(argv)) throw new Error('缺少 --assistant-cli 标识')
  if (argv.includes('--help') || argv.includes('-h')) return { help: true }

  let goal: string | undefined
  let approvalMode: AgentApprovalMode = 'assistant_decides'
  let captureMode: AgentTraceCaptureMode = 'summary'
  let printTrace = false
  let awaitGeneration = false
  let visible = false
  let requireVerifiedWrite = false
  let timeoutMs = DEFAULT_TIMEOUT_MS
  let threadId: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    switch (argument) {
      case '--assistant-cli':
        break
      case '--goal':
        goal = requireValue(argv, index, argument).trim()
        index += 1
        break
      case '--approval':
        approvalMode = parseApprovalMode(requireValue(argv, index, argument))
        index += 1
        break
      case '--trace':
        captureMode = parseCaptureMode(requireValue(argv, index, argument))
        index += 1
        break
      case '--print-trace':
        printTrace = true
        break
      case '--await-generation':
        awaitGeneration = true
        break
      case '--visible':
        visible = true
        break
      case '--require-verified-write':
        requireVerifiedWrite = true
        break
      case '--timeout':
        timeoutMs = parseTimeout(requireValue(argv, index, argument))
        index += 1
        break
      case '--thread':
        threadId = requireValue(argv, index, argument).trim()
        index += 1
        break
      default:
        if (argument.startsWith('--')) throw new Error(`不支持的参数：${argument}`)
    }
  }

  if (!goal) throw new Error('参数 --goal 不能为空')
  if (goal.length > 32 * 1024) throw new Error('参数 --goal 不能超过 32768 个字符')
  if (threadId && threadId.length > 200) throw new Error('参数 --thread 不能超过 200 个字符')

  return {
    goal, approvalMode, captureMode, printTrace, awaitGeneration, visible,
    requireVerifiedWrite, timeoutMs, ...(threadId ? { threadId } : {}),
  }
}

export function formatAssistantCliHelp(): string {
  return [
    '用法：npm run assistant:cli -- --goal "任务描述" [选项]',
    '',
    '选项：',
    '  --approval <ask|assistant_decides|full_access>  审批策略，默认 assistant_decides',
    '  --trace <summary|detailed>                      追踪捕获级别，默认 summary',
    '  --print-trace                                   在运行结束后输出已脱敏的详细追踪',
    '  --await-generation                              保持无窗口宿主并等待本次提交的生成任务结束',
    '  --visible                                       显示真实 Electron 窗口，便于观察执行过程',
    '  --require-verified-write                        要求至少一项应用写入已封存并通过结构化验证',
    '  --timeout <毫秒>                                最长运行时间，默认 600000，最大 3600000',
    '  --thread <标识>                                 指定运行线程标识',
    '  --help                                          显示本帮助',
    '',
    '输出为 JSONL；详细追踪仅保存在本机，且会包含已脱敏的提示词与模型响应。',
  ].join('\n')
}
