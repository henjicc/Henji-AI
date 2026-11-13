import { DOCUMENT_TEXT_CHANNELS, type DocumentTextPlatform } from '../../src/platform/contracts/documentText'
export function createDocumentTextApi(invoke: <T>(channel: string, payload?: unknown) => Promise<T>): DocumentTextPlatform {
  return { inspect: request => invoke(DOCUMENT_TEXT_CHANNELS.inspect, request), recognize: request => invoke(DOCUMENT_TEXT_CHANNELS.recognize, request), cancel: id => invoke(DOCUMENT_TEXT_CHANNELS.cancel, id) }
}
