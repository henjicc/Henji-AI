import { useEffect, useState } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { UiGroup, UiOptionButton, UiButton, UiFormRow, UiInput, UiTextAreaField, UiError, UiLoading } from '@/components/ui'
import { componentSourceMetadata, type CodeComponent } from '@/core/videoEdit/codeMaterial/components'
import { projectCodeComponents, publishProjectCodeComponent, withdrawProjectCodeComponents } from '../application/videoEditCodeStorage'
import type { CodeComponentVersion } from '@/core/videoEdit/codeMaterial/components'
import { subscribeVideoEditDomain } from '../application/videoEditService'

export function ProjectCodeComponents({ projectId, file, source, module, onImport }: { projectId: string; file: string; source: string; module: boolean; onImport: (statement: string) => void }): React.ReactElement {
  const [components, setComponents] = useState<CodeComponent[]>([])
  const [selected, setSelected] = useState<string>()
  const [publishing, setPublishing] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [lastPublication, setLastPublication] = useState<CodeComponentVersion>()
  useEffect(() => {
    let live = true; let generation = 0
    const refresh = (): void => {
      const current = ++generation
      void projectCodeComponents(projectId).then(values => { if (live && current === generation) setComponents(values) }).catch(reason => { if (live && current === generation) setError(reason instanceof Error ? reason.message : '项目组件未能读取，请重试。') })
    }
    refresh(); const stop = subscribeVideoEditDomain(refresh)
    return () => { live = false; stop() }
  }, [projectId])
  const selectedComponent = components.find(component => component.name === selected)
  const version = selectedComponent?.versions.find(version => version.version === selectedComponent.latestVersion)
  const publish = async (): Promise<void> => {
    setBusy(true); setError(undefined)
    try {
      const version = await publishProjectCodeComponent(projectId, { name, source, description })
      setComponents(await projectCodeComponents(projectId)); setSelected(version.name); setPublishing(false); setLastPublication(version)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '项目组件发布失败，请修改后重试。') }
    finally { setBusy(false) }
  }
  const undoPublication = async (): Promise<void> => {
    if (!lastPublication) return
    setBusy(true); setError(undefined)
    try { await withdrawProjectCodeComponents(projectId, [lastPublication]); setComponents(await projectCodeComponents(projectId)); setLastPublication(undefined) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '组件发布未能撤回，请重试。') }
    finally { setBusy(false) }
  }
  const row = (component: CodeComponent): React.ReactElement => <UiOptionButton variant="menu" role="option" active={selected === component.name} aria-selected={selected === component.name} className="w-full" onClick={() => setSelected(component.name)}>{component.name} · 第 {component.latestVersion} 版</UiOptionButton>
  return <UiGroup divided title="项目组件" titleTone="compact" gap="row">
    <div role="listbox" aria-label="项目组件" className="max-h-40 overflow-auto">
      {components.length > 50 ? <div className="h-40"><Virtuoso data={components} itemContent={(_index, component) => row(component)} /></div> : components.map(component => <div key={component.name}>{row(component)}</div>)}
    </div>
    {!components.length && !error && <span className="text-xs text-text3">发布模块后，本项目的所有剪辑都能导入使用。</span>}
    {version && <UiGroup gap="row">
      {version.description && <span className="text-xs text-text2">{version.description}</span>}
      <span className="text-xs text-text3">导出：{version.exports.join('、')}</span>
      <UiTextAreaField aria-label="项目组件源码" rows={6} readOnly className="font-mono" value={componentSourceMetadata(version.source).source} />
      <UiButton disabled={!version.exports.length} onClick={() => onImport(`import { ${version.exports.join(', ')} } from ${JSON.stringify(`@组件/${version.name}`)};\n`)}>插入导入语句</UiButton>
    </UiGroup>}
    {module && <UiButton disabled={busy} onClick={() => { setPublishing(true); setName(file.split('/').at(-1)!.replace(/\.ts$/, '')); setDescription(''); setError(undefined) }}>发布为项目组件</UiButton>}
    {lastPublication && <UiButton disabled={busy} onClick={() => { void undoPublication() }}>撤回本次发布</UiButton>}
    {publishing && <UiGroup gap="row">
      <UiFormRow density="compact" label="组件名称"><UiInput aria-label="组件名称" value={name} disabled={busy} onChange={event => setName(event.target.value)} /></UiFormRow>
      <UiFormRow density="compact" label="说明"><UiInput aria-label="组件说明" value={description} disabled={busy} onChange={event => setDescription(event.target.value)} /></UiFormRow>
      <span className="text-xs text-text3">相同名称会发布新版本，已有素材仍使用原版本。</span>
      <div className="flex items-center gap-2"><UiButton variant="secondary" disabled={busy || !name.trim()} onClick={() => { void publish() }}>发布组件</UiButton><UiButton disabled={busy} onClick={() => setPublishing(false)}>取消</UiButton></div>
    </UiGroup>}
    {busy && <UiLoading size="xs" message="正在检查并发布组件" />}
    {error && <UiError size="xs" align="start" title={error} message="" />}
  </UiGroup>
}
