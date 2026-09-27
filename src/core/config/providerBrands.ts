/** Product grouping only. Runtime IDs remain the credential and request-routing keys. */
export function providerBrandId(providerId: string): string {
  const id = providerId.trim().toLowerCase()
  return id === 'volcengine-speech' ? 'volcengine' : id
}

export function providerServiceLabel(providerId: string, english = false): string {
  if (providerId === 'volcengine') return english ? 'ModelArk' : '火山方舟'
  if (providerId === 'volcengine-speech') return english ? 'Doubao Speech' : '豆包语音'
  return providerId
}
