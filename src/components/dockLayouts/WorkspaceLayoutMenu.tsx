import { useState } from 'react'
import type { DockviewApi } from 'dockview-react'
import { PanelTrigger, UiButton, UiInput, UiOptionButton, UiInlineStatus } from '@/components/ui'
import { useWorkspaceLayoutPresets } from './useWorkspaceLayoutPresets'

/** 仅组合现有菜单控件；工作区不维护第二份预设状态或保存逻辑。 */
export function WorkspaceLayoutMenu({ workspaceId, dockApi }: { workspaceId: string; dockApi?: DockviewApi | null }): JSX.Element {
  const layouts = useWorkspaceLayoutPresets(workspaceId, dockApi)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const active = layouts.presets.find(p => p.id === layouts.activeId)
  const run = (action: () => Promise<unknown>): void => {
    setBusy(true); setError(null)
    void action().catch(reason => setError(reason instanceof Error ? reason.message : '布局操作失败')).finally(() => setBusy(false))
  }
  return <PanelTrigger panelSize="menu" panelPadding="menu" renderPanel={() => <div className="flex flex-col gap-1">
    {layouts.presets.map(preset => <UiOptionButton key={preset.id} variant="menu" active={preset.id === layouts.activeId}
      disabled={busy || !layouts.ready} onClick={() => run(() => layouts.apply(preset.id))}>{preset.name}</UiOptionButton>)}
    <UiInput aria-label="布局名称" placeholder="布局名称" value={name} onChange={event => setName(event.target.value)} />
    <UiButton disabled={busy || !layouts.ready || !name.trim()} onClick={() => run(() => layouts.saveAs(name))}>另存为</UiButton>
    {!active?.builtin && <>
      <UiButton disabled={busy || !name.trim()} onClick={() => run(() => layouts.rename(layouts.activeId, name))}>重命名</UiButton>
      <UiButton disabled={busy} onClick={() => run(() => layouts.overwrite())}>覆盖保存</UiButton>
      <UiButton disabled={busy} onClick={() => run(() => layouts.remove(layouts.activeId))}>删除预设</UiButton>
    </>}
    <UiButton disabled={busy || !layouts.ready} onClick={() => run(layouts.resetActive)}>重置为当前预设</UiButton>
    {layouts.error && layouts.ready && <UiButton disabled={busy} onClick={() => run(layouts.retrySave)}>重试保存</UiButton>}
    {(error || layouts.error) && <UiInlineStatus role="alert">{error || layouts.error}</UiInlineStatus>}
  </div>}>
    {({ open, togglePanel }) => <UiButton aria-expanded={open} data-panel-trigger-button onClick={togglePanel}>布局：{active?.name}{layouts.dirty ? '（已修改）' : ''}</UiButton>}
  </PanelTrigger>
}
