import { useEffect, useRef, useState } from 'react'
import { VirtuosoGrid } from 'react-virtuoso'
import { Dropdown, UiButton, UiColorInput, UiEmpty, UiError, UiFormRow, UiGroup, UiInput, UiOptionButton, UiSearchInput, UiTextArea } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { PromptEditor } from '@/components/ui/PromptEditor'
import { parseLegacyPromptString, toPromptPlainText } from '@/core/inputs/promptDocument'
import { titleTemplateParametersSchema, type TitleTemplateParameters } from '@/core/videoEdit/titleTemplates'
import { getActiveVideoEditSequence, requireVideoEditInstance, type VideoEditInstance } from '../application/videoEditService'
import { listTitleTemplates, requireTitleTemplate, useTitleTemplateLibrary } from '../application/videoEditTitleTemplateLibrary'
import { applyTitleTemplate, editTitleTemplateSelection, saveTitleTemplateSelection, writeTitleTemplateDrag } from '../application/videoEditTitleTemplates'
import { confirmTitleFromDescription } from '../application/videoEditTitleDescription'

function VideoEditTitleTemplatesPanelContent({ instance, onError }: { instance: VideoEditInstance; visible?: boolean; onError: (error: unknown) => void }): React.ReactElement {
  const templates = useTitleTemplateLibrary(state => state.templates); const loadError = useTitleTemplateLibrary(state => state.error)
  const [query, setQuery] = useState(''); const [selected, setSelected] = useState('title:lower_third'); const [parameters, setParameters] = useState(titleTemplateParametersSchema.parse({ text: '姓名', subtitle: '身份 / 职务' }))
  const [changes, setChanges] = useState<Partial<TitleTemplateParameters>>({}); const [name, setName] = useState('我的标题'); const [description, setDescription] = useState(() => parseLegacyPromptString('')); const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController>(); const projectId = instance.document.id; const sequence = getActiveVideoEditSequence(instance)
  useEffect(() => () => abort.current?.abort(), [instance, sequence.id])
  const entries = listTitleTemplates().filter(template => template.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const selectedTemplate = listTitleTemplates().find(template => template.id === selected)
  const edits = Object.fromEntries(Object.entries(changes).filter(([key]) => ['text', 'subtitle', 'color', 'textColor', 'font', 'durationSeconds'].includes(key))) as Partial<TitleTemplateParameters>
  const choose = (id: string): void => { setSelected(id); setParameters(requireTitleTemplate(id).parameters); setChanges({}) }
  const change = <K extends keyof TitleTemplateParameters>(key: K, value: TitleTemplateParameters[K]): void => { setParameters(previous => ({ ...previous, [key]: value })); setChanges(previous => ({ ...previous, [key]: value })) }
  const run = (action: () => void): void => { try { if (requireVideoEditInstance(projectId) !== instance) throw new Error('原剪辑已关闭。'); action() } catch (error) { onError(error) } }
  const apply = (id = selected): void => run(() => { applyTitleTemplate(projectId, sequence.id, id, id === selected ? changes : {}) })
  const generate = async (): Promise<void> => {
    const controller = new AbortController(); abort.current = controller; setBusy(true)
    try { await confirmTitleFromDescription(projectId, sequence.id, { description: toPromptPlainText(description) }, controller.signal) }
    catch (error) { if (!controller.signal.aborted) onError(error) }
    finally { if (abort.current === controller) { abort.current = undefined; setBusy(false) } }
  }
  const renderEntry = (template: (typeof entries)[number]): React.ReactElement => <UiOptionButton key={template.id} variant="tile" active={selected === template.id} className="min-w-0 w-full" draggable onDragStart={event => run(() => writeTitleTemplateDrag(event.dataTransfer, template.id))} onClick={() => choose(template.id)} onDoubleClick={() => apply(template.id)} aria-label={template.name}><span className="truncate">{template.name}</span></UiOptionButton>
  return <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3" data-video-edit-title-templates>
    {loadError && <UiError size="sm" message={loadError} />}
    <UiSearchInput aria-label="搜索标题模板" value={query} onChange={event => setQuery(event.target.value)} />
    <UiGroup title="标题模板" titleTone="compact">
      {entries.length ? entries.length <= 24 ? <div className="grid grid-cols-2 gap-2">{entries.map(renderEntry)}</div> : <VirtuosoGrid className="h-60" data={entries} listClassName="grid grid-cols-2 gap-2" computeItemKey={(_index, template) => template.id} itemContent={(_index, template) => renderEntry(template)} /> : <UiEmpty size="xs" title="没有匹配的模板" />}
    </UiGroup>
    <UiGroup title="模板参数" titleTone="compact">
      <UiFormRow label="文字" density="compact"><UiTextArea aria-label="标题文字" value={parameters.text} onChange={event => change('text', event.target.value)} rows={3} /></UiFormRow>
      <UiFormRow label="副标题" density="compact"><UiInput size="sm" aria-label="标题副标题" value={parameters.subtitle} onChange={event => change('subtitle', event.target.value)} /></UiFormRow>
      <UiFormRow label="图形颜色" density="compact"><UiColorInput aria-label="标题图形颜色" value={parameters.color} onChange={event => change('color', event.target.value)} /></UiFormRow>
      <UiFormRow label="文字颜色" density="compact"><UiColorInput aria-label="标题文字颜色" value={parameters.textColor} onChange={event => change('textColor', event.target.value)} /></UiFormRow>
      <UiFormRow label="字体" density="compact"><Dropdown<TitleTemplateParameters['font']> ariaLabel="标题字体" value={parameters.font} size="sm" options={[{ value: 'sans-serif', label: '无衬线' }, { value: 'serif', label: '衬线' }, { value: 'monospace', label: '等宽' }]} onSelect={value => change('font', value)} /></UiFormRow>
      <UiFormRow label="时长（秒）" density="compact"><NumberInput ariaLabel="标题时长" size="sm" value={parameters.durationSeconds} min={.5} max={60} step={.5} onChange={value => change('durationSeconds', value)} /></UiFormRow>
      {selectedTemplate?.kind && <UiFormRow label="入场" density="compact"><Dropdown<TitleTemplateParameters['entrance']> ariaLabel="标题入场" value={parameters.entrance} size="sm" options={[{ value: 'left', label: '左侧滑入' }, { value: 'up', label: '向上滑入' }, { value: 'fade', label: '淡入' }]} onSelect={value => change('entrance', value)} /></UiFormRow>}
      {selected === 'title:counter' && <><UiFormRow label="起始数字" density="compact"><NumberInput ariaLabel="起始数字" value={parameters.countFrom} min={-999999} max={999999} onChange={value => change('countFrom', Math.round(value))} /></UiFormRow><UiFormRow label="结束数字" density="compact"><NumberInput ariaLabel="结束数字" value={parameters.countTo} min={-999999} max={999999} onChange={value => change('countTo', Math.round(value))} /></UiFormRow></>}
      <div className="flex flex-wrap gap-2"><UiButton variant="primary" size="sm" disabled={Boolean(loadError) && !selected.startsWith('title:')} onClick={() => apply()}>添加到播放头</UiButton><UiButton size="sm" disabled={!instance.selectedClipIds.length || !Object.keys(edits).length} onClick={() => run(() => { editTitleTemplateSelection(projectId, sequence.id, instance.selectedClipIds, edits); setChanges({}) })}>修改所选标题</UiButton></div>
    </UiGroup>
    <UiGroup title="另存为模板" titleTone="compact"><UiFormRow label="名称" density="compact"><UiInput aria-label="模板名称" size="sm" value={name} onChange={event => setName(event.target.value)} /></UiFormRow><UiButton size="sm" disabled={!instance.selectedClipIds.length || Boolean(loadError) || templates.length >= 128} onClick={() => run(() => { const saved = saveTitleTemplateSelection(projectId, sequence.id, instance.selectedClipIds, name); choose(saved.id) })}>保存所选文字 / 图形组合</UiButton></UiGroup>
    <UiGroup title="描述生成" titleTone="compact"><PromptEditor preset="plain" layout="fill-scroll" ariaLabel="标题动画描述" value={description} onChange={setDescription} placeholder="科技感蓝色的人名条，左侧滑入" editorClassName="min-h-24 max-h-60" /><div className="flex gap-2"><UiButton size="sm" disabled={busy || !toPromptPlainText(description).trim()} onClick={() => { void generate() }}>{busy ? '生成中…' : '生成并添加'}</UiButton>{busy && <UiButton size="sm" onClick={() => abort.current?.abort()}>取消</UiButton>}</div></UiGroup>
  </div>
}

export function VideoEditTitleTemplatesPanel(props: Parameters<typeof VideoEditTitleTemplatesPanelContent>[0]): React.ReactElement {
  return props.instance.activeSequenceId ? <VideoEditTitleTemplatesPanelContent {...props} /> : <UiEmpty className="h-full" title="没有序列" />
}
