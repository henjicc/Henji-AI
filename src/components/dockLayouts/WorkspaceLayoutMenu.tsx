import { useState } from 'react'
import type { DockviewApi } from 'dockview-react'
import { Check, LayoutPanelLeft, Pencil, RotateCcw, Save, SaveAll, Trash2 } from 'lucide-react'
import { PanelTrigger, UiButton, UiInlineStatus, UiInput, UiOptionButton } from '@/components/ui'
import { UI_ICON_SIZE } from '@/core/theme/icons'
import { useWorkspaceLayoutPresets } from './useWorkspaceLayoutPresets'

type Editing = { kind: 'save' | 'rename'; name: string } | null

/**
 * 命令带右上角的“工作区”菜单（参照 Adobe）：上面是布局预设（内置在前、自己存的在后），下面是对当前布局的动作。
 * 只组合现有菜单控件；预设状态与保存逻辑全在共享布局服务里，各工作区不维护第二份。
 */
export function WorkspaceLayoutMenu({ workspaceId, dockApi }: { workspaceId: string; dockApi?: DockviewApi | null }): JSX.Element {
  const layouts = useWorkspaceLayoutPresets(workspaceId, dockApi)
  const [editing, setEditing] = useState<Editing>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const close = (): void => setOpen(false)
  const active = layouts.presets.find(preset => preset.id === layouts.activeId)
  const builtin = layouts.presets.filter(preset => preset.builtin)
  const custom = layouts.presets.filter(preset => !preset.builtin)
  const run = (action: () => Promise<unknown>, close?: () => void): void => {
    setBusy(true); setError(null)
    void action().then(() => { setEditing(null); close?.() }, reason => setError(reason instanceof Error ? reason.message : '布局操作没有完成')).finally(() => setBusy(false))
  }
  const iconSize = UI_ICON_SIZE.sm
  const presetItem = (preset: typeof layouts.presets[number]) => <UiOptionButton key={preset.id} role="menuitemradio" aria-checked={preset.id === layouts.activeId}
    variant="menu" size="sm" active={preset.id === layouts.activeId} disabled={busy || !layouts.ready} onClick={() => run(() => layouts.apply(preset.id), close)}>
    <span className="flex w-full items-center gap-2">
      <span className="flex w-3.5 shrink-0 justify-center">{preset.id === layouts.activeId ? <Check size={iconSize} aria-hidden="true" /> : null}</span>
      <span className="min-w-0 flex-1 truncate">{preset.name}</span>
      {preset.id === layouts.activeId && layouts.dirty ? <span className="shrink-0 text-xs text-text3">已调整</span> : null}
    </span>
  </UiOptionButton>
  const actionItem = (key: string, icon: JSX.Element, label: string, onClick: () => void, options: { danger?: boolean; disabled?: boolean } = {}) => <UiOptionButton key={key} role="menuitem" variant="menu" size="sm"
    disabled={busy || !layouts.ready || options.disabled} onClick={onClick}>
    <span className={`flex w-full items-center gap-2 ${options.danger ? 'text-danger-text' : ''}`}><span className="flex w-3.5 shrink-0 justify-center">{icon}</span><span className="min-w-0 flex-1 truncate">{label}</span></span>
  </UiOptionButton>
  const submit = () => {
    if (!editing) return
    const name = editing.name.trim()
    if (!name) { setError('请输入布局名称'); return }
    run(() => editing.kind === 'save' ? layouts.saveAs(name) : layouts.rename(layouts.activeId, name), close)
  }

  return <PanelTrigger panelSize="menu" panelPadding="menu" open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setEditing(null); setError(null) } }} renderPanel={() => (
    <div className="flex flex-col" role="menu" aria-label="工作区布局">
      <div className="flex flex-col gap-0.5">{builtin.map(preset => presetItem(preset))}</div>
      {custom.length > 0 && <div className="mt-1 flex flex-col gap-0.5 border-t border-line pt-1">{custom.map(preset => presetItem(preset))}</div>}
      <div className="mt-1 flex flex-col gap-0.5 border-t border-line pt-1">
        {actionItem('reset', <RotateCcw size={iconSize} />, `重置为“${active?.name ?? '默认'}”`, () => run(layouts.resetActive, close), { disabled: !layouts.dirty })}
        {active && !active.builtin && actionItem('overwrite', <Save size={iconSize} />, `保存到“${active.name}”`, () => run(() => layouts.overwrite(), close), { disabled: !layouts.dirty })}
        {actionItem('save-as', <SaveAll size={iconSize} />, '将当前布局另存为…', () => { setError(null); setEditing({ kind: 'save', name: '' }) })}
        {active && !active.builtin && actionItem('rename', <Pencil size={iconSize} />, '重命名…', () => { setError(null); setEditing({ kind: 'rename', name: active.name }) })}
        {active && !active.builtin && actionItem('remove', <Trash2 size={iconSize} />, `删除“${active.name}”`, () => run(() => layouts.remove(layouts.activeId), close), { danger: true })}
      </div>
      {editing && <form className="mt-1 flex items-center gap-1.5 border-t border-line px-1 pt-2" onSubmit={(event) => { event.preventDefault(); submit() }}>
        <UiInput size="sm" autoFocus aria-label={editing.kind === 'save' ? '新布局名称' : '布局名称'} placeholder="例如：我的口播布局" value={editing.name}
          onChange={(event) => setEditing({ ...editing, name: event.target.value })} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setEditing(null) } }} />
        <UiButton size="sm" variant="secondary" type="submit" disabled={busy} disabledReason="正在保存">{editing.kind === 'save' ? '保存' : '改名'}</UiButton>
      </form>}
      {layouts.error && layouts.ready && <div className="mt-1 border-t border-line pt-1">{actionItem('retry', <RotateCcw size={iconSize} />, '重试保存布局', () => run(layouts.retrySave))}</div>}
      {(error || layouts.error) && <UiInlineStatus role="alert" className="mt-1 px-2">{error || layouts.error}</UiInlineStatus>}
    </div>
  )}>
    {({ togglePanel }) => <UiButton size="md" aria-haspopup="menu" aria-expanded={open} onClick={togglePanel} data-panel-trigger-button>
      <LayoutPanelLeft className="mr-1" />{active?.name ?? '工作区'}{layouts.dirty ? <span aria-label="已调整" className="ml-1 h-1.5 w-1.5 rounded-full bg-accent" /> : null}
    </UiButton>}
  </PanelTrigger>
}
