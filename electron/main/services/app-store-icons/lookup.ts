/** App Store 输入解析与高清图地址参考 YuKongA/HQ-ICON（MIT）：https://github.com/YuKongA/HQ-ICON */
import type { AppStoreIconCandidate, SearchAppStoreIconsInput } from '../../../../src/core/appStoreIcons'

export const APP_STORE_ENTITIES = { iphone: 'software', ipad: 'iPadSoftware', mac: 'desktopSoftware' } as const

export function parseAppStoreInput(input: string): { id: string; country: string | null } | null {
  const value = input.trim()
  if (/^(?:id)?\d{6,}$/i.test(value)) return { id: value.replace(/^id/i, ''), country: null }
  let url: URL
  try { url = new URL(value) } catch { return null }
  if (url.protocol !== 'https:' || url.hostname !== 'apps.apple.com') return null
  const id = url.pathname.match(/(?:^|\/)id(\d+)(?:\/|$)/i)?.[1]
  if (!id) return null
  return { id, country: url.pathname.match(/^\/([a-z]{2})(?:\/|$)/i)?.[1]?.toLowerCase() || null }
}

export function iconArtworkUrl(artwork: string, resolution: 256 | 512 | 1024, shape: 'official' | 'square'): string {
  const url = new URL(artwork)
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.mzstatic.com') || url.username || url.password || url.port) {
    throw new Error('苹果图标地址不是受支持的 HTTPS 图片域名。')
  }
  if (!/\/512x512bb\.(jpg|png)$/i.test(url.pathname)) throw new Error('苹果返回的图标地址不符合 512x512bb 格式，无法确认高清图地址。')
  url.pathname = url.pathname.replace(/\/512x512bb\.(jpg|png)$/i, `/${resolution}x${resolution}${shape === 'official' ? 'ia' : 'bb'}-100.png`)
  return url.href
}

export interface AppStoreRecord extends AppStoreIconCandidate { artworkUrl512: string }
export function filterAppStoreResults(data: unknown, platform: SearchAppStoreIconsInput['platform']): AppStoreRecord[] {
  if (!data || typeof data !== 'object' || !('results' in data) || !Array.isArray(data.results)) throw new Error('苹果 Search API 返回格式无效：缺少 results 数组。')
  return data.results.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return []
    const r = item as Record<string, unknown>
    if (!['software', 'mac-software'].includes(String(r.kind)) || typeof r.artworkUrl512 !== 'string' || !r.artworkUrl512
      || typeof r.trackId !== 'number' || !Number.isSafeInteger(r.trackId) || r.trackId <= 0 || typeof r.trackName !== 'string') return []
    // lookup 不接受 entity；必须核对实际 kind，避免把 Mac 图标当成手机应用返回。
    if ((platform === 'mac') !== (r.kind === 'mac-software')) return []
    if (platform === 'ipad' && Array.isArray(r.features) && !r.features.includes('iosUniversal')
      && Array.isArray(r.supportedDevices) && !r.supportedDevices.some(v => typeof v === 'string' && v.startsWith('iPad'))) return []
    return [{ appId: String(r.trackId), name: r.trackName, developer: typeof r.artistName === 'string' ? r.artistName : '',
      platform, category: typeof r.primaryGenreName === 'string' ? r.primaryGenreName : '', artworkUrl512: r.artworkUrl512 }]
  })
}
