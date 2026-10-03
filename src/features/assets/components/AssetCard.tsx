import React, { useEffect, useState } from 'react'
import { AlertTriangle, FileAudio, Film, Image as ImageIcon, MoreHorizontal, Play } from 'lucide-react'
import { ICON_ASSET_CODE } from '@/core/theme/icons'
import { UI_GLASS_ADAPTIVE_CONTROL_CLASS, UI_GLASS_ADAPTIVE_SURFACE_CLASS, UI_TEXT_BODY_CLASS, UI_TEXT_META_CLASS, UiCheckbox, UiIconButton, UiInput, UiPanel } from '@/components/ui'
import { clearCompactDragPreview, setCompactDragPreview, setCompactWaveformDragPreview } from '@/contexts/dragDataTransfer'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { assetRecordToDragPayload, writeAssetDragPayload, writeCodeAssetDrag } from '../drag/assetDragPayload'
import { WaveformView } from '@/components/waveform/WaveformView'
import { useWaveformData } from '@/hooks/useWaveformData'
import { useI18n } from '@/hooks/useI18n'

interface AssetCardProps {
  asset: AssetRecord
  selected: boolean
  eager?: boolean
  onSelect: (asset: AssetRecord) => void
  menuOpen?: boolean
  batchMode?: boolean
  batchSelected?: boolean
  batchDisabled?: boolean
  onMenu: (asset: AssetRecord, anchor: AssetMenuAnchor, toggle?: boolean) => void
  onToggleBatch?: (asset: AssetRecord) => void
  onPreview: (asset: AssetRecord) => void
  onRename: (asset: AssetRecord, name: string) => Promise<void>
  thumbnailFit: 'cover' | 'contain'
}

export interface AssetMenuAnchor {
  left: number
  right: number
  top: number
  bottom: number
  width: number
}

const mediaIcons = { image: ImageIcon, video: Film, audio: FileAudio, code: ICON_ASSET_CODE }

export const AssetCard: React.FC<AssetCardProps> = ({ asset, selected, eager = false, menuOpen = false, batchMode = false, batchSelected = false, batchDisabled = false, onSelect, onMenu, onToggleBatch, onPreview, onRename, thumbnailFit }) => {
  const { t } = useI18n('ui')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(asset.displayName)
  const MediaIcon = mediaIcons[asset.mediaType]
  const previewUrl = asset.mediaType === 'code' ? null : asset.thumbnailUrl ?? (asset.mediaType === 'image' ? asset.displayUrl : null)
  const isAudio = asset.mediaType === 'audio'
  const waveformSource = isAudio ? asset.filePath?.trim() || asset.displayUrl : ''
  const waveform = useWaveformData(waveformSource ? { source: waveformSource, channels: 1 } : null)
  useEffect(() => { if (batchMode) setEditing(false) }, [batchMode])
  const submitRename = async (): Promise<void> => {
    const name = draft.trim()
    if (name && name !== asset.displayName) await onRename(asset, name)
    setEditing(false)
  }
  return (
    <UiPanel
      data-asset-card
      data-asset-id={asset.id}
      data-asset-kind={asset.mediaType}
      variant="bare"
      draggable={!batchMode && asset.inspectionStatus !== 'missing'}
      onDragStart={(event) => {
        if (asset.mediaType === 'code') writeCodeAssetDrag(event.dataTransfer, asset.id)
        else writeAssetDragPayload(event.dataTransfer, assetRecordToDragPayload(asset))
        if (isAudio) setCompactWaveformDragPreview(event.dataTransfer, waveform.data)
        else setCompactDragPreview(event.dataTransfer, previewUrl)
      }}
      onDragEnd={clearCompactDragPreview}
      className={`group relative min-w-0 cursor-pointer overflow-hidden border transition-colors ${UI_GLASS_ADAPTIVE_SURFACE_CLASS} ${selected || batchSelected ? 'border-accent' : 'border-border-dark hover:border-text-muted'}`}
      onClick={() => { if (batchMode) { if (!batchDisabled) onToggleBatch?.(asset) } else onSelect(asset) }}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onMenu(asset, { left: event.clientX, right: event.clientX, top: event.clientY, bottom: event.clientY, width: 0 })
      }}
    >
      <div className="relative aspect-square bg-layer" onDoubleClick={(event) => { event.stopPropagation(); onPreview(asset) }}>
        {isAudio && waveform.data ? (
          <div className="pointer-events-none flex h-full items-center px-4"><WaveformView waveform={waveform} tier="mini" height={72} className="w-full" /></div>
        ) : previewUrl ? (
          <img src={previewUrl} alt={asset.displayName} loading={eager ? 'eager' : 'lazy'} draggable={false} className={`h-full w-full ${thumbnailFit === 'contain' ? 'object-contain' : 'object-cover'}`} />
        ) : (
          <div className="flex h-full items-center justify-center text-text-muted"><MediaIcon className="h-10 w-10" /></div>
        )}
        {asset.inspectionStatus === 'missing' && (
          <div className="ui-glass-scrim absolute inset-0 flex items-center justify-center text-amber-300"><AlertTriangle className="h-7 w-7" /></div>
        )}
        {batchMode && (
          <UiCheckbox
            checked={batchSelected}
            disabled={batchDisabled}
            aria-label={t('assetLibrary.batchManage')}
            className="absolute left-1.5 top-1.5 z-raised !h-7 !w-7 bg-panel/95"
            onClick={(event) => event.stopPropagation()}
            onCheckedChange={() => { if (!batchDisabled) onToggleBatch?.(asset) }}
          />
        )}
        <UiIconButton tone="media"
          data-ui-shared-glass="exclude"
          data-asset-card-menu-trigger
          aria-label="menu"
          className={`absolute right-1.5 top-1.5 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 ${menuOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={(event) => { event.stopPropagation(); onMenu(asset, event.currentTarget.getBoundingClientRect(), true) }}
        ><MoreHorizontal className="h-4 w-4" /></UiIconButton>
        {(asset.mediaType === 'video' || asset.mediaType === 'audio') && <UiIconButton shape="circle" size="xl" tone="media" aria-label={t('audioPlayer.playPause')} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" onClick={(event) => { event.stopPropagation(); onPreview(asset) }}><Play className="h-4 w-4" /></UiIconButton>}
      </div>
      <div className="min-w-0 px-2.5 py-2">
        {editing ? <UiInput autoFocus className="!h-7 !px-1.5 text-sm" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => void submitRename()} onKeyDown={(event) => { if (event.key === 'Enter') void submitRename(); if (event.key === 'Escape') { setDraft(asset.displayName); setEditing(false) } }} onClick={(event) => event.stopPropagation()} /> : <div className={`truncate ${UI_TEXT_BODY_CLASS}`} title={t('assetLibrary.renameAsset')} onDoubleClick={(event) => { if (batchMode) return; event.stopPropagation(); setDraft(asset.displayName); setEditing(true) }}>{asset.displayName}</div>}
        <div className={`mt-1 flex items-center justify-between ${UI_TEXT_META_CLASS}`}>
          <span className="flex min-w-0 items-center gap-1"><span className={`rounded bg-layer px-1.5 py-0.5 text-text-dark ${UI_GLASS_ADAPTIVE_CONTROL_CLASS}`}>{t(`assetLibrary.${asset.mediaType}`)}</span>{asset.tags[0] && <span className={`max-w-20 truncate rounded bg-layer px-1.5 py-0.5 text-text-dark ${UI_GLASS_ADAPTIVE_CONTROL_CLASS}`}>{asset.tags[0]}</span>}{asset.tags.length > 1 && <span>+{asset.tags.length - 1}</span>}</span><span>{asset.width && asset.height ? `${asset.width}×${asset.height}` : ''}</span>
        </div>
      </div>
    </UiPanel>
  )
}
