import { verifiedVideoEditProxySources } from '../application/videoEditProxy'
import { videoEditMaskUpdateTime } from '../application/videoEditMaskEditing'
import { prepareVideoEditFonts } from '../application/videoEditFonts'
import { initializeVideoEditCodeSourceRuntime } from '../application/videoEditCodeSourceRuntime'
import { VideoEditRenderTransport } from './videoEditRenderTransport'
export { warmVideoEditNativeDecoder } from './videoEditRenderTransport'

/** Document services are wired here; transport and author inspection never import them. */
export class VideoEditRenderSession extends VideoEditRenderTransport {
  constructor(...args: ConstructorParameters<typeof VideoEditRenderTransport> extends [unknown, ...infer Rest] ? Rest : never) {
    initializeVideoEditCodeSourceRuntime()
    super({ fonts: prepareVideoEditFonts, proxies: verifiedVideoEditProxySources, maskUpdateTime: videoEditMaskUpdateTime, readCodeMetadata: readCodeMetadataCache, writeCodeMetadata: writeCodeMetadataCache, loadCodeModules: prepareVideoEditNativeModules }, ...args)
  }
}
import { readCodeMetadataCache, writeCodeMetadataCache } from '../application/videoEditCodeMetadataCache'
import { prepareVideoEditNativeModules } from '../application/videoEditNativeModules'
