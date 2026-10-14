import { expect, it } from 'vitest'
import { sensitiveTextMatches, identityValid, luhnValid, privacyCandidateSchema, type PrivacyCandidate } from './privacy'
import { confirmedRecordingPrivacyFragments, privacyCandidateEffect } from './privacyEffects'
import { evaluateVideoEditMaskPath } from '../videoEdit/maskPathAnimation'
import { rasterizeVideoEditMaskShapes } from '../videoEdit/effectMasks'
export function privacyFixture(): PrivacyCandidate {
  return privacyCandidateSchema.parse({ id: 'private-line', mediaId: 'screen', kind: 'email', hint: 'email · ••••', fingerprint: 'a'.repeat(64), status: 'pending', startUs: 3000000, endUs: 3300000,
    samples: [{ monoUs: 3000000, box: [.1, .2, .4, .1], confidence: .99 }, { monoUs: 3200000, box: [.1, .4, .4, .1], confidence: .98 }] })
}
it.each([
  ['联系 demo@example.com', 'email'], ['电话 +86 138-0013-8000', 'phone'], ['11010519491231002X', 'identity'], ['4111 1111 1111 1111', 'bank_card'],
  ['sk-testABCDEFGHIJKLMNOP1234', 'secret'], ['AKIAABCDEFGHIJKLMNOP', 'secret'], ['https://example.com/?access_token=FAKE%2BVALUE', 'url_token'],
])('敏感正样例 %s', (text, kind) => { expect(sensitiveTextMatches(text).some(v => v.kind === kind)).toBe(true) })
it.each(['demo@example', '138001380001', '110105194912310021', '11010519490231002X', '0000000000000000', '4111111111111112', 'sk-short', 'AKIAABC', 'token = ordinary', 'https://example.com/?page=123', 'https://example.com/?token='])('普通或校验失败文本不命中 %s', text => { expect(sensitiveTextMatches(text)).toEqual([]) })
it('身份证日期/校验码和银行卡Luhn共同约束', () => { expect(identityValid('11010519491231002X')).toBe(true); expect(luhnValid('4111111111111111')).toBe(true); expect(luhnValid('0000000000000000')).toBe(false) })
it('只有确认候选进入2.4；正式动画遮罩沿源时钟跟随且在候选外消失', () => {
  const candidate = privacyFixture()
  expect(confirmedRecordingPrivacyFragments([candidate], [{ id: 'screen', monoUs: 2000000 }])).toEqual([])
  expect(privacyCandidateEffect(candidate, 2000000).enabled).toBe(false)
  const fragment = confirmedRecordingPrivacyFragments([{ ...candidate, status: 'accepted' }], [{ id: 'screen', monoUs: 2000000 }])[0]
  expect(fragment.effect.enabled).toBe(true)
  const mask = fragment.effect.mask!; if (mask.regionId !== 'shapes') throw new Error('expected shape mask')
  const shape = mask.shapes[0]
  expect(evaluateVideoEditMaskPath(shape, 1000000).points[0]).toEqual([.1, .2, 0, 0, 0, 0])
  expect(evaluateVideoEditMaskPath(shape, 1200000).points[0]).toEqual([.1, .4, 0, 0, 0, 0])
  expect(evaluateVideoEditMaskPath(shape, 1300000).points[0][0]).toBeGreaterThan(1)
  const raster = rasterizeVideoEditMaskShapes([evaluateVideoEditMaskPath(shape, 1200000)], 100, 100)
  expect(raster[45 * 100 + 20]).toBeGreaterThan(250); expect(raster[25 * 100 + 20]).toBe(0)
  expect(() => privacyCandidateSchema.parse({ ...candidate, samples: [...candidate.samples].reverse() })).toThrow()
})
