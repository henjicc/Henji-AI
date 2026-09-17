/**
 * 画布节点的稳定引用形如 `<工程>:<节点>`（见 canvasGenerationTaskService 返回的 nodeRef／
 * resultRefs），而画布能力的入参收的是节点自身 id。模型拿到引用后原样回传是最自然的做法，
 * 而且注册表的 NOT_FOUND 提示本身就在教「多数实体的 id 带父级前缀」——结果反而被这里挡下。
 *
 * 真机实测：助手提交生成后拿 nodeRef 调 get_canvas_node，连着两次 NOT_FOUND，只能回头去读
 * 整个工程才找到节点。这里把**本工程**的前缀剥掉，让引用可以原样回传。
 *
 * 只在前缀恰好等于 `${projectId}:` 时剥离：别的工程前缀或本就含冒号的 id 一律原样透传，
 * 交给领域按原有语义判 NOT_FOUND，避免把跨工程的错误引用悄悄改成本工程的对象。
 */
const NODE_ID_FIELDS = ['nodeId', 'sourceNodeId', 'targetNodeId', 'groupNodeId'] as const
const NODE_ID_LIST_FIELDS = ['nodeIds', 'sourceNodeIds'] as const

function stripOwnProject(projectId: string, value: unknown): unknown {
  if (typeof value !== 'string') return value
  const prefix = `${projectId}:`
  return value.startsWith(prefix) && value.length > prefix.length ? value.slice(prefix.length) : value
}

export function normalizeCanvasNodeIds<TInput>(input: TInput): TInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const record = input as Record<string, unknown>
  const projectId = record.projectId
  if (typeof projectId !== 'string' || !projectId) return input
  let changed = false
  const next: Record<string, unknown> = { ...record }
  for (const field of NODE_ID_FIELDS) {
    if (!(field in next)) continue
    const value = stripOwnProject(projectId, next[field])
    if (value !== next[field]) { next[field] = value; changed = true }
  }
  for (const field of NODE_ID_LIST_FIELDS) {
    const value = next[field]
    if (!Array.isArray(value)) continue
    const mapped = value.map((item) => stripOwnProject(projectId, item))
    if (mapped.some((item, index) => item !== value[index])) { next[field] = mapped; changed = true }
  }
  return (changed ? next : input) as TInput
}
