import { expect, it } from 'vitest'
import { allowNavigation, registerNavigationGuard } from './navigationGuards'

it('录音宿主可在离开前拦住导航，确认后续接同一目标，注销不影响其余导航', () => {
  let proceed: (() => void) | undefined, navigated = false
  const release = registerNavigationGuard((destination, next) => { expect(destination.toolId).toBe(null); proceed = next; return false })
  expect(allowNavigation({ workspace: 'tools', toolId: null }, () => { navigated = true })).toBe(false)
  expect(navigated).toBe(false)
  proceed?.(); expect(navigated).toBe(true)
  release(); expect(allowNavigation({ workspace: 'tools', toolId: null }, () => {})).toBe(true)
})
