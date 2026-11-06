import type { SpeechRecognitionOutput, TranslationOutput } from '@henjicc/ai-sdk'

/** 开发者面板测试台里由主进程直接调用的能力：语音识别与翻译。只在开发版可用。 */
export type DeveloperTestRequest =
  | { kind: 'asr'; requestId: string; modelId: string; audioPath: string; language?: string }
  | { kind: 'translation'; requestId: string; moduleId: string; text: string; targetLanguage: string; sourceLanguage?: string }

export type DeveloperTestResult =
  | { kind: 'asr'; elapsedMs: number; output: SpeechRecognitionOutput }
  | { kind: 'translation'; elapsedMs: number; output: TranslationOutput }
