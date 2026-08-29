declare module '@henjicc/ai-sdk/provider-packs/*' {
  import type { GenerationPack } from '@henjicc/ai-sdk'

  const pack: GenerationPack
  export default pack
}

declare module '@henjicc/ai-sdk/tool-packs/*' {
  import type { GenerationPack } from '@henjicc/ai-sdk'

  const pack: GenerationPack
  export default pack
}
