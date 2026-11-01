import { expect, it, vi } from 'vitest'
import { installAuthorMetadataCache, readAuthorMetadataCache, writeAuthorMetadataCache, type AuthorCachedMetadata } from './videoEditAuthorMetadataCache'
import { testAuthorBundle, testAuthorProgram } from './videoEditAuthorTestFixtures'

it('旧提取规则的同源码缓存失效，新规则的文本声明能完整读回', async () => {
  const source = 'export default {name:"文字",params:[{key:"page",type:"image"}],webText:{page:["#title"]},draw(){}}'
  const program = testAuthorProgram(testAuthorBundle({ entry: 'main.js', files: { 'main.js': source }, apiVersion: 12 }))
  const { bundle: _bundle, ...stale } = program
  delete stale.webText
  const stored = new Map<string, AuthorCachedMetadata>([[source, stale]])
  const write = vi.fn(async (key: string, metadata: AuthorCachedMetadata) => { stored.set(key, metadata) })
  installAuthorMetadataCache({ read: async key => stored.get(key), write })
  expect(await readAuthorMetadataCache(source)).toBeUndefined()
  writeAuthorMetadataCache(source, program)
  expect(await readAuthorMetadataCache(source)).toMatchObject({ webText: { page: ['#title'] } })
  expect(stored.get(source)?.webText).toBeUndefined()
})
