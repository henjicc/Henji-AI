import { useTranslation } from 'react-i18next'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { ArrowDownToLine, Copy, Plus, Trash2 } from 'lucide-react'
import { Virtuoso } from 'react-virtuoso'
import { UiEmpty, UiError, UiIconButton, UiInput, UiOptionButton } from '@/components/ui'
import { createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditNamedRegionV3 } from '@/core/imageEdit/v3/namedRegions'
import type { ImageEditorV3Controller } from '../../editor/types'
import { useImageEditorSessionStoreV3 } from '../../store'

const subscribeEmpty = (): (() => void) => () => undefined

export function ImageEditorChannelsPanelV3({ controller }: { controller: ImageEditorV3Controller }): JSX.Element {
  const { t } = useTranslation('ui')
  const port = controller.regionPort
  const selection = useSyncExternalStore(listener => port?.subscribe(listener) ?? subscribeEmpty(), () => port?.getSnapshot().selection ?? null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const selected = controller.document.namedRegions.find(region => region.id === selectedId)
  useEffect(() => { if (selectedId && !selected) setSelectedId(null) }, [selectedId, selected])
  const run = (work: () => void): void => {
    try { work(); setError(null) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const write = (regions: ImageEditNamedRegionV3[]): void => {
    if (!controller.setNamedRegions) throw new Error(t('imageEditor.v3.channels.unavailable'))
    controller.setNamedRegions(regions)
  }
  const load = (region: ImageEditNamedRegionV3): void => {
    if (!port) throw new Error(t('imageEditor.v3.channels.loadUnavailable'))
    port.setSelection(structuredClone(region.selection))
    const store = useImageEditorSessionStoreV3.getState()
    if (controller.profile.tools.some(tool => tool.id === 'select-rect' && tool.readiness.state === 'ready')) store.setActiveTool(controller.sessionId, 'select-rect')
  }
  return <section data-channels-panel className="flex min-h-0 flex-1 flex-col">
    {error ? <UiError size="xs" message={error} /> : null}
    <div className="flex h-10 shrink-0 items-center gap-1 px-3">
      <UiIconButton size="sm" aria-label={t('imageEditor.v3.channels.save')} title={t('imageEditor.v3.channels.save')} disabled={!selection || !controller.setNamedRegions}
        onClick={() => run(() => {
          if (!selection) return
          const id = createImageEditIdV3('channel')
          write([...controller.document.namedRegions, { id, name: t('imageEditor.v3.channels.defaultName'), selection: structuredClone(selection) }]); setSelectedId(id)
        })}><Plus className="h-4 w-4" /></UiIconButton>
      <UiIconButton size="sm" aria-label={t('imageEditor.v3.channels.load')} title={t('imageEditor.v3.channels.load')} disabled={!selected}
        onClick={() => selected && run(() => load(selected))}><ArrowDownToLine className="h-4 w-4" /></UiIconButton>
      <UiIconButton size="sm" aria-label={t('imageEditor.v3.channels.update')} title={t('imageEditor.v3.channels.update')} disabled={!selected || !selection}
        onClick={() => run(() => { if (selected && selection) write(controller.document.namedRegions.map(region => region.id === selected.id ? { ...region, selection: structuredClone(selection) } : region)) })}><Copy className="h-4 w-4" /></UiIconButton>
      <UiIconButton size="sm" tone="danger" aria-label={t('imageEditor.v3.channels.delete')} title={t('imageEditor.v3.channels.delete')} disabled={!selected}
        onClick={() => run(() => { if (selected) write(controller.document.namedRegions.filter(region => region.id !== selected.id)) })}><Trash2 className="h-4 w-4" /></UiIconButton>
    </div>
    {selected ? <div className="px-3 pb-2"><ChannelName key={selected.id} region={selected} onCommit={name => run(() => write(controller.document.namedRegions.map(region => region.id === selected.id ? { ...region, name } : region)))} /></div> : null}
    {controller.document.namedRegions.length ? <Virtuoso data={controller.document.namedRegions} className="min-h-0 flex-1"
      computeItemKey={(_index, region) => region.id} initialItemCount={Math.min(12, controller.document.namedRegions.length)}
      itemContent={(_index, region) => <div className="flex h-11 items-center px-2" data-channel-id={region.id}>
        <UiOptionButton variant="menu" className="w-full min-w-0" active={selectedId === region.id}
          onClick={() => setSelectedId(region.id)} onDoubleClick={() => run(() => load(region))}>
          <span className="min-w-0 flex-1 truncate" title={region.name}>{region.name}</span>
        </UiOptionButton>
      </div>} /> : <UiEmpty size="sm" title={t('imageEditor.v3.channels.empty')} description={t('imageEditor.v3.channels.emptyDescription')} />}
  </section>
}

function ChannelName({ region, onCommit }: { region: ImageEditNamedRegionV3; onCommit: (name: string) => void }): JSX.Element {
  const { t } = useTranslation('ui')
  const [name, setName] = useState(region.name)
  useEffect(() => setName(region.name), [region.name])
  return <UiInput size="sm" aria-label={t('imageEditor.v3.channels.name')} value={name} onChange={event => setName(event.currentTarget.value)}
    onBlur={() => { const next = name.trim(); if (next && next !== region.name) onCommit(next); else setName(region.name) }}
    onKeyDown={event => {
      if (event.key === 'Enter') event.currentTarget.blur()
      if (event.key === 'Escape') { event.preventDefault(); setName(region.name) }
    }} />
}
