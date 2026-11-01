import * as hb from '../../../../../resources/video-edit-author/vendor/harfbuzzjs/1.6.4/index.mjs'
import { TextShaper } from './harfbuzz'
import { TextFontSession as Session, type FontReader } from './fontSession'
import type { FontFaceInfo } from '../../../fonts/catalog'

/** 与选脸策略同一冻结发行的整形器负责准备期间的覆盖检查。 */
export class TextFontSession extends Session {
  constructor(platform: 'win32' | 'darwin', read: FontReader, catalog?: readonly FontFaceInfo[]) {
    super(platform, read, catalog, new TextShaper(hb))
  }
}
