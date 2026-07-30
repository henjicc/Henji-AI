import { getLlmProviderApiKey } from '../../keystore'

export interface ModelCredentialResolver {
  resolveApiKey: (providerId: string) => string | null
}

export const dynamicModelCredentialResolver: ModelCredentialResolver = {
  resolveApiKey: (providerId) => getLlmProviderApiKey(providerId),
}
