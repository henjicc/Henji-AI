import { randomUUID } from 'node:crypto'
import { ContentTrustRequiredError, type ContentTrustQuery, type ContentTrustReference, type ContentTrustCheck } from '../../../../src/core/contentTrust'
import { EXTERNAL_CONTENT_CODE_SETTING_KEY } from '../../../../src/core/contentTrust'
import { getSettingsStore } from '../settings/store'
import { createMainLogger } from '../logging'

const logger = () => createMainLogger('main.content_trust')
/** 选择仅存在于本次应用进程；永久允许只写现有设置记录。 */
export class ContentTrustSession {
  private readonly allowed = new Set<string>()
  private readonly denied = new Set<string>()
  private pending?: { id: string; contents: Map<string, ContentTrustReference> }
  constructor(private readonly readPolicy: () => boolean, private readonly writePolicy: (allow: boolean) => void) {}
  private key(content: ContentTrustReference): string { return content.sourceType + ':' + content.id }
  allows(query: ContentTrustQuery): boolean { return this.policy() || query.contents.every(content => this.allowed.has(this.key(content))) }
  policy(): boolean { return this.readPolicy() }
  setPolicy(allow: boolean): ContentTrustCheck { this.writePolicy(allow); return { records: [], state: 'allowed', allowExternalContentCode: allow } }
  check(query: ContentTrustQuery): ContentTrustCheck {
    const allowExternalContentCode = this.policy()
    const records = [...new Map(query.contents.map(content => [this.key(content), content])).values()]
    const blocked = allowExternalContentCode ? [] : records.filter(content => !this.allowed.has(this.key(content)))
    if (!blocked.length) return { records, state: 'allowed', allowExternalContentCode }
    logger().info('外来代码尚未运行', { event: 'content_trust.blocked', context: { identities: blocked.map(content => content.id), sourceTypes: blocked.map(content => content.sourceType) } })
    if (blocked.some(content => this.denied.has(this.key(content)))) return { records: blocked, state: 'denied', allowExternalContentCode }
    if (!this.pending) {
      this.pending = { id: randomUUID(), contents: new Map() }
      logger().info('等待用户选择外来代码运行方式', { event: 'content_trust.requested', context: { identities: blocked.map(content => content.id), sourceTypes: blocked.map(content => content.sourceType) } })
    }
    for (const content of blocked) this.pending.contents.set(this.key(content), content)
    return { records: [...this.pending.contents.values()], state: 'awaiting_user_confirmation', challenge: this.pending.id, allowExternalContentCode }
  }
  decide(challenge: string, decision: 'once' | 'always' | 'deny'): ContentTrustCheck {
    if (this.pending?.id !== challenge) throw new Error('这次询问已结束，请重新运行。')
    const records = [...this.pending.contents.values()]
    if (decision === 'always') this.writePolicy(true)
    for (const content of records) { this.denied.delete(this.key(content)); if (decision === 'deny') this.denied.add(this.key(content)); else this.allowed.add(this.key(content)) }
    this.pending = undefined
    logger().info('已记录外来代码运行选择', { event: 'content_trust.decided', context: { identities: records.map(content => content.id), sourceTypes: records.map(content => content.sourceType), decision } })
    return { records, state: decision === 'deny' ? 'denied' : 'allowed', allowExternalContentCode: this.policy() }
  }
  retry(records: readonly ContentTrustReference[]): ContentTrustCheck { for (const content of records) this.denied.delete(this.key(content)); return this.check({ contents: [...records] }) }
  assert(query: ContentTrustQuery): void {
    const checked = this.check(query)
    if (checked.state !== 'allowed') throw new ContentTrustRequiredError(checked.state, checked.records)
  }
}
let session: ContentTrustSession | undefined
export function contentTrust(): ContentTrustSession { return session ??= new ContentTrustSession(() => getSettingsStore().get(EXTERNAL_CONTENT_CODE_SETTING_KEY) === 'true', allow => { getSettingsStore().set(EXTERNAL_CONTENT_CODE_SETTING_KEY, String(allow), 'boolean') }) }
export function installContentTrustSession(value: ContentTrustSession): () => void { const previous = session; session = value; return () => { session = previous } }
