import { useId, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import Dropdown from '@/components/ui/Dropdown'
import FileUploader from '@/components/ui/FileUploader'
import Tooltip from '@/components/ui/Tooltip'
import { UiButton, UiOptionButton, UiTextAreaField } from '@/components/ui/primitives'
import { UiModal } from '@/components/ui/UiModal'
import {
  UI_GLASS_ADAPTIVE_REGION_CLASS,
  UI_TEXT_LABEL_CLASS,
  UI_TEXT_META_CLASS,
} from '@/components/ui/styleTokens'
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData'
import {
  RELIGHT_RIM_DIRECTIONS,
  RELIGHT_SMART_PRESETS,
  normalizeRelightSettings,
  type RelightRimDirection,
  type RelightSettingsV1,
  type RelightSmartPreset,
} from '@/features/canvas/capabilities/relightPolicy'
import { importLocalMedia } from '@/services/localMediaImport'
import { RelightDirectionVisualizer } from './RelightDirectionVisualizer'
import { RelightLightingControls, type RelightLightingDraft } from './RelightLightingControls'
import { buildRelightEditorDraft } from './relightEditorDraft'
import type { CanvasSpecialEditorSurfaceProps } from './specialEditorRegistry'

const RIM_LABELS: Record<RelightRimDirection, string> = {
  off: '关闭', left: '左', right: '右', top: '上', 'top-left': '左上',
  'top-right': '右上', bottom: '下', 'bottom-left': '左下', 'bottom-right': '右下',
}
const SMART_LABELS: Record<RelightSmartPreset, string> = {
  'natural-studio': '自然影棚', 'soft-window': '柔和窗光', 'golden-hour': '黄金时刻',
  overcast: '阴天柔光', 'hard-studio': '硬光影棚', moonlight: '月光夜景',
  neon: '霓虹氛围', dramatic: '戏剧光影',
}

function sourceImageFromState(state: Readonly<DynamicValueMap>): string | null {
  if (typeof state.sourceImageUrl === 'string' && state.sourceImageUrl.trim()) {
    return state.sourceImageUrl
  }
  const mediaInputs = state.mediaInputs && typeof state.mediaInputs === 'object'
    ? state.mediaInputs as DynamicValueMap
    : {}
  const images = Array.isArray(mediaInputs.image) ? mediaInputs.image : []
  return images.find((item): item is string => typeof item === 'string' && item.trim().length > 0) ?? null
}

function readSettings(state: Readonly<DynamicValueMap>): RelightSettingsV1 {
  try {
    return normalizeRelightSettings(state.relightSettings)
  } catch {
    return normalizeRelightSettings(undefined)
  }
}

function FieldTitle({ children, tooltip }: { children: string; tooltip: string }): JSX.Element {
  const tooltipId = useId()
  return (
    <div className={UI_TEXT_LABEL_CLASS}>
      <Tooltip content={tooltip} contentId={tooltipId} delay={200}>
        <span
          tabIndex={0}
          className="inline-block cursor-help rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-accent"
          aria-describedby={tooltipId}
        >
          {children}
        </span>
      </Tooltip>
    </div>
  )
}

interface RelightWorkbenchProps {
  settings: RelightSettingsV1
  sourceImage: string | null
  onSettingsChange: (settings: RelightSettingsV1) => void
  sourceControl?: ReactNode
  embedded?: boolean
}

export function RelightWorkbench({
  settings,
  sourceImage,
  onSettingsChange,
  sourceControl,
  embedded = false,
}: RelightWorkbenchProps): JSX.Element {
  const { t } = useTranslation()
  const [lightingDraft, setLightingDraft] = useState<RelightLightingDraft | null>(null)
  const lighting = lightingDraft ?? settings.manual
  const updateSettings = (next: RelightSettingsV1): void => {
    onSettingsChange(normalizeRelightSettings(next))
  }
  const patchManual = (patch: Partial<RelightSettingsV1['manual']>): void => {
    updateSettings({ ...settings, manual: { ...settings.manual, ...patch } })
  }
  const patchSmart = (patch: Partial<RelightSettingsV1['smart']>): void => {
    updateSettings({ ...settings, smart: { ...settings.smart, ...patch } })
  }
  const handleReferenceUpload = async (files: File[]): Promise<void> => {
    const file = files[0]
    if (!file) return
    const imported = await importLocalMedia(file, 'image')
    if (imported.kind === 'image') {
      patchSmart({ lightingReferenceImages: [imported.fullPath] })
    }
  }

  const referenceFiles = settings.smart.lightingReferenceImages.map(resolveImageDisplayUrl)
  const sourceImageUrl = sourceImage ? resolveImageDisplayUrl(sourceImage) : null

  return (
      <div
        data-relight-workbench="true"
        className={`grid min-h-0 min-w-0 flex-1 ${settings.lightingMode === 'manual' ? 'grid-cols-[minmax(0,1fr)_280px]' : 'grid-cols-1'}`}
      >
        {settings.lightingMode === 'manual' && (
          <div className={`flex min-h-0 ${embedded ? 'p-2' : 'p-4'}`}>
            <RelightDirectionVisualizer
              direction={settings.manual.keyDirection}
              brightness={lighting.brightness}
              colorPreset={lighting.colorPreset}
              sourceImage={sourceImageUrl}
              sourceAlt={t('node.relightGeneration.sourceAlt')}
              onDirectionChange={(keyDirection) => patchManual({ keyDirection })}
            />
          </div>
        )}

        <div data-relight-inspector="true" className={`min-h-0 min-w-0 overflow-y-auto ${settings.lightingMode === 'manual' ? 'border-l border-veil-subtle' : ''} ${embedded ? 'p-3' : `p-5 ${UI_GLASS_ADAPTIVE_REGION_CLASS}`}`}>
          <div className="max-w-3xl">
          {sourceControl ? <div className="mb-3">{sourceControl}</div> : null}
          <section aria-label="打光模式">
            <div className="grid grid-cols-2 gap-2">
              <UiOptionButton
                type="button"
                variant="menu"
                active={settings.lightingMode === 'manual'}
                className="!h-9 justify-center whitespace-nowrap !px-2 text-xs"
                onClick={() => updateSettings({ ...settings, lightingMode: 'manual' })}
              >
                手动打光
              </UiOptionButton>
              <UiOptionButton
                type="button"
                variant="menu"
                active={settings.lightingMode === 'smart'}
                className="!h-9 justify-center whitespace-nowrap !px-2 text-xs"
                onClick={() => updateSettings({ ...settings, lightingMode: 'smart' })}
              >
                智能打光
              </UiOptionButton>
            </div>
          </section>

          {settings.lightingMode === 'manual' ? (
            <div className="mt-4 space-y-3">
              <RelightLightingControls
                value={lighting}
                brightnessTitle={<FieldTitle tooltip="拖动选择五档明暗；光束为示意，实际效果由模型生成。">亮度</FieldTitle>}
                colorTitle={<FieldTitle tooltip="拖动选择灯光色调，光束同步显示所选颜色。">色调</FieldTitle>}
                onPreview={setLightingDraft}
                onCommit={patchManual}
              />
              <div className="flex items-center justify-between gap-3">
                <FieldTitle tooltip="在主体边缘增加光线，方向用于引导生成效果。">轮廓光</FieldTitle>
                <Dropdown
                  ariaLabel="轮廓光"
                  className="w-36"
                  value={settings.manual.rimDirection}
                  options={RELIGHT_RIM_DIRECTIONS.map((value) => ({ value, label: RIM_LABELS[value] }))}
                  onSelect={(rimDirection) => patchManual({ rimDirection })}
                />
              </div>
              <section className="space-y-2">
                <FieldTitle tooltip="补充需要保留的细节或希望达到的光照效果。">补充要求</FieldTitle>
                <UiTextAreaField
                  value={settings.manual.extraPrompt}
                  rows={3}
                  maxLength={32 * 1024}
                  placeholder="例如：保留商品标签清晰可读"
                  onChange={(event) => patchManual({ extraPrompt: event.target.value })}
                />
              </section>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <FieldTitle tooltip="选择希望营造的光照氛围。">氛围预设</FieldTitle>
                <Dropdown
                  ariaLabel="氛围预设"
                  className="w-36"
                  value={settings.smart.preset}
                  options={RELIGHT_SMART_PRESETS.map((value) => ({ value, label: SMART_LABELS[value] }))}
                  onSelect={(preset) => patchSmart({ preset })}
                />
              </div>

              <section className="space-y-2">
                <FieldTitle tooltip="模型只借用参考图的光感和氛围，不保证复制相同光场。">光照参考图</FieldTitle>
                <FileUploader
                  density="compact"
                  files={referenceFiles}
                  accept="image/*"
                  maxCount={1}
                  multiple={false}
                  onUpload={handleReferenceUpload}
                  onRemove={() => patchSmart({ lightingReferenceImages: [] })}
                />
              </section>

              <section className="space-y-2">
                <FieldTitle tooltip="描述希望达到的光照效果和需要保留的细节。">补充要求</FieldTitle>
                <UiTextAreaField
                  value={settings.smart.prompt}
                  rows={2}
                  maxLength={32 * 1024}
                  placeholder="例如：在保留背景布局的前提下增强商品高光"
                  onChange={(event) => patchSmart({ prompt: event.target.value })}
                />
              </section>
            </div>
          )}
          </div>
        </div>
      </div>
  )
}

export default function RelightSpecialEditor({
  session,
  onDraftChange,
  onConfirm,
  onCancel,
  onKeepEditing,
  onDiscard,
}: CanvasSpecialEditorSurfaceProps): JSX.Element {
  const settings = useMemo(() => readSettings(session.draftState), [session.draftState])
  const sourceImage = sourceImageFromState(session.draftState)
  const close = (): void => { onCancel() }
  return (
    <UiModal
      isOpen
      title="图片打光"
      size="workspace"
      surface="glass"
      contentClassName="min-h-0 p-0"
      onClose={close}
      footer={session.discardConfirmationRequested ? (
        <div className="flex w-full items-center justify-between gap-3">
          <p className={UI_TEXT_META_CLASS}>有尚未确认的打光设置，确定放弃吗？</p>
          <div className="flex items-center gap-2">
            <UiButton type="button" variant="ghost" size="sm" onClick={onKeepEditing}>继续编辑</UiButton>
            <UiButton type="button" variant="primary" size="sm" onClick={onDiscard}>放弃更改</UiButton>
          </div>
        </div>
      ) : (
        <>
          <UiButton type="button" variant="ghost" size="sm" onClick={close}>取消</UiButton>
          <UiButton type="button" variant="primary" size="sm" onClick={onConfirm}>应用设置</UiButton>
        </>
      )}
    >
      <RelightWorkbench
        settings={settings}
        sourceImage={sourceImage}
        onSettingsChange={(next) => onDraftChange(buildRelightEditorDraft(session.draftState, next))}
      />
    </UiModal>
  )
}
