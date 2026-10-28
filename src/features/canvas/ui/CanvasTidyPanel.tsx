import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
import { useEffect } from 'react'
import { Pin, X } from 'lucide-react'
import { Virtuoso } from 'react-virtuoso'
import { useTranslation } from 'react-i18next'
import { Dropdown, UiButton, UiError, UiFormRow, UiGroup, UiIconButton, UiOptionButton, UiPanel } from '@/components/ui'
import { UI_TEXT_BODY_CLASS, UI_TEXT_META_CLASS } from '@/components/ui/styleTokens'
import type { CanvasNode } from '../domain/canvasNodes'
import { resolveNodeDisplayName } from '../domain/nodeDisplay'
import type { useCanvasTidy } from '../hooks/useCanvasTidy'

type Props = { tidy: ReturnType<typeof useCanvasTidy>; nodes: CanvasNode[] }
export function CanvasTidyPanel({ tidy, nodes }: Props) {
  const { t } = useTranslation('ui')
  const { draft, cancel } = tidy
  useEffect(() => {
    if (!draft) return
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); cancel() } }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [draft, cancel])
  if (!draft) return null
  const selected = new Set(draft.nodeIds)
  const choices = nodes.filter(n => selected.has(n.id) && n.draggable !== false)
  const name = (node: CanvasNode) => node.type ? resolveNodeDisplayName(node.type, node.data) : t('canvasTidy.unnamed')
  const pinned = choices.find(n => n.id === draft.pin)
  return <UiPanel variant="glass" className="absolute right-4 top-4 z-popover flex w-80 max-w-full flex-col gap-3 p-3" data-canvas-tidy-panel>
    <div className="flex items-center justify-between gap-2">
      <span className={UI_TEXT_BODY_CLASS}>{t('canvasTidy.title')}</span>
      <UiIconButton aria-label={t('canvasTidy.cancel')} onClick={cancel}><X  /></UiIconButton>
    </div>
    <div className="flex flex-col gap-1">
      {draft.candidates.map(candidate => <UiOptionButton key={candidate.mode} variant="menu"
        active={tidy.mode === candidate.mode} onClick={() => tidy.setMode(candidate.mode)}>
        {t(`canvasTidy.${candidate.mode}`)}
      </UiOptionButton>)}
    </div>
    <UiGroup labelWidth={96}>
    <UiFormRow label={t('canvasTidy.pin')} density="compact">
    <Dropdown surface="glass" panelPadding="menu" ariaLabel={t('canvasTidy.pin')}
      display={pinned ? name(pinned) : t('canvasTidy.noPin')}
      renderPanel={() => <div className="h-60 w-64">
        <Virtuoso data={[null, ...choices]} itemContent={(_index, node) => <UiOptionButton variant="menu"
          active={draft.pin === (node?.id ?? null)} disabled={tidy.busy}
          onClick={() => { void tidy.start(node?.id ?? null) }}>
          <Pin className={`${UI_ICON_SIZE_CLASS.sm}`} />{node ? name(node) : t('canvasTidy.noPin')}
        </UiOptionButton>} />
      </div>} />
    </UiFormRow>
    </UiGroup>
    {tidy.candidate?.unavailable
      ? <UiError size="xs" message={tidy.candidate.unavailable} />
      : <span className={UI_TEXT_META_CLASS}>{t('canvasTidy.preview')}</span>}
    <div className="flex justify-end gap-2">
      <UiButton onClick={cancel}>{t('canvasTidy.cancel')}</UiButton>
      <UiButton variant="primary" disabled={tidy.busy || Boolean(tidy.candidate?.unavailable)} onClick={() => { void tidy.apply() }}>
        {t('canvasTidy.apply')}
      </UiButton>
    </div>
  </UiPanel>
}
