import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { ArrowUpCircle, Globe, Pencil, Play, Trash2 } from 'lucide-react'
import ContextMenu from '@/components/ContextMenu'
import { useContextMenu, type MenuItem } from '@/hooks/useContextMenu'
import { UI_COVER_FRAME_CLASS, UI_TEXT_META_CLASS, UiActionGroup, UiButton, UiEmpty, UiFormRow, UiGroup, UiInput, UiModal, UiOptionButton, UiSearchInput } from '@/components/ui'
import { useNotification } from '@/contexts/NotificationContext'
import { codeMaterialSource } from '@/core/videoEdit/codeMaterialDocument'
import { portableCodeComponentFiles } from '@/core/videoEdit/codeMaterial/components'
import type { VideoEditProjectTemplate } from '@/core/videoEdit/document'
import type { VideoEditTemplateBody } from '@/core/videoEdit/styles/templateSchemas'
import { editVideoProject, getActiveVideoEditSequence, subscribeVideoEditDomain, videoEditDomainRevision, type VideoEditInstance } from '../application/videoEditService'
import { videoEditStyleLibrary } from '../application/videoEditStyleLibrary'
import { applyVideoEditTemplate, createVideoEditTemplate, detachVideoEditTemplateInstances, newerLibraryTemplateVersion, promoteVideoEditTemplate, unregisterVideoEditTemplates, updateVideoEditTemplate, videoEditClipTemplate, videoEditTemplateInstances, writeVideoEditTemplateDrag, type VideoEditTemplateScope } from '../application/videoEditTemplates'
import { VideoEditPresetPlayer } from './VideoEditPresetPlayer'

const TILE = { width: 320, height: 180 }
interface Entry { scope: VideoEditTemplateScope; id: string; name: string; meta: string; description: string; body: VideoEditTemplateBody | null; project?: VideoEditProjectTemplate; newer: number | null }
function projectBody(instance: VideoEditInstance, template: VideoEditProjectTemplate): VideoEditTemplateBody | null {
  if (template.body.kind === 'native') return template.body
  const definition = instance.document.codeMaterials?.find(value => value.id === (template.body as { definitionId: string }).definitionId)
  if (!definition) return null
  try { return { kind: 'code', code: portableCodeComponentFiles(codeMaterialSource(instance.document, { definitionId: definition.id, versionId: definition.defaultVersionId, parameters: {} }).compilation) } } catch { return null }
}
function TemplatePicture({ body, playing, label }: { body: VideoEditTemplateBody | null; playing: boolean; label: string }): React.ReactElement {
  const source = useMemo(() => body ? { category: 'template' as const, body } : undefined, [body])
  return source ? <VideoEditPresetPlayer source={source} size={TILE} playing={playing} label={label} /> : <span className="flex h-full w-full items-center justify-center text-xs text-text3">没有预览</span>
}

/**
 * 模板面板（Frameflow“预设 → 模板”）：本工程模板在前，风格库模板在后；单击加到播放头、拖到时间线指定位置，
 * 右键设为全局、升级、重命名、删除。底部把时间线上所选片段固化成模板，或把所选实例分离。
 */
function Panel({ instance, onError, visible = true }: { instance: VideoEditInstance; onError: (reason: unknown) => void; visible?: boolean }): React.ReactElement {
  const { showNotification } = useNotification()
  useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision)
  const [query, setQuery] = useState(''); const [hovered, setHovered] = useState<string | null>(null); const [busy, setBusy] = useState(false)
  const [naming, setNaming] = useState<{ mode: 'create' | 'rename'; key?: string; name: string; description: string } | null>(null)
  const menu = useContextMenu()
  useEffect(() => { void videoEditStyleLibrary.ready().catch(onError) }, [onError])
  const projectId = instance.document.id
  const sequence = instance.activeSequenceId ? getActiveVideoEditSequence(instance) : undefined
  const styles = new Map([...(instance.document.styles ?? []).map(style => [style.id, style.name] as const), ...videoEditStyleLibrary.listStyles().map(entry => [entry.style.id, entry.style.name] as const)])
  const projectEntries = useMemo<Entry[]>(() => (instance.document.templates ?? []).map(template => ({ scope: 'project', id: template.id, name: template.name, description: template.description, body: projectBody(instance, template), project: template, newer: newerLibraryTemplateVersion(template),
    meta: [`${videoEditTemplateInstances(instance.document, template).length} 处`, template.style ? styles.get(template.style.id) : '', `v${template.version}`].filter(Boolean).join(' · ') })), [instance.document]) // eslint-disable-line react-hooks/exhaustive-deps -- styles derive from the same document and library revision
  const copied = new Set((instance.document.templates ?? []).flatMap(template => template.origin ? [template.origin.id] : []))
  const libraryEntries: Entry[] = videoEditStyleLibrary.listTemplates().filter(entry => !copied.has(entry.template.id)).map(entry => ({ scope: 'library', id: entry.template.id, name: entry.template.name, description: entry.template.description, body: entry.template.body, newer: null,
    meta: [entry.template.style ? styles.get(entry.template.style.id) ?? '风格已删除' : '单独模板', `v${entry.template.version}`].join(' · ') }))
  const match = (entry: Entry): boolean => !query.trim() || `${entry.name} ${entry.description} ${entry.meta}`.toLowerCase().includes(query.trim().toLowerCase())
  const run = async (action: () => Promise<void> | void): Promise<void> => { setBusy(true); try { await action() } catch (reason) { onError(reason) } finally { setBusy(false) } }
  const apply = (entry: Entry): Promise<void> => run(async () => { if (!sequence) throw new Error('先打开一个序列。'); const result = await applyVideoEditTemplate(projectId, sequence.id, entry.scope, entry.id); showNotification(`已在播放头加入“${result.template.name}”${result.copied ? '，并登记为本工程模板' : ''}。`) })
  const selectedClips = sequence?.clips.filter(clip => instance.selectedClipIds.includes(clip.id)) ?? []
  const selectedInstances = selectedClips.filter(clip => videoEditClipTemplate(instance.document, clip))
  const items = (entry: Entry): MenuItem[] => [
    { id: 'apply', label: '加到播放头', icon: <Play />, disabled: !sequence, onClick: () => { void apply(entry) } },
    ...(entry.project ? [
      { id: 'promote', label: entry.project.origin ? '更新到风格库' : '设为全局模板', icon: <Globe />, onClick: () => { void run(async () => { const result = await promoteVideoEditTemplate(projectId, entry.id); showNotification(`“${result.library.name}”已存进风格库（v${result.library.version}）。`) }) } },
      ...(entry.newer ? [{ id: 'upgrade', label: `升级到 v${entry.newer}（影响 ${videoEditTemplateInstances(instance.document, entry.project).length} 处）`, icon: <ArrowUpCircle />, onClick: () => { void run(async () => { const result = await updateVideoEditTemplate(projectId, entry.id, { kind: 'library' }); showNotification(`已升级“${result.template.name}”，${result.instances} 处实例一起更新。`) }) } }] : []),
      { id: 'rename', label: '重命名…', icon: <Pencil />, onClick: () => setNaming({ mode: 'rename', key: `project:${entry.id}`, name: entry.name, description: entry.description }) },
      { id: 'unregister', label: '取消登记（保留片段）', icon: <Trash2 />, divider: true, onClick: () => { void run(() => { editVideoProject(projectId, document => unregisterVideoEditTemplates(document, [entry.id])) }) } },
    ] : [
      { id: 'rename', label: '重命名…', icon: <Pencil />, onClick: () => setNaming({ mode: 'rename', key: `library:${entry.id}`, name: entry.name, description: entry.description }) },
      { id: 'delete', label: '从风格库删除', icon: <Trash2 />, divider: true, onClick: () => { void run(() => videoEditStyleLibrary.removeTemplate(entry.id)) } },
    ]),
  ]
  const tile = (entry: Entry): React.ReactElement => <div role="listitem" key={`${entry.scope}:${entry.id}`} className="min-w-0">
    <UiOptionButton variant="cover" className="w-full min-w-0" data-video-edit-template={`${entry.scope}:${entry.id}`} draggable onDragStart={event => writeVideoEditTemplateDrag(event.dataTransfer, entry.scope, entry.id)}
      onPointerEnter={() => setHovered(`${entry.scope}:${entry.id}`)} onPointerLeave={() => setHovered(null)} onClick={() => { void apply(entry) }}
      onContextMenu={event => { event.preventDefault(); menu.showMenu(event, items(entry)) }} tooltip={entry.description || undefined} aria-label={`${entry.name}，${entry.meta}，单击加到播放头，可拖到时间线，右键更多操作`}>
      <span className={`${UI_COVER_FRAME_CLASS} block aspect-video w-full overflow-hidden`}>{visible && <TemplatePicture body={entry.body} playing={hovered === `${entry.scope}:${entry.id}`} label={`${entry.name}预览`} />}</span>
      <span className="block w-full min-w-0 px-0.5">
        <span className="block truncate text-xs text-text1">{entry.name}</span>
        <span className={`block truncate ${UI_TEXT_META_CLASS}`}>{entry.newer ? `有更新 v${entry.newer} · ` : ''}{entry.meta}</span>
      </span>
    </UiOptionButton>
  </div>
  const grid = (title: string, entries: Entry[]): React.ReactElement | null => entries.length ? <UiGroup title={title} titleTone="compact">
    <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3" role="list" aria-label={title}>{entries.map(tile)}</div>
  </UiGroup> : null
  const project = projectEntries.filter(match); const library = libraryEntries.filter(match)
  const save = async (): Promise<void> => {
    if (!naming) return; const value = naming; setNaming(null)
    await run(async () => {
      if (value.mode === 'create') { const result = await createVideoEditTemplate(projectId, sequence!.id, selectedClips.map(clip => clip.id), { name: value.name.trim(), description: value.description.trim() }); showNotification(`已登记模板“${result.template.name}”。`); return }
      const [scope, id] = value.key!.split(':') as [VideoEditTemplateScope, string]
      if (scope === 'project') editVideoProject(projectId, document => ({ ...document, templates: document.templates!.map(template => template.id === id ? { ...template, name: value.name.trim(), description: value.description.trim() } : template) }))
      else { const entry = videoEditStyleLibrary.requireTemplate(id); await videoEditStyleLibrary.saveTemplate({ ...entry.template, name: value.name.trim(), description: value.description.trim() }) }
    })
  }
  return <div className="flex h-full min-h-0 flex-col gap-2 px-3 py-3" aria-label="模板" data-video-edit-templates>
    <UiSearchInput size="sm" aria-label="搜索模板" placeholder="搜索模板" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} clearLabel="清除搜索" />
    <div className="min-h-0 flex-1 overflow-y-auto">
      {project.length || library.length ? <>{grid('本工程', project)}{grid('风格库', library)}</> : <UiEmpty size="sm" title={query ? '没有匹配的模板' : '还没有模板'} description={query ? undefined : '在时间线上选中做好的文字、图形或代码片段，点“保存所选为模板”。'} />}
    </div>
    <UiActionGroup tier="secondary" size="sm">
      <UiButton disabled={busy || !selectedClips.length || !sequence} disabledReason="先在时间线上选中做好的片段" onClick={() => setNaming({ mode: 'create', name: selectedClips[0]?.name.slice(0, 80) ?? '模板', description: '' })}>保存所选为模板</UiButton>
      <UiButton disabled={busy || !selectedInstances.length} disabledReason="先选中模板的实例" tooltip="只改这一处时先分离，之后改它不影响其他实例" onClick={() => { void run(async () => { const ids = await detachVideoEditTemplateInstances(projectId, sequence!.id, selectedInstances.map(clip => clip.id)); showNotification(`已分离 ${ids.length} 个片段。`) }) }}>分离所选</UiButton>
    </UiActionGroup>
    <ContextMenu items={menu.menuItems} position={menu.menuPosition} onClose={menu.hideMenu} visible={menu.menuVisible} />
    {naming && <UiModal isOpen title={naming.mode === 'create' ? '保存为模板' : '重命名模板'} size="compact" onClose={() => setNaming(null)} footer={<>
      <UiButton variant="secondary" onClick={() => setNaming(null)}>取消</UiButton>
      <UiButton variant="primary" disabled={!naming.name.trim()} onClick={() => { void save() }}>{naming.mode === 'create' ? '保存' : '重命名'}</UiButton>
    </>}>
      <UiGroup labelWidth={72}>
        <UiFormRow label="名称" density="compact"><UiInput aria-label="模板名称" value={naming.name} maxLength={80} onChange={event => setNaming({ ...naming, name: event.target.value })} /></UiFormRow>
        <UiFormRow label="用途" density="compact"><UiInput aria-label="模板用途" placeholder="例如：人物首次出场时介绍姓名" value={naming.description} maxLength={300} onChange={event => setNaming({ ...naming, description: event.target.value })} /></UiFormRow>
      </UiGroup>
    </UiModal>}
  </div>
}
export function VideoEditTemplatesPanel(props: Parameters<typeof Panel>[0]): React.ReactElement { return <Panel {...props} /> }
