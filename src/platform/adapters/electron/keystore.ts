import type { KeystorePlatform } from '@/platform/contracts/keystore'

const DOMAIN = 'keystore'

function getNativeKeystore(): NonNullable<typeof window.henjiNative>['keystore'] {
  const native = window.henjiNative
  if (!native?.keystore) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.keystore is not available`)
  }
  return native.keystore
}

export function createElectronKeystore(): KeystorePlatform {
  return {
    setKey: async (namespace, providerId, apiKey) => {
      await getNativeKeystore().setKey(namespace, providerId, apiKey)
    },
    removeKey: async (namespace, providerId) => {
      await getNativeKeystore().removeKey(namespace, providerId)
    },
    getKey: async (namespace, providerId) => {
      return await getNativeKeystore().getKey(namespace, providerId)
    },
    hasKey: async (namespace, providerId) => {
      return await getNativeKeystore().hasKey(namespace, providerId)
    },
  }
}
