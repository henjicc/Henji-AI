import type { ApplicationRef } from '@/core/application-control'
import { executeUiApplicationCapability } from '@/features/application-control'

/**
 * 代码面板里的提交、升级：和助手走同一条正式操作（通用实体事务与工程能力），一次提交进同一份 Git 历史和撤销记录。
 * 写之前先读一次目标拿并发基线，期间别处改过剪辑就会被拒绝而不是覆盖。
 */
async function baseline(ref: ApplicationRef, signal: AbortSignal): Promise<Record<string, number>> {
  const read = await executeUiApplicationCapability({ id: 'read_application_entity', version: 1, input: { ref, propertyIds: [] } }, signal)
  if (!read.ok) throw new Error(read.error.message)
  return (read.data as { revisions: Record<string, number> }).revisions
}
async function run(invocation: Parameters<typeof executeUiApplicationCapability>[0], signal: AbortSignal): Promise<void> {
  const result = await executeUiApplicationCapability(invocation, signal)
  if (!result.ok) throw new Error(result.error.message)
}
const projectRef = (projectId: string): ApplicationRef => ({ kind: 'video_edit.code_project', id: projectId })

/** 改一个工程文件并提交，提交说明就是事务摘要。 */
export async function commitVideoEditCodeProjectFile(projectId: string, path: string, source: string, message: string, signal: AbortSignal): Promise<void> {
  const ref: ApplicationRef = { kind: 'video_edit.code_project_file', id: `${projectId}:${path}` }
  await run({ id: 'change_application_entities', version: 2, expectedRevisions: await baseline(ref, signal), input: { summary: message, changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties: { 'video_edit.code_project_file.source': source } }] } }, signal)
}
/** 把在外部编辑器里改过、还没提交的文件提交成一次提交。 */
export async function commitVideoEditCodeProjectWorkspace(projectId: string, message: string, signal: AbortSignal): Promise<void> {
  await run({ id: 'commit_video_edit_code_project', version: 1, expectedRevisions: await baseline(projectRef(projectId), signal), input: { documentRef: { kind: 'video_edit.document', id: projectId }, message } }, signal)
}
/** 把这些工程素材升级到最新提交，正在用旧版本的片段一并改指。 */
export async function upgradeVideoEditProjectCodeMaterials(projectId: string, definitionIds: readonly string[], signal: AbortSignal): Promise<void> {
  await run({ id: 'upgrade_video_edit_code_materials', version: 1, expectedRevisions: await baseline(projectRef(projectId), signal), input: { documentRef: { kind: 'video_edit.document', id: projectId }, materialRefs: definitionIds.map(id => ({ kind: 'video_edit.code_material', id: `${projectId}:${id}` })) } }, signal)
}
