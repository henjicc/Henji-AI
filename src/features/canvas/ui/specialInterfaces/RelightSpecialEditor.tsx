import { useId, useMemo, type ReactNode } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CircleOff, SunMedium } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import FileUploader from '@/components/ui/FileUploader'
import Tooltip from '@/components/ui/Tooltip'
import { UiButton, UiOptionButton, UiTextAreaField } from '@/components/ui/primitives'
import { UiModal } from '@/components/ui/UiModal'
import {
  UI_GLASS_ADAPTIVE_REGION_CLASS,
  UI_GLASS_ADAPTIVE_SURFACE_CLASS,
  UI_TEXT_LABEL_CLASS,
  UI_TEXT_META_CLASS,
  UI_TEXT_SECTION_CLASS,
} from '@/components/ui/styleTokens'
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData'
import {
  RELIGHT_BRIGHTNESS_LEVELS,
  RELIGHT_COLOR_PRESETS,
  RELIGHT_KEY_DIRECTIONS,
  RELIGHT_RIM_DIRECTIONS,
  RELIGHT_SMART_PRESETS,
  normalizeRelightSettings,
  type RelightBrightness,
  type RelightColorPreset,
  type RelightKeyDirection,
  type RelightRimDirection,
  type RelightSettingsV1,
  type RelightSmartPreset,
} from '@/features/canvas/capabilities/relightPolicy'
import { importLocalMedia } from '@/services/localMediaImport'
import { RelightDirectionVisualizer } from './RelightDirectionVisualizer'
import { buildRelightEditorDraft } from './relightEditorDraft'
import { RELIGHT_DIRECTION_LABELS } from './relightDirectionVisualizerState'
import type { CanvasSpecialEditorSurfaceProps } from './specialEditorRegistry'

const DIRECTION_ICONS = {
  none: CircleOff, left: ArrowLeft, right: ArrowRight, top: ArrowUp, bottom: ArrowDown,
} satisfies Record<RelightKeyDirection, typeof ArrowLeft>
const COLOR_LABELS: Record<RelightColorPreset, string> = {
  neutral: '中性白', warm: '暖白', cool: '冷白', amber: '琥珀',
  red: '红色', blue: '蓝色', cyan: '青色', magenta: '品红',
}
const RIM_LABELS: Record<RelightRimDirection, string> = {
  off: '关闭', left: '左', right: '右', top: '上', 'top-left': '左上',
  'top-right': '右上', bottom: '下', 'bottom-left': '左下', 'bottom-right': '右下',
}
const SMART_LABELS: Record<RelightSmartPreset, string> = {
  'natural-studio': '自然影棚', 'soft-window': '柔和窗光', 'golden-hour': '黄金时刻',
  overcast: '阴天柔光', 'hard-studio': '硬光影棚', moonlight: '月光夜景',
  neon: '霓虹氛围', dramatic: '戏剧光影',
}
const BRIGHTNESS_LABELS: Record<RelightBrightness, string> = {
  [-2]: '很暗', [-1]: '偏暗', 0: '自然', 1: '偏亮', 2: '高调',
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
        className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1.25fr)_minmax(240px,0.75fr)]"
      >
        <div className={`flex min-h-0 ${embedded ? 'p-2' : 'p-4'}`}>
          {settings.lightingMode === 'manual' ? (
            <RelightDirectionVisualizer
              direction={settings.manual.keyDirection}
              sourceImage={sourceImageUrl}
              sourceAlt={t('node.relightGeneration.sourceAlt')}
              onDirectionChange={(keyDirection) => patchManual({ keyDirection })}
            />
          ) : (
            <div className={`relative flex min-h-0 w-full items-center justify-center overflow-hidden rounded-xl ${embedded ? 'bg-bg-dark/45' : UI_GLASS_ADAPTIVE_SURFACE_CLASS}`}>
              {sourceImageUrl ? (
                <img src={sourceImageUrl} alt={t('node.relightGeneration.sourceAlt')} className="max-h-full max-w-full object-contain" />
              ) : (
                <div className="flex flex-col items-center gap-2 text-text-muted">
                  <SunMedium className="h-8 w-8" />
                  <p className="text-sm">{t('node.relightGeneration.sourceRequired')}</p>
                </div>
              )}
              <div className="pointer-events-none absolute bottom-3 left-3 right-3 rounded-lg bg-overlay px-3 py-2 text-xs text-text-soft">
                智能打光由提示词与参考图控制，不使用手动灯位。
              </div>
            </div>
          )}
        </div>

        <div className={`min-h-0 overflow-y-auto border-l border-veil-subtle ${embedded ? 'p-3' : `p-5 ${UI_GLASS_ADAPTIVE_REGION_CLASS}`}`}>
          <div className="max-w-3xl">
          {sourceControl ? <div className="mb-3">{sourceControl}</div> : null}
          <section className="space-y-3">
            <h3 className={UI_TEXT_SECTION_CLASS}>模式</h3>
            <div className="grid grid-cols-2 gap-2">
              <UiOptionButton
                type="button"
                variant="flat"
                active={settings.lightingMode === 'manual'}
                onClick={() => updateSettings({ ...settings, lightingMode: 'manual' })}
              >
                <span className="flex flex-col">
                  <span className="text-sm font-medium">手动打光</span>
                  <span className="text-xs">IC-Light v2</span>
                </span>
              </UiOptionButton>
              <UiOptionButton
                type="button"
                variant="flat"
                active={settings.lightingMode === 'smart'}
                onClick={() => updateSettings({ ...settings, lightingMode: 'smart' })}
              >
                <span className="flex flex-col">
                  <span className="text-sm font-medium">智能打光</span>
                  <span className="text-xs">GPT Image 2</span>
                </span>
              </UiOptionButton>
            </div>
          </section>

          {settings.lightingMode === 'manual' ? (
            <div className="mt-5 space-y-5">
              <section className="space-y-2">
                <FieldTitle tooltip="五档方向会直接发送给 IC-Light，但它们是光照偏好，不代表可测量的灯位角度。">主光方向 · 离散偏好</FieldTitle>
                <div className="grid grid-cols-5 gap-1.5">
                  {RELIGHT_KEY_DIRECTIONS.map((direction) => {
                    const Icon = DIRECTION_ICONS[direction]
                    return (
                      <UiOptionButton
                        key={direction}
                        type="button"
                        variant="flat"
                        active={settings.manual.keyDirection === direction}
                        className="flex-col justify-center gap-1 px-1"
                        onClick={() => patchManual({ keyDirection: direction })}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="text-2xs">{RELIGHT_DIRECTION_LABELS[direction]}</span>
                      </UiOptionButton>
                    )
                  })}
                </div>
              </section>

              <section className="space-y-2">
                <FieldTitle tooltip="五档亮度会转换为提示词，不是曝光值。">亮度 · 模型近似</FieldTitle>
                <div className="grid grid-cols-5 gap-1.5">
                  {RELIGHT_BRIGHTNESS_LEVELS.map((brightness) => (
                    <UiOptionButton
                      key={brightness}
                      type="button"
                      variant="flat"
                      active={settings.manual.brightness === brightness}
                      className="justify-center px-1 text-xs"
                      onClick={() => patchManual({ brightness })}
                    >
                      {BRIGHTNESS_LABELS[brightness]}
                    </UiOptionButton>
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <FieldTitle tooltip="色调会转换为提示词，不保证与显示名称完全一致。">色调 · 模型近似</FieldTitle>
                <div className="grid grid-cols-4 gap-1.5">
                  {RELIGHT_COLOR_PRESETS.map((preset) => (
                    <UiOptionButton
                      key={preset}
                      type="button"
                      variant="flat"
                      active={settings.manual.colorPreset === preset}
                      className="justify-center text-xs"
                      onClick={() => patchManual({ colorPreset: preset })}
                    >
                      {COLOR_LABELS[preset]}
                    </UiOptionButton>
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <FieldTitle tooltip="轮廓光方向是生成引导，不是可精确布置的第二个灯源。">轮廓光 · 模型近似</FieldTitle>
                <div className="grid grid-cols-3 gap-1.5">
                  {RELIGHT_RIM_DIRECTIONS.map((direction) => (
                    <UiOptionButton
                      key={direction}
                      type="button"
                      variant="flat"
                      active={settings.manual.rimDirection === direction}
                      className="justify-center text-xs"
                      onClick={() => patchManual({ rimDirection: direction })}
                    >
                      {RIM_LABELS[direction]}
                    </UiOptionButton>
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <FieldTitle tooltip="补充文字与其他近似控制共同编译为固定版本的提示词。">补充要求 · 模型近似</FieldTitle>
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
            <div className="mt-5 space-y-5">
              <section className="space-y-2">
                <FieldTitle tooltip="预设会转换为版本化提示词，不是物理灯光参数。">氛围预设 · 模型近似</FieldTitle>
                <div className="grid grid-cols-2 gap-1.5">
                  {RELIGHT_SMART_PRESETS.map((preset) => (
                    <UiOptionButton
                      key={preset}
                      type="button"
                      variant="flat"
                      active={settings.smart.preset === preset}
                      className="justify-center text-xs"
                      onClick={() => patchSmart({ preset })}
                    >
                      {SMART_LABELS[preset]}
                    </UiOptionButton>
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <FieldTitle tooltip="模型只借用参考图的光感和氛围，不保证复制相同光场。">光照参考图 · 最多 1 张</FieldTitle>
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
                <FieldTitle tooltip="自然语言要求由 GPT Image 2 近似执行，不承诺精确灯位。">补充要求 · 模型近似</FieldTitle>
                <UiTextAreaField
                  value={settings.smart.prompt}
                  rows={4}
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
