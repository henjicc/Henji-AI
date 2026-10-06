import { describe, expect, it } from 'vitest'
import { CODE_ASSET_LIMITS, decodeCodeAsset, encodeCodeAsset, type CodeAsset } from './codeAsset'
import { createVideoEditDocument, videoEditDocumentSchema } from './document'

const content = { sizeBytes: 123, fileModifiedAt: 456, contentIdentity: 'a'.repeat(64) }
const fixture = (): CodeAsset => ({ format: 'henji-code-asset', version: 1, name: '透明标题', sourceVersion: { apiVersion: 1, languageVersion: 2, source: 'source' }, parameters: { label: '中文', size: 20, tint: [1, 0, 0, 1], image: { kind: 'image', mediaId: 'old-image' } }, curves: { size: [{ id: 'key', sourceInUs: 1, sourceRemainder: { numerator: 1, denominator: 3 }, value: 21, interpolation: 'ease' }] }, images: [{ id: 'old-image', path: 'D:/original.png', content, assetId: 'original' }] })
describe('可编辑代码资产文件契约', () => {
  it('清单原图片可凭固定内容身份进入剪辑；无库记录又无身份的快照拒绝', () => {
    const document = createVideoEditDocument('原图片剪辑')
    document.media = [{ id: 'fixed-image', name: '原图片', path: 'D:/original.png', kind: 'image', width: 100, height: 100, durationSeconds: 0, assetContent: { ...content }, sourceRevision: 'new-source' }]
    expect(() => videoEditDocumentSchema.parse(document)).not.toThrow()
    delete document.media[0].assetContent!.contentIdentity
    expect(() => videoEditDocumentSchema.parse(document)).toThrow('固定内容身份')
    document.media[0].assetId = 'legacy-asset'
    expect(() => videoEditDocumentSchema.parse(document)).not.toThrow()
  })
  it('原始值、有理源曲线及原图片依赖无损往返，不烘焙当前时刻', () => { const input = fixture(); expect(decodeCodeAsset(encodeCodeAsset(input))).toEqual(input) })
  it('Windows UNC 原路径可往返，仍拒绝相对路径', () => {
    const input = fixture(); input.images[0].path = String.raw`\\server\share\original.png`
    expect(decodeCodeAsset(encodeCodeAsset(input)).images[0].path).toBe(input.images[0].path)
    expect(() => encodeCodeAsset({ ...input, images: [{ ...input.images[0], path: 'relative/image.png' }] })).toThrow()
  })
  it.each(['ir', 'metadata', 'previewUrl'])('拒绝外部%s及额外顶层真相', key => { expect(() => encodeCodeAsset({ ...fixture(), [key]: {} } as CodeAsset)).toThrow() })
  it('拒绝缺失、闲置或重复图片依赖及远程路径', () => {
    const input = fixture()
    for (const images of [[], [...input.images, ...input.images], [{ ...input.images[0], id: 'unused' }], [{ ...input.images[0], path: 'https://example.org/p.png' }]]) expect(() => encodeCodeAsset({ ...input, images })).toThrow()
  })
  it('按UTF-8源字节、整体文件、声明及曲线预算拒绝越界', () => {
    const input = fixture()
    expect(() => encodeCodeAsset({ ...input, sourceVersion: { ...input.sourceVersion, source: '汉'.repeat(30_000) } })).toThrow()
    expect(() => decodeCodeAsset(new Uint8Array(CODE_ASSET_LIMITS.bytes + 1))).toThrow()
    expect(() => encodeCodeAsset({ ...input, parameters: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`p${index}`, index])) })).toThrow()
    expect(() => encodeCodeAsset({ ...input, curves: { size: Array.from({ length: 257 }, (_, index) => ({ ...input.curves!.size[0], id: `key${index}` })) } })).toThrow()
  })
  it('拒绝无效UTF-8、JSON和文件版本', () => {
    for (const bytes of [new Uint8Array(), new Uint8Array([255]), new TextEncoder().encode('{'), new TextEncoder().encode(JSON.stringify({ ...fixture(), version: 2 }))]) expect(() => decodeCodeAsset(bytes)).toThrow()
  })
})
