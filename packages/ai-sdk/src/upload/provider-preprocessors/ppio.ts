import { resolvePpioMediaRewriteMode } from '../../providers/ppio-media'
import { toBase64, toDataUri } from '../base64'
import { uploadToPublicHost } from '../public-host-upload'
import { createGenerationPreprocessor } from './factory'

export const strategy = {
  async rewrite(input) {
    const mode = resolvePpioMediaRewriteMode(
      input.route,
      input.fieldName,
      input.mediaKind === 'video'
    )
    if (mode === 'raw-base64') return toBase64(input.prepared.bytes)
    if (mode === 'data-uri') return toDataUri(input.prepared.bytes, input.prepared.mimeType)
    return await uploadToPublicHost(input, '派欧云')
  },
  async preprocessObject({ route, object, rewrite }) {
    if (route !== '/async/wan2.7-r2v') return
    const type = typeof object.type === 'string' ? object.type : ''
    const kind = type === 'reference_video'
      ? 'video'
      : (type === 'reference_image' || type === 'first_frame' ? 'image' : undefined)
    if (kind && typeof object.url === 'string') {
      object.url = await rewrite(kind, 'url', object.url)
    }
    if (typeof object.reference_voice === 'string') {
      object.reference_voice = await rewrite('audio', 'reference_voice', object.reference_voice)
    }
  },
} satisfies import('../preprocess-core').ProviderPreprocessStrategy

export const preprocess = createGenerationPreprocessor(strategy)
