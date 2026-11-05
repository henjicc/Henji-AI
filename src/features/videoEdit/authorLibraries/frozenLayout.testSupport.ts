import { pathToFileURL } from 'node:url'
import path from 'node:path'
const root = path.resolve('resources/video-edit-author/frozen/henji-layout/1.2.0')
// 历史 Canvas 语义的回归固定到作品实际钉住的发行字节，不能随开发入口切换。
const text = await import(/* @vite-ignore */ pathToFileURL(path.join(root, 'text.mjs')).href) as typeof import('./text')
const flex = await import(/* @vite-ignore */ pathToFileURL(path.join(root, 'flex-runtime.mjs')).href) as typeof import('./flex')
export const { layoutText, drawText } = text
export const { layoutBoxes, ready } = flex
export type { TextStyleInput, TextOptions } from './text'
export type { RichTextContent } from '../../../core/imaging/vectorContent/contracts'
export type { FlexNode, FlexStyle } from './flex'
