import type { ResourceDescriptor, SourceImageMetadata } from '../contracts'

export type ImageEditorV3SourceLocator =
  | { kind: 'local-path'; filePath: string }
  | { kind: 'http-url'; url: string }
  | { kind: 'data-url'; dataUrl: string }

export interface ImageEditorV3SourceIngestResult {
  resource: ResourceDescriptor
  metadata: SourceImageMetadata
}

export interface ImageEditorV3SourceIngestLimits {
  localMaxBytes: number
  remoteMaxBytes: number
  dataUrlMaxBytes: number
  maxRedirects: number
  remoteConnectTimeoutMs: number
  remoteResponseHeadersTimeoutMs: number
  remoteBodyIdleTimeoutMs: number
  remoteTotalTimeoutMs: number
}
