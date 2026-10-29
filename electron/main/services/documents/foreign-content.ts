import type { ContentTrustReference } from '../../../../src/core/contentTrust'
import { buildDocumentEnvelope, carryDocumentEnvelopeForward } from '../../../../src/core/documents/envelope'
import { createLocationCodec } from '../../../../src/core/storage/locationCodec'
import { persistenceForwardFields } from '../../../../src/core/persistence/migrations'
import { restoreForwardFields } from '../../../../src/core/persistence/forwardCompat'
import { decodeDocumentContent, type LoadedDocumentFile } from './document-file'
import type { DocumentWorkspace, ResolvedContainer } from './workspace'
/** 导入只改变来源标记；包里的允许选择没有任何宿主效力。 */
function markForeignVideoContent(value: unknown, foreign: ContentTrustReference): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const content = value as Record<string, unknown>
  const definitions = Array.isArray(content.codeMaterials) ? content.codeMaterials : []
  return { ...content, foreign, ...(Array.isArray(content.styles) ? { styles: content.styles.map(style => ({ ...style as object, imported: true, foreign })) } : {}), codeMaterials: definitions.map(definition => {
    const source = definition as Record<string, unknown>
    return { ...source, versions: Array.isArray(source.versions) ? source.versions.map(version => ({ ...version as object, foreign })) : source.versions }
  }) }
}

export function markForeignVideoDocument(file: LoadedDocumentFile, foreign: ContentTrustReference, container: ResolvedContainer, workspace: DocumentWorkspace) {
  const envelope = file.envelope!
  const decoded = decodeDocumentContent(file, container, workspace).content
  const forward = envelope.kindVersion > file.kind.version
  const marked = markForeignVideoContent(decoded, foreign)
  const content = forward ? restoreForwardFields(marked, persistenceForwardFields(decoded)) : marked
  const encoded = createLocationCodec(workspace.locationContext(container)).encodeContent(content)
  return carryDocumentEnvelopeForward(envelope, buildDocumentEnvelope({
    ...envelope, draft: envelope.draft === true, content: encoded.content,
    kindVersion: forward ? envelope.kindVersion : file.kind.version,
    kindMinReaderVersion: forward ? envelope.kindMinReaderVersion : file.kind.minReaderVersion,
  }))
}
