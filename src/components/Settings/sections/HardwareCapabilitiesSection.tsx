import React, { useSyncExternalStore } from 'react'
import { UI_TEXT_META_CLASS, UiFormRow, UiGroup } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { HARDWARE_DECODE_CODECS, type HardwareCapabilitiesReport, type HardwareDecodeCodec } from '@/core/media/hardwareCapabilities'
import { getHardwareCapabilities, subscribeHardwareCapabilities } from '@/services/mediaCache/hardwareCapabilities'

const CODEC_LABELS: Record<HardwareDecodeCodec, string> = { h264: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9' }

/** 一种编码的解码情况：哪些规格由显卡解码，哪些只能由处理器解码（更慢、更占 CPU）。 */
function decodeSummary(report: HardwareCapabilitiesReport, codec: HardwareDecodeCodec, t: (key: string, values?: Record<string, unknown>) => string): string {
  const items = report.decode.filter(item => item.codec === codec)
  const label = (item: { bitDepth: number; chroma: string }): string => t('sections.hardware.variant', { depth: item.bitDepth, chroma: `${item.chroma[0]}:${item.chroma[1]}:${item.chroma[2]}` })
  const hardware = items.filter(item => item.hardware).map(label)
  const software = items.filter(item => item.supported && !item.hardware).map(label)
  const parts = []
  if (hardware.length) parts.push(t('sections.hardware.decodeGpu', { list: hardware.join('、') }))
  if (software.length) parts.push(t('sections.hardware.decodeCpu', { list: software.join('、') }))
  return parts.join('；') || t('sections.hardware.unsupported')
}

/**
 * 关于 › 本机硬件能力（只读）：哪些格式由显卡编解码。用户据此理解为什么某些素材播放吃力、
 * 预渲染“自动”选了哪种格式、导出里某些编码为什么不可用。检测在后台自动进行。
 */
const HardwareCapabilitiesSection: React.FC = () => {
  const { t } = useI18n('settings')
  const report = useSyncExternalStore(subscribeHardwareCapabilities, getHardwareCapabilities)
  return (
    <UiGroup title={t('sections.hardware.title')} titleTone="overline">
      {report ? (
        <>
          <UiFormRow label={t('sections.hardware.gpus')} inline>
            <span className={UI_TEXT_META_CLASS}>{report.gpus.length ? report.gpus.map(gpu => gpu.decodes && report.gpus.length > 1 ? t('sections.hardware.decodingGpu', { name: gpu.name }) : gpu.name).join('、') : t('sections.hardware.noGpu')}</span>
          </UiFormRow>
          {HARDWARE_DECODE_CODECS.map(codec => (
            <UiFormRow key={codec} label={t('sections.hardware.decodeLabel', { codec: CODEC_LABELS[codec] })} inline>
              <span className={UI_TEXT_META_CLASS}>{decodeSummary(report, codec, t)}</span>
            </UiFormRow>
          ))}
          <UiFormRow label={t('sections.hardware.encodeLabel')} info={t('sections.hardware.encodeInfo')} inline>
            <span className={UI_TEXT_META_CLASS}>{report.encode.filter(item => item.hardware).map(item => CODEC_LABELS[item.codec]).join('、') || t('sections.hardware.noHardwareEncode')}</span>
          </UiFormRow>
        </>
      ) : (
        <UiFormRow label={t('sections.hardware.gpus')} inline><span className={UI_TEXT_META_CLASS}>{t('sections.hardware.detecting')}</span></UiFormRow>
      )}
    </UiGroup>
  )
}

export default HardwareCapabilitiesSection
