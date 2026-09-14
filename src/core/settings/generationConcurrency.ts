import { APPLICATION_SETTINGS_CHANGED_EVENT } from './events'

export function readGenerationConcurrency(): number {
  const value = typeof localStorage === 'undefined' ? 2 : Number(localStorage.getItem('max_concurrent_tasks') ?? 2)
  return Number.isFinite(value) ? Math.max(1, Math.min(20, Math.trunc(value))) : 2
}

export function subscribeGenerationConcurrency(listener: (value: number) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const update = () => listener(readGenerationConcurrency())
  window.addEventListener(APPLICATION_SETTINGS_CHANGED_EVENT, update)
  window.addEventListener('storage', update)
  return () => {
    window.removeEventListener(APPLICATION_SETTINGS_CHANGED_EVENT, update)
    window.removeEventListener('storage', update)
  }
}
