import type { CapabilityDescriptor, CapabilityModule } from '../types'

export interface TranslationTextInput {
  text: string
  id?: string
}

export interface TranslationInput {
  /** 单条字符串或带稳定 id 的批量文本。 */
  source: string | readonly TranslationTextInput[]
  targetLanguage: string
  sourceLanguage?: string
  context?: string
  terminology?: Readonly<Record<string, string>>
  options?: Readonly<Record<string, unknown>>
}

export interface TranslationItem {
  text: string
  sourceText?: string
  id?: string
  detectedLanguage?: string
}

export interface TranslationOutput {
  translations: readonly TranslationItem[]
  providerMetadata?: unknown
}

export type TranslationEvent =
  | { type: 'started' }
  | { type: 'delta'; index: number; text: string; id?: string }
  | { type: 'item'; index: number; item: TranslationItem }
  | { type: 'completed'; output: TranslationOutput }

export type TranslationModule = CapabilityModule<
  TranslationInput,
  TranslationOutput,
  TranslationEvent
>

export interface TranslationDescriptorInput
  extends Omit<CapabilityDescriptor, 'kind' | 'contract' | 'operations' | 'executionModes'> {
  streaming?: boolean
  features?: readonly string[]
}

/** 建立可发现的翻译描述；语言清单和供应商参数由具体 module 声明/校验。 */
export function defineTranslationDescriptor(
  input: TranslationDescriptorInput
): CapabilityDescriptor {
  const { streaming, features = [], ...descriptor } = input
  return {
    ...descriptor,
    kind: 'translation',
    contract: {
      input: [{ kind: 'text', required: true, multiple: true }],
      output: [
        { kind: 'text', required: true, multiple: true },
        { kind: 'structured-data', required: true },
      ],
    },
    operations: ['translation', 'text-translation'],
    executionModes: [streaming ? 'event-stream' : 'request-response'],
    features: [...new Set([...features, ...(streaming ? ['streaming'] : [])])],
  }
}
