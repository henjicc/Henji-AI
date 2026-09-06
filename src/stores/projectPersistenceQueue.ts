interface ProjectPersistenceQueueOptions<TProject> {
  getProjectId: (project: TProject) => string
  upsertProject: (project: TProject) => Promise<void>
  updateViewport: (projectId: string, viewportJson: string) => Promise<void>
  deleteProject: (projectId: string) => Promise<void>
  onBackgroundError: (operation: 'save' | 'viewport', error: unknown, projectId: string) => void
}

interface QueueOptions { immediate?: boolean; debounceMs?: number }
export interface ProjectPersistenceQueue<TProject> {
  queueProject: (project: TProject, options?: QueueOptions) => void
  flushProject: (project: TProject) => Promise<void>
  queueViewport: (projectId: string, viewportJson: string, options?: QueueOptions) => void
  clearViewport: (projectId: string) => void
  deleteProject: (projectId: string) => Promise<void>
  pauseProject: (projectId: string) => () => void
  getUnsavedProject: (projectId: string) => TProject | undefined
}

type Write<T> = { generation: number } & (
  | { kind: 'save'; project: T }
  | { kind: 'viewport'; value: string }
)
interface Waiter { generation: number; resolve: () => void; reject: (error: unknown) => void }
interface State<T> {
  generation: number
  pending: Write<T>[]
  active: boolean
  activeWrite?: Write<T>
  deleting: boolean
  deleted: boolean
  pauses: number
  timer?: ReturnType<typeof setTimeout>
  waiters: Waiter[]
  settled: Set<() => void>
}

/** 同项目只有一个 writer；完成屏障确认捕获的代次，失败保留最新快照供重试。 */
export function createProjectPersistenceQueue<TProject>(
  options: ProjectPersistenceQueueOptions<TProject>,
): ProjectPersistenceQueue<TProject> {
  const states = new Map<string, State<TProject>>()
  const stateFor = (id: string): State<TProject> => {
    let state = states.get(id)
    if (!state) {
      state = { generation: 0, pending: [], active: false, deleting: false, deleted: false,
        pauses: 0, waiters: [], settled: new Set() }
      states.set(id, state)
    }
    return state
  }
  const cancelTimer = (state: State<TProject>): void => {
    if (state.timer) clearTimeout(state.timer)
    state.timer = undefined
  }
  const pump = (id: string, state: State<TProject>): void => {
    if (state.active || state.deleting || state.deleted || state.pauses || state.pending.length === 0) return
    cancelTimer(state)
    const write = state.pending.shift()!
    state.active = true
    state.activeWrite = write
    let failed = false
    let failure: unknown
    let completed: Waiter[] = []
    void Promise.resolve().then(() => write.kind === 'save'
      ? options.upsertProject(write.project)
      : options.updateViewport(id, write.value)).then(() => {
      completed = state.waiters.filter((waiter) => waiter.generation <= write.generation)
      state.waiters = state.waiters.filter((waiter) => waiter.generation > write.generation)
    }).catch((error: unknown) => {
      failed = true
      failure = error
      // 后来的整工程快照覆盖本次失败；仅有视口更新不能代替丢失的工程内容。
      if (!state.pending.some((pending) => pending.kind === 'save'
        || (write.kind === 'viewport' && pending.kind === 'viewport'))) state.pending.unshift(write)
      completed = state.waiters.splice(0)
      options.onBackgroundError(write.kind, error, id)
    }).finally(() => {
      state.active = false
      state.activeWrite = undefined
      for (const settled of state.settled) settled()
      state.settled.clear()
      completed.forEach((waiter) => failed ? waiter.reject(failure) : waiter.resolve())
      // 失败后等显式重试或下一次编辑，避免磁盘故障时无限重试。
      if (!failed) pump(id, state)
    })
  }
  const schedule = (id: string, state: State<TProject>, delay: number): void => {
    cancelTimer(state)
    if (delay <= 0) pump(id, state)
    else state.timer = setTimeout(() => { state.timer = undefined; pump(id, state) }, delay)
  }
  const acceptProject = (project: TProject, allowDeleting = false): { id: string; state: State<TProject>; generation: number } => {
    const id = options.getProjectId(project)
    const state = stateFor(id)
    if ((state.deleting && !allowDeleting) || state.deleted) throw new Error('项目正在删除或已经删除，不能保存，请检查项目状态')
    const generation = ++state.generation
    state.pending = [{ kind: 'save', project, generation }]
    return { id, state, generation }
  }
  const queueProject = (project: TProject, queueOptions?: QueueOptions): void => {
    const current = stateFor(options.getProjectId(project))
    if (current.deleted) return
    const { id, state } = acceptProject(project, true)
    schedule(id, state, queueOptions?.immediate ? 0 : (queueOptions?.debounceMs ?? 260))
  }
  const flushProject = async (project: TProject): Promise<void> => {
    const { id, state, generation } = acceptProject(project)
    const promise = new Promise<void>((resolve, reject) => state.waiters.push({ generation, resolve, reject }))
    schedule(id, state, 0)
    return promise
  }
  const clearViewport = (id: string): void => {
    const state = states.get(id)
    if (state) state.pending = state.pending.filter((pending) => pending.kind !== 'viewport')
  }
  const queueViewport = (id: string, value: string, queueOptions?: QueueOptions): void => {
    const state = stateFor(id)
    if (state.deleted) return
    state.pending = state.pending.filter((pending) => pending.kind !== 'viewport')
    state.pending.push({ kind: 'viewport', value, generation: ++state.generation })
    schedule(id, state, queueOptions?.immediate ? 0 : (queueOptions?.debounceMs ?? 280))
  }
  const pauseProject = (id: string): (() => void) => {
    const state = stateFor(id)
    if (state.deleting || state.deleted) throw new Error('项目正在删除或已经删除，不能开始修改')
    state.pauses += 1
    let released = false
    return () => {
      if (released) return
      released = true
      state.pauses -= 1
      pump(id, state)
    }
  }
  const deleteProject = async (id: string): Promise<void> => {
    const state = stateFor(id)
    if (state.deleting) throw new Error('项目正在删除')
    state.deleting = true
    cancelTimer(state)
    const deleted = new Error('项目已进入删除流程，未完成的保存已取消')
    try {
      if (state.active) await new Promise<void>((resolve) => state.settled.add(resolve))
      await options.deleteProject(id)
      state.pending = []
      state.deleted = true
      state.waiters.splice(0).forEach((waiter) => waiter.reject(deleted))
    } catch (error) {
      state.waiters.splice(0).forEach((waiter) => waiter.reject(error))
      throw error
    } finally {
      state.deleting = false
    }
  }
  const getUnsavedProject = (id: string): TProject | undefined => {
    const state = states.get(id)
    if (!state || state.deleted) return undefined
    const pending = [...state.pending].reverse().find((write) => write.kind === 'save')
    if (pending?.kind === 'save') return pending.project
    return state.activeWrite?.kind === 'save' ? state.activeWrite.project : undefined
  }
  return { queueProject, flushProject, queueViewport, clearViewport, deleteProject, pauseProject, getUnsavedProject }
}
