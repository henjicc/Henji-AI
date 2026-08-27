import type { Transport } from '../runtime/Transport'

import { uploadToFalWithTransport } from './fal-transport'
import type { PreparedMediaBinary } from './prepared-media'

/**
 * @deprecated 新代码请传入宿主 Transport；生成客户端内部始终使用
 * `uploadToFalWithTransport`。省略 transport 只为兼容 0.1.3 的两参数调用。
 */
export async function uploadToFal(
  apiKey: string,
  prepared: PreparedMediaBinary,
  transport?: Transport
): Promise<string> {
  return await uploadToFalWithTransport(
    apiKey,
    prepared,
    transport ?? createLegacyHostTransport()
  )
}

function createLegacyHostTransport(): Transport {
  return {
    async fetch(url, init) {
      const hostFetch = globalThis.fetch
      if (typeof hostFetch !== 'function') {
        throw new Error('Fal legacy upload requires a host fetch implementation; pass Transport explicitly.')
      }
      return await hostFetch(url, init)
    },
  }
}
