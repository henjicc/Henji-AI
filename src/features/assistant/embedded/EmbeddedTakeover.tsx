import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ListChecks, MessageCircleQuestion, SquareTerminal } from 'lucide-react'
import { UI_FIELD_SURFACE_CLASS, UiButton, UiInput, UiOptionButton, UiPanel } from '@/components/ui'
import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
import type { EmbeddedAgentSnapshot, EmbeddedApprovalDecision, EmbeddedQuestionAnswer } from '@/core/assistant/embeddedAgent'
import { AssistantMarkdown } from '../conversation/AssistantMarkdown'

type Approval = NonNullable<EmbeddedAgentSnapshot['pendingApproval']>
type Question = NonNullable<EmbeddedAgentSnapshot['pendingQuestion']>
type Decision = Omit<EmbeddedApprovalDecision, 'id'>
interface Choice { label: string; description?: string; other?: boolean }
/** 和回答校验同一个上限，写多了在输入时就停住，不到提交才被拒。 */
const ANSWER_MAX_LENGTH = 2000

/**
 * 助手等你处理一件事时接管输入框的位置（对标 Claude Code）：手不离键盘，数字直接选、上下键移动、Enter 确定、Esc 拒绝或跳过。
 * 处理完输入框原样回来，写了一半的草稿不丢。
 */
export function EmbeddedTakeover({ approval, question, onDecide, onAnswer }: {
  approval?: Approval
  question?: Question
  onDecide: (decision: Decision) => void
  onAnswer: (answer: Omit<EmbeddedQuestionAnswer, 'id'>) => void
}): JSX.Element | null {
  if (approval) return <ApprovalPanel key={approval.id} approval={approval} onDecide={onDecide} />
  if (question?.plan !== undefined) return <PlanPanel key={question.id} plan={question.plan} onAnswer={onAnswer} />
  if (question) return <QuestionPanel key={question.id} question={question} onAnswer={onAnswer} />
  return null
}

/** focusKey 变了（换题、“其他”输入框收起）而焦点掉出面板时收回来，键盘操作才一直有效。 */
function Shell({ icon, title, meta, children, hint, escapeLabel, onKey, focusKey }: {
  icon: ReactNode; title: string; meta?: string; children: ReactNode; hint: string; escapeLabel: string; onKey: (event: KeyboardEvent<HTMLDivElement>) => void; focusKey: string
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (!ref.current?.contains(ref.current.ownerDocument.activeElement)) ref.current?.focus() }, [focusKey])
  return <div className="px-3 pb-3 pt-2">
    <div ref={ref} tabIndex={-1} onKeyDown={onKey} role="group" aria-label={title} data-assistant-takeover
      className={`flex flex-col gap-2.5 rounded-lg p-3 outline-none ${UI_FIELD_SURFACE_CLASS}`}>
      <div className="flex items-center gap-2">
        <span className="text-text2">{icon}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
        {meta ? <span className="shrink-0 text-xs text-text3">{meta}</span> : null}
      </div>
      {children}
      <div className="flex items-center gap-2 text-xs text-text3"><span className="flex-1">{hint}</span><span>{escapeLabel}</span></div>
    </div>
  </div>
}

/** 编号选项列表：选中项中性选中底；“其他”选中后就地变成输入框。 */
function Choices({ choices, cursor, picked, other, onOther, onPick, onHover }: {
  choices: Choice[]; cursor: number; picked?: ReadonlySet<number>; other: string; onOther: (value: string) => void
  onPick: (index: number) => void; onHover: (index: number) => void
}): JSX.Element {
  return <div className="flex flex-col gap-0.5" role="listbox">
    {choices.map((choice, index) => choice.other && cursor === index
      ? <div key={index} className="flex items-center gap-2.5 px-2 py-1">
        <ChoiceNumber value={index + 1} active />
        <UiInput size="sm" autoFocus value={other} maxLength={ANSWER_MAX_LENGTH} onChange={event => onOther(event.target.value)} placeholder={choice.label} aria-label={choice.label} className="flex-1" />
      </div>
      : <UiOptionButton key={index} variant="menu" active={cursor === index} role="option" aria-selected={cursor === index || picked?.has(index)}
        className="w-full justify-start gap-2.5 text-left" onMouseEnter={() => onHover(index)} onClick={() => onPick(index)}>
        <ChoiceNumber value={index + 1} active={cursor === index || Boolean(picked?.has(index))} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{choice.label}</span>
          {choice.description ? <span className="truncate text-xs text-text3">{choice.description}</span> : null}
        </span>
      </UiOptionButton>)}
  </div>
}

function ChoiceNumber({ value, active }: { value: number; active: boolean }): JSX.Element {
  return <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-2xs ${active ? 'bg-accent text-on-accent' : 'bg-control text-text3'}`}>{value}</span>
}

/**
 * 方向键与数字键在选项间移动；焦点在输入框里时数字让给输入。
 * 数字键是“点这一项”，Enter 是“确定当前这一项”：多选题里两者不同，数字只勾选，Enter 才进下一步。
 */
function choiceKeyHandler(count: number, cursor: number, setCursor: (index: number) => void, pick: (index: number) => void, confirm: (index: number) => void, escape: () => void) {
  return (event: KeyboardEvent<HTMLDivElement>): void => {
    // 输入法正在组字时 Enter、Esc 属于输入法
    if (event.nativeEvent.isComposing) return
    const typing = event.target instanceof HTMLInputElement
    if (event.key === 'Escape') { event.preventDefault(); escape(); return }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setCursor((cursor + (event.key === 'ArrowDown' ? 1 : count - 1)) % count); return }
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); confirm(cursor); return }
    if (!typing && /^[1-9]$/.test(event.key) && Number(event.key) <= count) { event.preventDefault(); pick(Number(event.key) - 1) }
  }
}

function ApprovalPanel({ approval, onDecide }: { approval: Approval; onDecide: (decision: Decision) => void }): JSX.Element {
  const choices: Choice[] = [{ label: '允许' }, { label: '这段对话都允许' }, { label: '拒绝，告诉它怎么做…', other: true }]
  const [cursor, setCursor] = useState(0)
  const [message, setMessage] = useState('')
  const pick = (index: number): void => {
    if (index === 0) onDecide({ decision: 'allow' })
    else if (index === 1) onDecide({ decision: 'allow_session' })
    else if (cursor !== 2) setCursor(2)
    else onDecide({ decision: 'deny', ...message.trim() ? { message: message.trim() } : {} })
  }
  return <Shell icon={<SquareTerminal aria-hidden="true" className={UI_ICON_SIZE_CLASS.sm} />} title={approval.title} meta="改前先问" focusKey={String(cursor)}
    hint="↑↓ 选择 · Enter 确定" escapeLabel="Esc 拒绝" onKey={choiceKeyHandler(choices.length, cursor, setCursor, pick, pick, () => onDecide({ decision: 'deny' }))}>
    {approval.detail ? <UiPanel variant="inset" className="max-h-40 overflow-auto px-2.5 py-2">
      <pre className="m-0 whitespace-pre-wrap break-all font-mono text-xs text-text1">{approval.detail}</pre>
    </UiPanel> : null}
    <Choices choices={choices} cursor={cursor} other={message} onOther={setMessage} onPick={pick} onHover={index => { if (cursor !== 2 || !message) setCursor(index) }} />
  </Shell>
}

function PlanPanel({ plan, onAnswer }: { plan: string; onAnswer: (answer: Omit<EmbeddedQuestionAnswer, 'id'>) => void }): JSX.Element {
  const choices: Choice[] = [{ label: '执行', description: '切到自动，接着做' }, { label: '执行，但改前先问' }, { label: '再改改…', other: true }]
  const [cursor, setCursor] = useState(0)
  const [feedback, setFeedback] = useState('')
  const pick = (index: number): void => {
    if (index === 0) onAnswer({ answers: [], permissionMode: 'auto' })
    else if (index === 1) onAnswer({ answers: [], permissionMode: 'ask' })
    else if (cursor !== 2) setCursor(2)
    else if (feedback.trim()) onAnswer({ answers: [[feedback.trim()]] })
  }
  return <Shell icon={<ListChecks aria-hidden="true" className={UI_ICON_SIZE_CLASS.sm} />} title="计划" meta="只计划" focusKey={String(cursor)}
    hint="↑↓ 选择 · Enter 确定" escapeLabel="Esc 先不做" onKey={choiceKeyHandler(choices.length, cursor, setCursor, pick, pick, () => onAnswer({ answers: [], dismissed: true }))}>
    <UiPanel variant="inset" className="max-h-56 overflow-auto px-3 py-2"><AssistantMarkdown>{plan}</AssistantMarkdown></UiPanel>
    <Choices choices={choices} cursor={cursor} other={feedback} onOther={setFeedback} onPick={pick} onHover={index => { if (cursor !== 2 || !feedback) setCursor(index) }} />
  </Shell>
}

/** 一次可能问几道题：逐题回答，单选选了就进下一题，多选勾好后按 Enter 或“下一题”，最后一题答完一起交回。 */
function QuestionPanel({ question, onAnswer }: { question: Question; onAnswer: (answer: Omit<EmbeddedQuestionAnswer, 'id'>) => void }): JSX.Element {
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<string[][]>([])
  const [cursor, setCursor] = useState(0)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [other, setOther] = useState('')
  const current = question.questions[step]
  const choices: Choice[] = [...current.options, { label: '其他，写一句…', other: true }]
  const otherIndex = choices.length - 1
  const count = question.questions.length
  const multiAnswer = (): string[] => [...[...picked].sort((a, b) => a - b).map(item => current.options[item].label), ...other.trim() ? [other.trim()] : []]
  const advance = (answer: string[]): void => {
    const next = [...answers, answer]
    if (step + 1 >= count) { onAnswer({ answers: next }); return }
    setAnswers(next); setStep(step + 1); setCursor(0); setPicked(new Set()); setOther('')
  }
  /** 点一项：单选就是选定；多选是勾上或取消；“其他”先展开输入框。 */
  const pick = (index: number): void => {
    if (index === otherIndex) { setCursor(otherIndex); return }
    if (!current.multiSelect) { advance([current.options[index].label]); return }
    setCursor(index)
    setPicked(previous => { const next = new Set(previous); if (next.has(index)) next.delete(index); else next.add(index); return next })
  }
  /** Enter：多选是“这题选好了”；单选在“其他”上是交出写的那句，否则同点一项。 */
  const confirm = (index: number): void => {
    if (current.multiSelect) { const answer = multiAnswer(); if (answer.length) advance(answer); return }
    if (index !== otherIndex) { pick(index); return }
    if (cursor !== otherIndex) setCursor(otherIndex)
    else if (other.trim()) advance([other.trim()])
  }
  return <Shell icon={<MessageCircleQuestion aria-hidden="true" className={UI_ICON_SIZE_CLASS.sm} />} title={current.header ?? '问题'} focusKey={`${step}:${cursor}`}
    meta={count > 1 ? `${step + 1} / ${count}` : undefined} hint={current.multiSelect ? '数字勾选 · Enter 下一步' : '↑↓ 选择 · Enter 确定'} escapeLabel="Esc 跳过"
    onKey={choiceKeyHandler(choices.length, cursor, setCursor, pick, confirm, () => onAnswer({ answers: [], dismissed: true }))}>
    <div className="font-medium">{current.question}</div>
    <Choices choices={choices} cursor={cursor} picked={picked} other={other} onOther={setOther} onPick={pick} onHover={index => { if (cursor !== otherIndex || !other) setCursor(index) }} />
    {current.multiSelect ? <div className="flex justify-end">
      <UiButton size="sm" variant="primary" disabled={!multiAnswer().length} disabledReason="先选至少一项" onClick={() => advance(multiAnswer())}>{step + 1 < count ? '下一题' : '提交'}</UiButton>
    </div> : null}
  </Shell>
}
