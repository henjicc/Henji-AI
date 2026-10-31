import type { ContentTrustReference } from '../../../../src/core/contentTrust'
import { buildDocumentEnvelope, carryDocumentEnvelopeForward } from '../../../../src/core/documents/envelope'
import { createLocationCodec } from '../../../../src/core/storage/locationCodec'
import { persistenceForwardFields } from '../../../../src/core/persistence/migrations'
import { restoreForwardFields } from '../../../../src/core/persistence/forwardCompat'
import { decodeDocumentContent, type LoadedDocumentFile } from './document-file'
import type { DocumentWorkspace, ResolvedContainer } from './workspace'
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function markPiece(value: unknown, foreign: ContentTrustReference): unknown {
  if (!record(value) || !record(value.codeSnapshots)) return value
  return { ...value, codeSnapshots: Object.fromEntries(Object.entries(value.codeSnapshots).map(([id, snapshot]) => [id, record(snapshot) && record(snapshot.version) ? { ...snapshot, version: { ...snapshot.version, foreign } } : snapshot])) }
}
/** 导入只改变来源标记；包里的允许选择没有任何宿主效力。 */
function markForeignVideoContent(value: unknown, foreign: ContentTrustReference): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const content = value as Record<string, unknown>
  const definitions = Array.isArray(content.codeMaterials) ? content.codeMaterials : []
  return { ...content, foreign, ...(Array.isArray(content.styles) ? { styles: content.styles.map(value => { const style = value as Record<string, unknown>; return { ...style, imported: true, foreign, ...(Array.isArray(style.effectPresets) ? { effectPresets: style.effectPresets.map(preset => markPiece(preset, foreign)) } : {}) } }) } : {}), codeMaterials: definitions.map(definition => {
    const source = definition as Record<string, unknown>
    return { ...source, versions: Array.isArray(source.versions) ? source.versions.map(version => ({ ...version as object, foreign })) : source.versions }
  }) }
}

export function markForeignVideoDocument(file: LoadedDocumentFile, foreign: ContentTrustReference, container: ResolvedContainer, workspace: DocumentWorkspace) {
  const envelope = file.envelope!
  const decoded = decodeDocumentContent(file, container, workspace).content
  const forward = envelope.kindVersion > file.kind.version
  const restored = forward ? restoreForwardFields(decoded, persistenceForwardFields(decoded)) : decoded
  // 录制会话的脚本基线也可恢复成剪辑，必须在恢复前向字段后统一标记来源。
  const content = file.kind.id === 'screen_recording' && record(restored) && record(restored.scriptCapture) ? {
    ...restored, scriptCapture: { ...restored.scriptCapture, baselines: Array.isArray(restored.scriptCapture.baselines) ? restored.scriptCapture.baselines.map(value => record(value) ? { ...value, content: markForeignVideoContent(value.content, foreign) } : value) : restored.scriptCapture.baselines },
  } : markForeignVideoContent(restored, foreign)
  const encoded = createLocationCodec(workspace.locationContext(container)).encodeContent(content)
  return carryDocumentEnvelopeForward(envelope, buildDocumentEnvelope({
    ...envelope, draft: envelope.draft === true, content: encoded.content,
    kindVersion: forward ? envelope.kindVersion : file.kind.version,
    kindMinReaderVersion: forward ? envelope.kindMinReaderVersion : file.kind.minReaderVersion,
  }))
}
