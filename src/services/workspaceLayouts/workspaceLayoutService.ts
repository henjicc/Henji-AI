import { PersistenceError, upgradePersistenceContent } from '@/core/persistence/migrations'
import { formatMigrations } from '@/core/persistence/formatMigrations'
import type { SerializedDockview } from 'dockview-react'
import { getPlatform } from '@/platform'
import { createLogger } from '@/core/logging'
import { parseWorkspaceDockLayout, type WorkspacePanelDefinition } from '@/core/workspaceLayouts/validation'
import { WORKSPACE_LAYOUT_VERSION, workspaceLayoutEnvelopeSchema, createWorkspaceLayoutEnvelope } from '@/core/workspaceLayouts/schema'

export interface WorkspaceLayoutPreset { id: string; name: string; layout: SerializedDockview }
export interface WorkspaceLayoutRegistration {
  workspaceId: string
  panels: readonly WorkspacePanelDefinition[]
  builtinPresets: readonly WorkspaceLayoutPreset[]
  validate?: (layout: SerializedDockview) => void
  readLegacy?: () => SerializedDockview | undefined
  /** 切换到某个预设后的工作区专属动作（如“口播”布局顺带打开智能助手）；只在主动切换时触发，读取保存的布局不触发。 */
  onApply?: (presetId: string) => void
}
export interface WorkspaceLayoutState {
  activeId: string
  current: SerializedDockview
  users: WorkspaceLayoutPreset[]
}
export interface WorkspaceLayoutSnapshot extends WorkspaceLayoutState {
  presets: readonly (WorkspaceLayoutPreset & { builtin: boolean })[]
  dirty: boolean
  ready: boolean
  error: string | null
  revision: number
}
export interface WorkspaceLayoutStorage {
  read(key: string): Promise<string | undefined>
  write(key: string, value: string): Promise<void>
}
const logger = createLogger('services.workspaceLayouts')
const storage: WorkspaceLayoutStorage = {
  read: async key => (await getPlatform().settings.get(key))?.value,
  write: async (key, value) => { await getPlatform().settings.set(key, value, 'json') },
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export class WorkspaceLayoutSaveError extends Error {
  constructor(cause: unknown) { super(cause instanceof Error ? cause.message : '布局保存失败', { cause }); this.name = 'WorkspaceLayoutSaveError' }
}

/** UI 和助手共同使用的布局真相源；失败时保留内存修改和磁盘原件。 */
export class WorkspaceLayoutController {
  private listeners = new Set<() => void>()
  private state: WorkspaceLayoutSnapshot
  private loading?: Promise<void>
  private writes = Promise.resolve()
  private blocked = false
  private envelope: Record<string, unknown> = { version: WORKSPACE_LAYOUT_VERSION, minReaderVersion: WORKSPACE_LAYOUT_VERSION }
  /** 经过校验的内置预设：面板名称、最小尺寸等以当前定义为准（重要记录 020），初始布局与“是否改动”的比较都用它。 */
  private readonly builtin: readonly WorkspaceLayoutPreset[]
  private applyLayout?: (layout: SerializedDockview) => void
  private captureLayout?: () => SerializedDockview
  constructor(readonly registration: WorkspaceLayoutRegistration, private readonly persistence: WorkspaceLayoutStorage = storage) {
    if (!registration.builtinPresets.length) throw new Error('工作区至少需要一个内置布局')
    const ids = registration.builtinPresets.map(preset => preset.id)
    if (new Set(ids).size !== ids.length) throw new Error('布局预设标识重复')
    this.builtin = registration.builtinPresets.map(preset => ({ ...preset, layout: this.validate(preset.layout) }))
    const first = this.builtin[0]
    this.state = { activeId: first.id, current: clone(first.layout), users: [], presets: [], dirty: false, ready: false, error: null, revision: 0 }
    this.publish({})
  }
  getSnapshot = (): WorkspaceLayoutSnapshot => this.state
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private validate(layout: SerializedDockview): SerializedDockview {
    const parsed = parseWorkspaceDockLayout(JSON.stringify(layout), this.registration.panels)
    this.registration.validate?.(parsed)
    return parsed
  }
  private publish(patch: Partial<WorkspaceLayoutSnapshot>): void {
    const next = { ...this.state, ...patch }
    next.presets = [...this.builtin.map(p => ({ ...p, builtin: true })), ...next.users.map(p => ({ ...p, builtin: false }))]
    next.dirty = JSON.stringify(next.current) !== JSON.stringify(next.presets.find(p => p.id === next.activeId)?.layout)
    next.revision++
    this.state = next
    this.listeners.forEach(listener => listener())
  }
  async load(): Promise<void> {
    if (this.loading) return this.loading
    this.loading = (async () => {
      logger.debug('工作区布局读取开始', { event: 'workspace_layout.load.start', workspaceId: this.registration.workspaceId })
      try {
        const raw = await this.persistence.read(`workspace.layout.${this.registration.workspaceId}`)
        if (raw !== undefined) {
          const envelope = workspaceLayoutEnvelopeSchema.parse(JSON.parse(raw))
          if (envelope.minReaderVersion > WORKSPACE_LAYOUT_VERSION) throw new Error('布局由更新版本创建，请升级后再打开')
          const upgraded = upgradePersistenceContent({ id: 'workspace-layouts', name: '工作区布局预设', version: WORKSPACE_LAYOUT_VERSION, schema: workspaceLayoutEnvelopeSchema, migrations: formatMigrations('workspace-layouts') }, envelope, envelope.version, undefined, envelope.minReaderVersion) as typeof envelope
          const content = upgraded.content
          const users = content.users.map(p => ({ ...p, layout: this.validate(p.layout as unknown as SerializedDockview) }))
          const ids = [...this.builtin, ...users].map(p => p.id)
          if (new Set(ids).size !== ids.length || !ids.includes(content.activeId)) throw new Error('布局预设引用无效')
          this.envelope = envelope
          this.publish({ ...content, users, current: this.validate(content.current as unknown as SerializedDockview), ready: true })
        } else {
          const legacy = this.registration.readLegacy?.()
          this.publish({ ...(legacy ? { current: this.validate(legacy) } : {}), ready: true })
        }
        logger.debug('工作区布局读取完成', { event: 'workspace_layout.load.completed', workspaceId: this.registration.workspaceId })
      } catch (error) {
        this.blocked = true
        this.publish({ error: error instanceof PersistenceError ? error.message : '布局无法读取，原配置已保留，请检查数据目录后重试。' })
        logger.warn('工作区布局读取失败', { event: 'workspace_layout.load.failed', workspaceId: this.registration.workspaceId, error })
        throw error
      }
    })()
    return this.loading
  }
  private assertReady(): void {
    if (!this.state.ready || this.blocked) throw new Error(this.state.error ?? '布局尚未读取完成')
  }
  attach(apply: (layout: SerializedDockview) => void, capture: () => SerializedDockview): () => void {
    this.applyLayout = apply; this.captureLayout = capture
    return () => { if (this.applyLayout === apply) { this.applyLayout = undefined; this.captureLayout = undefined } }
  }
  private persist(): Promise<void> {
    this.assertReady()
    const { activeId, current, users } = this.state
    const content = { ...(this.envelope.content as object ?? {}), activeId, current, users }
    const value = JSON.stringify({ ...createWorkspaceLayoutEnvelope(content), ...this.envelope, content })
    const write = this.writes.catch(() => undefined).then(async () => {
      logger.debug('工作区布局保存开始', { event: 'workspace_layout.save.start', workspaceId: this.registration.workspaceId })
      await this.persistence.write(`workspace.layout.${this.registration.workspaceId}`, value)
      this.publish({ error: null })
      logger.debug('工作区布局保存完成', { event: 'workspace_layout.save.completed', workspaceId: this.registration.workspaceId })
    }).catch(error => {
      this.publish({ error: '布局未能保存，请重试' })
      logger.warn('工作区布局保存失败', { event: 'workspace_layout.save.failed', workspaceId: this.registration.workspaceId, error })
      throw new WorkspaceLayoutSaveError(error)
    })
    this.writes = write
    return write
  }
  capture(): void {
    if (this.captureLayout) this.publish({ current: this.validate(this.captureLayout()) })
  }
  async updateCurrent(layout: SerializedDockview): Promise<void> {
    this.assertReady(); this.publish({ current: this.validate(layout) }); await this.persist()
  }
  /**
   * 切换或重置布局先在界面上生效；配置还没读完或读取失败时不写回（不覆盖用户原有配置），
   * 这样“恢复默认布局”在布局读取失败时仍然可用。
   */
  async apply(id: string): Promise<void> {
    const preset = this.state.presets.find(p => p.id === id)
    if (!preset) throw new Error('没有此布局预设，请重新读取预设列表')
    const layout = this.validate(preset.layout)
    this.applyLayout?.(clone(layout))
    this.publish({ activeId: id, current: layout })
    this.registration.onApply?.(id)
    if (this.state.ready && !this.blocked) await this.persist()
  }
  async retrySave(): Promise<void> { await this.persist() }
  async resetActive(): Promise<void> { await this.apply(this.state.activeId) }
  async restore(state: WorkspaceLayoutState): Promise<void> {
    this.assertReady()
    const current = this.validate(state.current)
    this.applyLayout?.(clone(current))
    this.publish({ ...clone(state), current })
    await this.persist()
  }
  async saveAs(name: string): Promise<string> {
    this.assertReady(); const normalizedName = this.name(name); this.capture()
    const id = `user-${crypto.randomUUID()}`
    this.publish({ activeId: id, users: [...this.state.users, { id, name: normalizedName, layout: clone(this.state.current) }] })
    await this.persist(); return id
  }
  private name(name: string): string {
    const result = name.trim()
    if (!result || result.length > 80) throw new Error('布局名称需要 1 至 80 个字符')
    return result
  }
  async rename(id: string, name: string): Promise<void> {
    this.assertReady(); this.user(id); const next = this.name(name)
    this.publish({ users: this.state.users.map(p => p.id === id ? { ...p, name: next } : p) }); await this.persist()
  }
  private user(id: string): WorkspaceLayoutPreset {
    const preset = this.state.users.find(p => p.id === id)
    if (!preset) throw new Error('内置布局不可修改或删除')
    return preset
  }
  async overwrite(id = this.state.activeId): Promise<void> {
    this.assertReady(); this.user(id); this.capture()
    this.publish({ users: this.state.users.map(p => p.id === id ? { ...p, layout: clone(this.state.current) } : p) }); await this.persist()
  }
  async remove(id: string): Promise<void> {
    this.assertReady(); this.user(id)
    if (this.state.activeId === id) await this.apply(this.builtin[0].id)
    this.publish({ users: this.state.users.filter(p => p.id !== id) }); await this.persist()
  }
}

const controllers = new Map<string, WorkspaceLayoutController>()
export function registerWorkspaceLayout(registration: WorkspaceLayoutRegistration): WorkspaceLayoutController {
  const existing = controllers.get(registration.workspaceId)
  if (existing) return existing
  const controller = new WorkspaceLayoutController(registration)
  controllers.set(registration.workspaceId, controller)
  return controller
}
export function workspaceLayoutController(workspaceId: string): WorkspaceLayoutController {
  const controller = controllers.get(workspaceId)
  if (!controller) throw new Error(`工作区布局未注册：${workspaceId}`)
  return controller
}
export function listWorkspaceLayoutControllers(): readonly WorkspaceLayoutController[] { return [...controllers.values()] }
