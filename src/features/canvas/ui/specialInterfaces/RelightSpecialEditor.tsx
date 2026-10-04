import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import Dropdown from '@/components/ui/Dropdown'
import FileUploader from '@/components/ui/FileUploader'
import { UiTooltipText } from '@/components/ui/layout'
import { UiButton, UiOptionButton, UiSwitch, UiTextAreaField } from '@/components/ui/primitives'
import { UiModal } from '@/components/ui/UiModal'
import {
  UI_GLASS_ADAPTIVE_DIVIDER_CLASS,
  UI_GLASS_ADAPTIVE_REGION_CLASS,
  UI_SEGMENTED_TRACK_CLASS,
  UI_TEXT_LABEL_CLASS,
  UI_TEXT_META_CLASS,
} from '@/components/ui/styleTokens'
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData'
import {
  RELIGHT_SMART_PRESETS,
  normalizeRelightSettings,
  type RelightRimDirection,
  type RelightSettingsV1,
  type RelightSmartPreset,
} from '@/features/canvas/capabilities/relightPolicy'
import { importLocalMedia } from '@/services/localMediaImport'
import { RelightDirectionVisualizer } from './RelightDirectionVisualizer'
import { RelightLightingControls, type RelightLightingDraft } from './RelightLightingControls'
import { defaultRimDirection } from './relightRimLightState'
import { buildRelightEditorDraft } from './relightEditorDraft'
import type { CanvasSpecialEditorSurfaceProps } from './specialEditorRegistry'

function smartPresetLabelKey(preset: RelightSmartPreset): string {
  return `node.relightGeneration.editor.presets.${preset}`
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
  return (
    <div className={UI_TEXT_LABEL_CLASS}>
      <UiTooltipText tooltip={tooltip}>{children}</UiTooltipText>
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
  const lastRimDirection = useRef<RelightRimDirection>(settings.manual.rimDirection)
  const updateSettings = (next: RelightSettingsV1): void => {
    onSettingsChange(normalizeRelightSettings(next))
  }
  const patchManual = (patch: Partial<RelightSettingsV1['manual']>): void => {
    updateSettings({ ...settings, manual: { ...settings.manual, ...patch } })
  }
  const changeRimDirection = (rimDirection: RelightRimDirection): void => {
    if (rimDirection !== 'off') lastRimDirection.current = rimDirection
    patchManual({ rimDirection })
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
              rimDirection={settings.manual.rimDirection}
              onRimDirectionChange={changeRimDirection}
              sourceImage={sourceImageUrl}
              sourceAlt={t('node.relightGeneration.sourceAlt')}
              onDirectionChange={(keyDirection) => patchManual({ keyDirection })}

            />
          </div>
        )}

        <div data-relight-inspector="true" className={`min-h-0 min-w-0 overflow-y-auto ${settings.lightingMode === 'manual' ? `border-l ${UI_GLASS_ADAPTIVE_DIVIDER_CLASS}` : ''} ${embedded ? 'p-3' : `p-5 ${UI_GLASS_ADAPTIVE_REGION_CLASS}`}`}>
          <div className="flex min-h-full flex-col">
          {sourceControl ? <div className="mb-3">{sourceControl}</div> : null}
          {/* 二选一模式用分段选择（淡强调底选中），不是两颗菜单项（任务 5.4） */}
          <div role="radiogroup" aria-label={t('node.relightGeneration.editor.mode')} className={`${UI_SEGMENTED_TRACK_CLASS} !w-full`}>
            {(['manual', 'smart'] as const).map((mode) => (
              <UiOptionButton
                key={mode}
                type="button"
                variant="segment"
                role="radio"
                aria-checked={settings.lightingMode === mode}
                active={settings.lightingMode === mode}
                className="flex-1 justify-center whitespace-nowrap"
                onClick={() => updateSettings({ ...settings, lightingMode: mode })}
              >
                {t(`node.relightGeneration.editor.${mode}`)}
              </UiOptionButton>
            ))}
          </div>

          {settings.lightingMode === 'manual' ? (
            <div className="mt-4 flex flex-1 flex-col gap-3">
              <RelightLightingControls
                value={lighting}
                brightnessTitle={<FieldTitle tooltip={t('node.relightGeneration.editor.brightnessTip')}>{t('node.relightGeneration.editor.brightness')}</FieldTitle>}
                colorTitle={<FieldTitle tooltip={t('node.relightGeneration.editor.colorTip')}>{t('node.relightGeneration.editor.color')}</FieldTitle>}
                onPreview={setLightingDraft}
                onCommit={patchManual}
              />
              <div className="flex items-center justify-between gap-3">
                <FieldTitle tooltip={t('node.relightGeneration.editor.rimTip')}>{t('node.relightGeneration.editor.rim')}</FieldTitle>
                <div className="flex items-center gap-3">
                  <UiSwitch aria-label={t('node.relightGeneration.editor.rim')} checked={settings.manual.rimDirection !== 'off'}
                    onCheckedChange={(enabled) => {
                      if (!enabled) lastRimDirection.current = settings.manual.rimDirection
                      changeRimDirection(enabled
                        ? lastRimDirection.current === 'off' ? defaultRimDirection(settings.manual.keyDirection) : lastRimDirection.current
                        : 'off')
                    }} />
                </div>
              </div>
              <section className="flex min-h-24 flex-1 flex-col gap-2">
                <FieldTitle tooltip={t('node.relightGeneration.editor.extraManualTip')}>{t('node.relightGeneration.editor.extra')}</FieldTitle>
                <UiTextAreaField
                  value={settings.manual.extraPrompt}
                  rows={3}
                  className="min-h-16 flex-1"
                  maxLength={32 * 1024}
                  placeholder={t('node.relightGeneration.editor.extraManualPlaceholder')}
                  onChange={(event) => patchManual({ extraPrompt: event.target.value })}
                />
              </section>
            </div>
          ) : (
            <div className="mt-3 flex flex-1 flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <FieldTitle tooltip={t('node.relightGeneration.editor.presetTip')}>{t('node.relightGeneration.editor.preset')}</FieldTitle>
                <Dropdown
                  ariaLabel={t('node.relightGeneration.editor.preset')}
                  className="w-36"
                  value={settings.smart.preset}
                  options={RELIGHT_SMART_PRESETS.map((value) => ({ value, label: t(smartPresetLabelKey(value)) }))}
                  onSelect={(preset) => patchSmart({ preset })}
                />
              </div>

              <section className="space-y-2">
                <FieldTitle tooltip={t('node.relightGeneration.editor.referenceTip')}>{t('node.relightGeneration.editor.reference')}</FieldTitle>
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

              <section className="flex min-h-24 flex-1 flex-col gap-2">
                <FieldTitle tooltip={t('node.relightGeneration.editor.extraSmartTip')}>{t('node.relightGeneration.editor.extra')}</FieldTitle>
                <UiTextAreaField
                  value={settings.smart.prompt}
                  rows={2}
                  className="min-h-16 flex-1"
                  maxLength={32 * 1024}
                  placeholder={t('node.relightGeneration.editor.extraSmartPlaceholder')}
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
  const { t } = useTranslation()
  const sourceImage = sourceImageFromState(session.draftState)
  const close = (): void => { onCancel() }
  return (
    <UiModal
      isOpen
      title={t('node.relightGeneration.editor.title')}
      size="workspace"
      surface="glass"
      contentClassName="min-h-0 p-0"
      onClose={close}
      footer={session.discardConfirmationRequested ? (
        <div className="flex w-full items-center justify-between gap-3">
          <p className={UI_TEXT_META_CLASS}>{t('node.relightGeneration.editor.discardPrompt')}</p>
          <div className="flex items-center gap-2">
            <UiButton type="button" variant="secondary" onClick={onKeepEditing}>{t('node.relightGeneration.editor.keepEditing')}</UiButton>
            <UiButton type="button" variant="dangerSolid" onClick={onDiscard}>{t('node.relightGeneration.editor.discard')}</UiButton>
          </div>
        </div>
      ) : (
        <>
          <UiButton type="button" variant="secondary" onClick={close}>{t('common.cancel')}</UiButton>
          <UiButton type="button" variant="primary" onClick={onConfirm}>{t('node.relightGeneration.editor.apply')}</UiButton>
        </>
      )}
    >
      <RelightWorkbench
        settings={settings}
        sourceImage={sourceImage}
        onSettingsChange={next => onDraftChange(buildRelightEditorDraft(session.draftState, next))}
      />
    </UiModal>
  )
}
