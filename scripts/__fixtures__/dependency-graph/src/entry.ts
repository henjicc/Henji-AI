import { alias } from '@/alias'
import { relative } from './relative'
import type { Shape } from './types'
export { forwarded } from './forwarded'
export type { ForwardedType } from './type-export'
export const lazy = () => import('./dynamic')
export const value: Shape = { name: alias + relative }
