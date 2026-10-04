import React, { useEffect, useState } from 'react'
import { AlertTriangle, FileAudio, Film, Image as ImageIcon, MoreHorizontal, Play } from 'lucide-react'
import { ICON_ASSET_CODE } from '@/core/theme/icons'
import { UI_COVER_FRAME_CLASS, UI_COVER_GROUP_CLASS, UiCheckbox, UiIconButton, UiInput } from '@/components/ui'
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

/**
 * 资产卡（界面重设计 3.3）：与画布项目卡同一套封面语言——卡片本身无底无框，缩略图放在封面框里，
 * 悬停、单选与批量选中都只画在封面框上（`UI_COVER_FRAME_CLASS`）；下方名称一行 + 辅助信息一行
 * （类型 · 首个标签 +N · 尺寸）。根元素是可拖拽的 div（内部还有菜单、播放与复选框按钮，不能整体做成 button）。
 */
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
    <div
      data-asset-card
      data-asset-id={asset.id}
      data-asset-kind={asset.mediaType}
      data-selected={selected || batchSelected ? 'true' : 'false'}
      draggable={!batchMode && asset.inspectionStatus !== 'missing'}
      onDragStart={(event) => {
        if (asset.mediaType === 'code') writeCodeAssetDrag(event.dataTransfer, asset.id)
        else writeAssetDragPayload(event.dataTransfer, assetRecordToDragPayload(asset))
        if (isAudio) setCompactWaveformDragPreview(event.dataTransfer, waveform.data)
        else setCompactDragPreview(event.dataTransfer, previewUrl)
      }}
      onDragEnd={clearCompactDragPreview}
      className={`group ${UI_COVER_GROUP_CLASS} relative flex min-w-0 cursor-pointer flex-col gap-2`}
      onClick={() => { if (batchMode) { if (!batchDisabled) onToggleBatch?.(asset) } else onSelect(asset) }}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onMenu(asset, { left: event.clientX, right: event.clientX, top: event.clientY, bottom: event.clientY, width: 0 })
      }}
    >
      <div className={`${UI_COVER_FRAME_CLASS} aspect-square`} onDoubleClick={(event) => { event.stopPropagation(); onPreview(asset) }}>
        {isAudio && waveform.data ? (
          <div className="pointer-events-none flex h-full items-center px-4"><WaveformView waveform={waveform} tier="mini" height={72} className="w-full" /></div>
        ) : previewUrl ? (
          <img src={previewUrl} alt={asset.displayName} loading={eager ? 'eager' : 'lazy'} draggable={false} className={`h-full w-full ${thumbnailFit === 'contain' ? 'object-contain' : 'object-cover'}`} />
        ) : (
          <div className="flex h-full items-center justify-center text-text3"><MediaIcon className="h-8 w-8" /></div>
        )}
        {asset.inspectionStatus === 'missing' && (
          <div className="ui-glass-scrim absolute inset-0 flex items-center justify-center text-warning-text"><AlertTriangle className="h-7 w-7" /></div>
        )}
        {batchMode && (
          <UiCheckbox
            checked={batchSelected}
            disabled={batchDisabled}
            aria-label={t('assetLibrary.batchManage')}
            className="absolute left-2 top-2 z-raised"
            onClick={(event) => event.stopPropagation()}
            onCheckedChange={() => { if (!batchDisabled) onToggleBatch?.(asset) }}
          />
        )}
        <UiIconButton tone="media"
          data-ui-shared-glass="exclude"
          data-asset-card-menu-trigger
          aria-label="menu"
          className={`absolute right-2 top-2 transition-opacity duration-120 group-hover:opacity-100 focus-visible:opacity-100 ${menuOpen ? 'opacity-100' : 'opacity-0'}`}
          onClick={(event) => { event.stopPropagation(); onMenu(asset, event.currentTarget.getBoundingClientRect(), true) }}
        ><MoreHorizontal className="h-4 w-4" /></UiIconButton>
        {(asset.mediaType === 'video' || asset.mediaType === 'audio') && <UiIconButton shape="circle" size="xl" tone="media" aria-label={t('audioPlayer.playPause')} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" onClick={(event) => { event.stopPropagation(); onPreview(asset) }}><Play className="h-4 w-4" /></UiIconButton>}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 px-0.5">
        {editing ? <UiInput autoFocus size="sm" value={draft} aria-label={t('assetLibrary.renameAsset')} onChange={(event) => setDraft(event.target.value)} onBlur={() => void submitRename()} onKeyDown={(event) => { if (event.key === 'Enter') void submitRename(); if (event.key === 'Escape') { setDraft(asset.displayName); setEditing(false) } }} onClick={(event) => event.stopPropagation()} /> : <div className="truncate text-13 font-medium text-text1" title={t('assetLibrary.renameAsset')} onDoubleClick={(event) => { if (batchMode) return; event.stopPropagation(); setDraft(asset.displayName); setEditing(true) }}>{asset.displayName}</div>}
        <div className="flex min-w-0 items-center gap-1 text-xs text-text3">
          <span className="shrink-0">{t(`assetLibrary.${asset.mediaType}`)}</span>
          {asset.tags[0] && <><span aria-hidden="true">·</span><span className="min-w-0 truncate">{asset.tags[0]}</span></>}
          {asset.tags.length > 1 && <span className="shrink-0">+{asset.tags.length - 1}</span>}
          {asset.width && asset.height ? <span className="ml-auto shrink-0 pl-1 tabular-nums">{asset.width}×{asset.height}</span> : null}
        </div>
      </div>
    </div>
  )
}
