import { z } from 'zod'

export const SENSITIVE_TEXT_KINDS = ['email', 'phone', 'identity', 'bank_card', 'secret', 'url_token', 'password'] as const
export type SensitiveTextKind = typeof SENSITIVE_TEXT_KINDS[number]
const unit = z.number().finite().min(0).max(1)
export const privacyBoxSchema = z.tuple([unit, unit, unit.positive(), unit.positive()]).refine(b => b[0] + b[2] <= 1.000001 && b[1] + b[3] <= 1.000001, '区域必须位于画面内')
export const privacyCandidateSchema = z.object({
  id: z.string().min(1), mediaId: z.string().min(1), kind: z.enum(SENSITIVE_TEXT_KINDS),
  hint: z.string().max(120), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  startUs: z.number().int().nonnegative().safe(), endUs: z.number().int().nonnegative().safe(),
  status: z.enum(['pending', 'accepted', 'rejected']),
  samples: z.array(z.object({ monoUs: z.number().int().nonnegative().safe(), box: privacyBoxSchema, confidence: unit }).strict()).min(1),
}).strict().superRefine((v, ctx) => {
  if (v.endUs <= v.startUs) ctx.addIssue({ code: 'custom', path: ['endUs'], message: '结束必须晚于开始' })
  v.samples.forEach((s, i) => { if (s.monoUs < v.startUs || s.monoUs >= v.endUs || i && s.monoUs <= v.samples[i - 1].monoUs) ctx.addIssue({ code: 'custom', path: ['samples', i], message: '轨迹时刻必须在候选范围内且严格递增' }) })
})
export const recordingPrivacySchema = z.object({ candidates: z.array(privacyCandidateSchema), warnings: z.array(z.string().max(1000)).max(100) }).strict().refine(v => new Set(v.candidates.map(c => c.id)).size === v.candidates.length, '候选标识不能重复')
export type PrivacyCandidate = z.infer<typeof privacyCandidateSchema>
export type RecordingPrivacy = z.infer<typeof recordingPrivacySchema>
export type PrivacyBox = z.infer<typeof privacyBoxSchema>
export function emptyRecordingPrivacy(): RecordingPrivacy { return { candidates: [], warnings: [] } }

export function luhnValid(value: string): boolean {
  if (!/^\d{13,19}$/.test(value) || /^(\d)\1+$/.test(value)) return false
  let sum = 0
  for (let i = value.length - 1, double = false; i >= 0; i--, double = !double) { let n = Number(value[i]); if (double) { n *= 2; if (n > 9) n -= 9 } sum += n }
  return sum % 10 === 0
}
export function identityValid(value: string): boolean {
  if (!/^[1-9]\d{16}[\dXx]$/.test(value)) return false
  const year = Number(value.slice(6, 10)), month = Number(value.slice(10, 12)), day = Number(value.slice(12, 14))
  const date = new Date(Date.UTC(year, month - 1, day))
  if (year < 1800 || year > 2099 || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day || value.slice(14, 17) === '000') return false
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  return '10X98765432'[[...value.slice(0, 17)].reduce((sum, v, i) => sum + Number(v) * weights[i], 0) % 11] === value[17].toUpperCase()
}
export interface SensitiveMatch { kind: SensitiveTextKind; value: string; start: number; end: number }
/** Rules consume transient OCR text. Callers must hash and discard value before IPC/persistence/logging. */
export function sensitiveTextMatches(text: string): SensitiveMatch[] {
  const found: SensitiveMatch[] = []
  const add = (pattern: RegExp, kind: SensitiveTextKind, valid: (value: string) => boolean = () => true): void => {
    for (const match of text.matchAll(pattern)) if (valid(match[0])) found.push({ kind, value: match[0], start: match.index, end: match.index + match[0].length })
  }
  add(/(?<![\w.+-])[\w.+-]+@[a-z\d](?:[a-z\d.-]*[a-z\d])?\.[a-z]{2,63}(?![\w.-])/gi, 'email')
  add(/(?<!\d)(?:\+?86[ -]?)?1[3-9]\d[ -]?\d{4}[ -]?\d{4}(?!\d)/g, 'phone')
  add(/(?<!\d)[1-9]\d{16}[\dXx](?!\d)/g, 'identity', identityValid)
  add(/(?<!\d)(?:\d[ -]?){12,18}\d(?![\dXx])/g, 'bank_card', v => luhnValid(v.replace(/[ -]/g, '')))
  add(/\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})(?![A-Za-z0-9_-])/g, 'secret')
  // Only parse actual URLs; a standalone word "token" is not a secret.
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    let url: URL
    try { url = new URL(match[0]) } catch { continue }
    for (const [key, value] of url.searchParams) if (/^(?:token|access_token|refresh_token|api_?key|key|secret|password|auth|authorization|signature|sig)$/i.test(key) && value.length) {
      found.push({ kind: 'url_token', value: `${key}=${value}`, start: match.index, end: match.index + match[0].length })
    }
  }
  return found.filter((v, i) => !found.some((other, j) => j !== i && other.kind !== 'bank_card' && v.kind === 'bank_card' && other.start <= v.start && other.end >= v.end))
}
