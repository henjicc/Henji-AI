import { getPlatform } from '@/platform/runtime'
import { ContentTrustRequiredError, type ContentTrustReference, type ContentTrustQuery, type ContentTrustCommand, type ContentTrustCheck } from '@/core/contentTrust'
import { requestAlertConfirmation, useAlertDialogStore } from '@/stores/alertDialogStore'
import { installContentTrustConfirmation } from '@/platform/contentTrustConfirmation'
import { withApplicationConfirmation } from '@/core/application-control/userConfirmation'

const listeners = new Set<(command: ContentTrustCommand, records: readonly ContentTrustReference[]) => void>()
interface TrustPrompt { controller: AbortController; waiters: number; settled: boolean; promise: Promise<void> }
const prompts = new Map<string, TrustPrompt>()

function waitForPrompt(promise: Promise<void>, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal!.reason) }
    const cleanup = () => signal?.removeEventListener('abort', abort)
    signal?.addEventListener('abort', abort, { once: true })
    promise.then(() => { cleanup(); resolve() }, error => { cleanup(); reject(error) })
  })
}
let allowExternalContentCode = false
installContentTrustConfirmation({ ensure: ensureContentTrust, prepare: prepareContentTrust })
export const externalContentCodeAllowed = (): boolean => allowExternalContentCode
export const subscribeContentTrust = (listener: (command: ContentTrustCommand, records: readonly ContentTrustReference[]) => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export async function executeContentTrust(command: ContentTrustCommand): Promise<ContentTrustCheck> {
  const result = await getPlatform().applicationControl.contentTrust(command)
  allowExternalContentCode = result.allowExternalContentCode
  if (command.action === 'decide' || command.action === 'set-policy') listeners.forEach(listener => listener(command, result.records))
  return result
}
/** 所有执行入口共享同一个判断；内容是否外来只取导入时保存的标记。 */
export async function ensureContentTrust(query: ContentTrustQuery, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  if (!query.contents.length) return
  const checked = await executeContentTrust({ action: 'check', query })
  if (checked.state === 'allowed') return
  if (checked.state === 'denied') throw new ContentTrustRequiredError('denied', checked.records)
  const challenge = checked.challenge!
  const title = [...new Set(checked.records.map(record => record.sourceName))].join('、')
  useAlertDialogStore.setState(state => ({ queue: state.queue.map(entry => entry.contentTrustChallenge === challenge ? { ...entry, title } : entry) }))
  let pending = prompts.get(challenge)
  if (!pending) {
    const entry: TrustPrompt = { controller: new AbortController(), waiters: 0, settled: false, promise: Promise.resolve() }
    entry.promise = (async () => {
      let decision: 'once' | 'always' = 'once'
      await requestAlertConfirmation({ title, message: '这份内容包含代码，是否允许运行？', type: 'info', contentTrustChallenge: challenge,
        confirmLabel: '仅这一次', cancelLabel: '不运行', alwaysAllowLabel: '始终允许', onAlwaysAllow: () => { decision = 'always' },
        onDecision: async accepted => { await executeContentTrust({ action: 'decide', challenge, decision: accepted ? decision : 'deny' }) },
      }, entry.controller.signal)
    })().finally(() => { entry.settled = true; if (prompts.get(challenge) === entry) prompts.delete(challenge) })
    prompts.set(challenge, entry)
    pending = entry
  }
  const prompt = pending
  prompt.waiters++
  try {
    await withApplicationConfirmation(signal, { title, message: '这份内容包含代码，是否允许运行？', confirmLabel: '仅这一次' }, async scopedSignal => { await waitForPrompt(prompt.promise, scopedSignal); return true })
  } finally {
    // 弹窗属于全部等待者；单个预览或助手调用取消不能替其余调用关闭询问。
    if (--prompt.waiters === 0 && !prompt.settled) {
      if (prompts.get(challenge) === prompt) prompts.delete(challenge)
      prompt.controller.abort()
    }
  }
  signal?.throwIfAborted()
  const after = await executeContentTrust({ action: 'check', query })
  if (after.state !== 'allowed') throw new ContentTrustRequiredError(after.state, query.contents)
}
export async function ensureCodeContentTrust(files: { trustContext?: readonly ContentTrustReference[] }, signal?: AbortSignal): Promise<ContentTrustReference[]> {
  const contents = [...(files.trustContext ?? [])]
  await ensureContentTrust({ contents }, signal)
  return contents
}
export async function prepareContentTrust(sourceType: 'web_recording' | 'skill', id: string, signal?: AbortSignal): Promise<void> {
  const checked = await executeContentTrust({ action: 'prepare', sourceType, id })
  await ensureContentTrust({ contents: checked.records }, signal)
}
/** 占位按钮重新询问，只有用户在弹窗中选择后才重试执行。 */
export async function runForeignContent(record: ContentTrustReference | readonly ContentTrustReference[], run?: () => Promise<void>): Promise<void> {
  const records = Array.isArray(record) ? record : [record]
  await executeContentTrust({ action: 'retry', records })
  await ensureContentTrust({ contents: records })
  await run?.()
}
export function subscribeContentTrustContext(queries: () => ContentTrustQuery[], retry: () => void, _onError?: (error: unknown) => void): () => void {
  return subscribeContentTrust((command, records) => {
    const ids = new Set(records.map(record => record.sourceType + ':' + record.id))
    const global = command.action === 'set-policy' || command.action === 'decide' && command.decision === 'always'
    if (queries().some(query => query.contents.some(content => global || ids.has(content.sourceType + ':' + content.id)))) retry()
  })
}
