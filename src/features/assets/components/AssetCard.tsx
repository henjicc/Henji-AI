import React, { useState } from 'react'
import { AlertTriangle, FileAudio, Film, Image as ImageIcon, MoreHorizontal, Play } from 'lucide-react'
import { UiIconButton, UiInput, UiPanel } from '@/components/ui'
import { clearCompactDragPreview, setCompactDragPreview, setCompactWaveformDragPreview } from '@/contexts/dragDataTransfer'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { assetRecordToDragPayload, writeAssetDragPayload } from '../drag/assetDragPayload'
import Waveform from '@/components/Waveform'
import { useAudioWaveform } from '@/hooks/useAudioWaveform'
import { useI18n } from '@/hooks/useI18n'

interface AssetCardProps {
  asset: AssetRecord
  selected: boolean
  eager?: boolean
  onSelect: (asset: AssetRecord) => void
  onMenu: (asset: AssetRecord, anchor: DOMRect) => void
  onPreview: (asset: AssetRecord) => void
  onRename: (asset: AssetRecord, name: string) => Promise<void>
  thumbnailFit: 'cover' | 'contain'
}

const mediaIcons = { image: ImageIcon, video: Film, audio: FileAudio }

function selectThumbnailWaveform(samples: number[] | null): number[] | null {
  if (!samples || samples.length <= 72) return samples
  const windowSize = 72
  let bestStart = 0
  let bestEnergy = -1
  for (let start = 0; start <= samples.length - windowSize; start += 12) {
    let energy = 0
    for (let index = start; index < start + windowSize; index += 1) energy += samples[index]
    if (energy > bestEnergy) { bestEnergy = energy; bestStart = start }
  }
  return samples.slice(bestStart, bestStart + windowSize)
}

export const AssetCard: React.FC<AssetCardProps> = ({ asset, selected, eager = false, onSelect, onMenu, onPreview, onRename, thumbnailFit }) => {
  const { t } = useI18n('ui')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(asset.displayName)
  const MediaIcon = mediaIcons[asset.mediaType]
  const previewUrl = asset.thumbnailUrl ?? (asset.mediaType === 'image' ? asset.displayUrl : null)
  const isAudio = asset.mediaType === 'audio'
  const { waveform } = useAudioWaveform(isAudio ? asset.displayUrl : '', isAudio ? asset.filePath : undefined, { width: 240, compact: true, duration: asset.durationSeconds ?? undefined })
  const thumbnailWaveform = selectThumbnailWaveform(waveform)
  const submitRename = async (): Promise<void> => {
    const name = draft.trim()
    if (name && name !== asset.displayName) await onRename(asset, name)
    setEditing(false)
  }
  return (
    <UiPanel
      draggable={asset.inspectionStatus !== 'missing'}
      onDragStart={(event) => {
        writeAssetDragPayload(event.dataTransfer, assetRecordToDragPayload(asset))
        if (isAudio) setCompactWaveformDragPreview(event.dataTransfer, thumbnailWaveform)
        else setCompactDragPreview(event.dataTransfer, previewUrl)
      }}
      onDragEnd={clearCompactDragPreview}
      className={`group relative min-w-0 cursor-pointer overflow-hidden border transition-colors ${selected ? 'border-accent' : 'border-border-dark hover:border-text-muted'}`}
      onClick={() => onSelect(asset)}
    >
      <div className="relative aspect-square bg-layer" onDoubleClick={(event) => { event.stopPropagation(); onPreview(asset) }}>
        {isAudio && thumbnailWaveform ? (
          <div className="pointer-events-none flex h-full items-center px-4"><Waveform samples={thumbnailWaveform} width={240} height={72} duration={asset.durationSeconds ?? 0} /></div>
        ) : previewUrl ? (
          <img src={previewUrl} alt={asset.displayName} loading={eager ? 'eager' : 'lazy'} draggable={false} className={`h-full w-full ${thumbnailFit === 'contain' ? 'object-contain' : 'object-cover'}`} />
        ) : (
          <div className="flex h-full items-center justify-center text-text-muted"><MediaIcon className="h-10 w-10" /></div>
        )}
        {asset.inspectionStatus === 'missing' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-amber-300"><AlertTriangle className="h-7 w-7" /></div>
        )}
        <UiIconButton
          aria-label="menu"
          className="absolute right-1.5 top-1.5 !h-7 !w-7 opacity-0 group-hover:opacity-100"
          onClick={(event) => { event.stopPropagation(); onMenu(asset, event.currentTarget.getBoundingClientRect()) }}
        ><MoreHorizontal className="h-4 w-4" /></UiIconButton>
        {asset.mediaType !== 'image' && <UiIconButton showBorder={false} aria-label={t('audioPlayer.playPause')} className="absolute left-1/2 top-1/2 !h-10 !w-10 -translate-x-1/2 -translate-y-1/2 !bg-black/45 !text-white backdrop-blur-md hover:!bg-black/60" onClick={(event) => { event.stopPropagation(); onPreview(asset) }}><Play className="h-4 w-4" /></UiIconButton>}
      </div>
      <div className="min-w-0 px-2.5 py-2">
        {editing ? <UiInput autoFocus className="!h-7 !px-1.5 text-sm" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => void submitRename()} onKeyDown={(event) => { if (event.key === 'Enter') void submitRename(); if (event.key === 'Escape') { setDraft(asset.displayName); setEditing(false) } }} onClick={(event) => event.stopPropagation()} /> : <div className="truncate text-sm text-text-dark" title="双击重命名" onDoubleClick={(event) => { event.stopPropagation(); setDraft(asset.displayName); setEditing(true) }}>{asset.displayName}</div>}
        <div className="mt-1 flex items-center justify-between text-[11px] text-text-muted">
          <span className="flex min-w-0 items-center gap-1"><span className="rounded bg-layer px-1.5 py-0.5">{t(`assetLibrary.${asset.mediaType}`)}</span>{asset.tags[0] && <span className="max-w-20 truncate rounded bg-layer px-1.5 py-0.5">{asset.tags[0]}</span>}{asset.tags.length > 1 && <span>+{asset.tags.length - 1}</span>}</span><span>{asset.width && asset.height ? `${asset.width}×${asset.height}` : ''}</span>
        </div>
      </div>
    </UiPanel>
  )
}
