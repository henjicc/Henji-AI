export const APIMART_API_BASE_URLS = [
  'https://api.apimart.ai',
  'https://api.apib.ai',
  'https://api.aiuxu.com',
  'https://api.aishuch.com',
] as const

export function buildApiMartEndpoints(route: string): string[] {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`
  return APIMART_API_BASE_URLS.map((baseUrl) => `${baseUrl}${normalizedRoute}`)
}
