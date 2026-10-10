import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { InteractionCancelReason, InteractionPointerInput, InteractionSample, InteractionPoint } from '@/core/imaging/interaction/contracts'
import { createLogger } from '@/core/logging'
import { useImageEditorSessionStoreV3 } from '../store'
import type { ImageEditorToolIdV3 } from '../application/imageEditorHostProfiles'
import type { ImageEditorV3Controller } from '../editor/types'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { resolveImageEditorRasterBrushLayerV3 } from '../editor/rasterBrushLayerV3'
import { imageEditorToolRegistry } from './builtInRegistry'
import { ToolInputRouter } from './inputRouter'
import type { ToolDefinition, ToolKeyboardBinding, ToolKeyboardHandler, ToolPointerAvailabilityBinding } from './types'

type RoutedPointer = ReactPointerEvent<HTMLElement>
interface PointerHandlers {
  down: (event: RoutedPointer) => void
  move: (event: RoutedPointer) => void
  up: (event: RoutedPointer) => void
  cancel: (event: RoutedPointer) => void
}
interface RouterPorts {
  navigation: PointerHandlers
  move: PointerHandlers
  viewport?: (preset: 'fit' | 'actual') => void
}

const logger = createLogger('imageEditor.tools')
const EDITABLE = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="slider"]'

export function useToolInputRouter(
  surfaceRef: RefObject<HTMLElement>, controller: ImageEditorV3Controller, activeTool: ImageEditorToolIdV3, bus: ImageEditCommandBusV3,
  coordinates?: { referenceGrid: { width: number; height: number }; toReference: (surfacePoint: InteractionPoint) => InteractionPoint },
): {
  effectiveTool: ImageEditorToolIdV3
  temporaryHandActive: boolean
  overlayResetVersions: Readonly<Record<string, number>>
  connect: (ports: RouterPorts) => void
  bindKeyboard: ToolKeyboardBinding
  bindPointerAvailability: ToolPointerAvailabilityBinding
  handlers: {
    onPointerDownCapture: (event: RoutedPointer) => void
    onPointerMoveCapture: (event: RoutedPointer) => void
    onPointerUpCapture: (event: RoutedPointer) => void
    onPointerCancelCapture: (event: RoutedPointer) => void
    onLostPointerCapture: (event: RoutedPointer) => void
    onMouseDownCapture: (event: React.MouseEvent<HTMLElement>) => void
    onTouchStartCapture: (event: React.TouchEvent<HTMLElement>) => void
  }
} {
  const router = useRef(new ToolInputRouter(imageEditorToolRegistry, activeTool)).current
  const [, update] = useState(0)
  const [overlayResetVersions, setOverlayResetVersions] = useState<Readonly<Record<string, number>>>({})
  const ports = useRef<RouterPorts | null>(null)
  const currentController = useRef(controller)
  currentController.current = controller
  const cancelledDispatch = useRef(false)
  const cancelledPointer = useRef<number | null>(null)
  const legacyCancel = useRef<(() => void) | null>(null)
  const composing = useRef(false)
  const lastPoint = useRef<{ x: number; y: number } | null>(null)
  const keyboard = useRef(new Map<string, ToolKeyboardHandler>())
  const pointerAvailability = useRef(new Map<string, () => boolean>())
  const bindPointerAvailability = useCallback<ToolPointerAvailabilityBinding>((slot, available) => {
    pointerAvailability.current.set(slot, available)
    return () => { if (pointerAvailability.current.get(slot) === available) pointerAvailability.current.delete(slot) }
  }, [])
  const bindKeyboard = useCallback<ToolKeyboardBinding>((slot, handler) => {
    keyboard.current.set(slot, handler)
    return () => { if (keyboard.current.get(slot) === handler) keyboard.current.delete(slot) }
  }, [])

  const cancel = (reason: InteractionCancelReason): void => {
    if (router.lifecycle.pointerId !== null) cancelledPointer.current = router.lifecycle.pointerId
    const callback = legacyCancel.current
    legacyCancel.current = null
    if (!router.cancel(reason)) callback?.()
  }
  const cancelRef = useRef(cancel)
  cancelRef.current = cancel

  useLayoutEffect(() => {
    cancelRef.current('tool-change')
    router.select(activeTool)
    update(value => value + 1)
  }, [activeTool, router])
  useLayoutEffect(() => {
    router.reset('target-change')
    cancelRef.current('target-change')
    update(value => value + 1)
    return () => { cancelRef.current('unmount'); router.reset('unmount') }
  }, [controller.document.id, controller.sessionId, router])

  useLayoutEffect(() => {
    // Dockview first mounts a panel into a detached container, so resolve its editor at event time.
    const root = (): Element | null => surfaceRef.current?.closest('[data-image-editor-v3]') ?? surfaceRef.current
    const inScope = (target: EventTarget | null): boolean => {
      const focused = target instanceof Node ? target : document.activeElement
      return Boolean(focused && root()?.contains(focused))
    }
    const isEditable = (target: EventTarget | null): boolean => target instanceof Element && Boolean(target.closest(EDITABLE))
    const available = (definition: ToolDefinition): boolean => {
      const host = currentController.current
      const session = useImageEditorSessionStoreV3.getState().sessions[host.sessionId]
      return host.profile.tools.some(entry => entry.id === definition.id && entry.readiness.state === 'ready')
        && (!definition.requiresRasterTarget || resolveImageEditorRasterBrushLayerV3(host.document, session?.selectedLayerIds ?? []).ready)
    }
    const down = (event: KeyboardEvent): void => {
      const target = event.target instanceof Element ? event.target : document.activeElement
      const historyScope = inScope(target) || (target !== null && root()?.closest('[role="dialog"]') === target)
      if (historyScope && !event.defaultPrevented && !event.isComposing && !composing.current && !event.altKey
        && !isEditable(target) && (event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault(); event.stopImmediatePropagation()
        if (root()?.closest('[inert]')) return
        cancelRef.current('escape')
        const host = currentController.current
        const redo = event.key.toLowerCase() === 'y' || event.shiftKey
        if (redo ? host.canRedo : host.canUndo) { if (redo) host.redo(); else host.undo() }
        return
      }
      if (!inScope(target)) return
      const editable = isEditable(event.target)
      const modal = [...document.querySelectorAll('[role="dialog"],[role="menu"]')].some(element =>
        !element.contains(root()) && !element.closest('[inert],[aria-hidden="true"]')
        && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')
      if (!event.defaultPrevented && !editable && !modal && !root()?.closest('[inert]')
        && !event.isComposing && !composing.current && event.keyCode !== 229
        && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
        && ['0', '1'].includes(event.key) && ports.current?.viewport) {
        event.preventDefault(); event.stopImmediatePropagation()
        cancelRef.current('temporary-tool')
        ports.current.viewport(event.key === '0' ? 'fit' : 'actual')
        return
      }
      if (!editable && !modal && !event.isComposing && !composing.current && event.keyCode !== 229
        && !event.ctrlKey && !event.metaKey && !event.altKey && !event.repeat && !router.temporaryActive
        && (['Enter', 'Delete', 'Backspace'].includes(event.key) || event.key.startsWith('Arrow'))) {
        const tool = imageEditorToolRegistry.get(router.effectiveTool)
        for (const slot of tool?.overlays ?? []) {
          if (keyboard.current.get(slot.id)?.(event)) {
            event.preventDefault(); event.stopImmediatePropagation(); return
          }
        }
      }
      if (event.key === 'Escape' && !event.isComposing && !composing.current && !editable && !modal
        && (router.lifecycle.phase !== 'idle' || legacyCancel.current || router.temporaryActive)) {
        cancelRef.current('escape'); router.reset('escape'); update(value => value + 1)
        event.preventDefault(); event.stopImmediatePropagation(); return
      }
      const selected = router.keyDown({ code: event.code, repeat: event.repeat, composing: event.isComposing || composing.current || event.keyCode === 229,
        editable, modal, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey }, available)
      if (!selected) return
      // Temporary navigation must cancel a legacy draft before it can regain input.
      cancelRef.current(router.temporaryActive ? 'temporary-tool' : 'tool-change')
      if (!router.temporaryActive) useImageEditorSessionStoreV3.getState().setActiveTool(currentController.current.sessionId, selected)
      update(value => value + 1)
      event.preventDefault(); event.stopImmediatePropagation()
    }
    const up = (event: KeyboardEvent): void => {
      if (!router.keyUp(event.code)) return
      cancelRef.current('temporary-tool'); update(value => value + 1)
      event.preventDefault(); event.stopImmediatePropagation()
    }
    const blur = (): void => { cancelRef.current('blur'); router.reset('blur'); composing.current = false; update(value => value + 1) }
    const startComposition = (event: CompositionEvent): void => { if (inScope(event.target)) composing.current = true }
    const endComposition = (): void => { composing.current = false }
    // Prevent old window-level shortcuts after the native text field already received its event.
    const textPriority = (event: KeyboardEvent): void => {
      if (inScope(event.target) && (isEditable(event.target) || event.isComposing || composing.current)) event.stopPropagation()
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', blur)
    document.addEventListener('keydown', textPriority)
    document.addEventListener('compositionstart', startComposition, true)
    document.addEventListener('compositionend', endComposition, true)
    return () => {
      window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true); window.removeEventListener('blur', blur)
      document.removeEventListener('keydown', textPriority); document.removeEventListener('compositionstart', startComposition, true); document.removeEventListener('compositionend', endComposition, true)
    }
  }, [router, surfaceRef])

  const inputOf = (event: RoutedPointer, phase: InteractionPointerInput['phase']): InteractionPointerInput => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    const sample = (value: PointerEvent | RoutedPointer): InteractionSample => ({
      pointerId: event.pointerId, pointerType: value.pointerType,
      client: { x: value.clientX, y: value.clientY }, point: coordinates?.toReference({ x: value.clientX - (rect?.left ?? 0), y: value.clientY - (rect?.top ?? 0) })
        ?? { x: value.clientX - (rect?.left ?? 0), y: value.clientY - (rect?.top ?? 0) },
      pressure: value.pressure, tiltX: value.tiltX, tiltY: value.tiltY, twist: value.twist, timestamp: value.timeStamp,
    })
    const final = sample(event)
    return { phase, sample: final, samples: [...(event.nativeEvent.getCoalescedEvents?.() ?? []).map(sample), final],
      time: { kind: 'static', sourceVersion: `${controller.document.id}:${controller.document.revision}` } }
  }
  const stop = (event: RoutedPointer): void => { event.preventDefault(); event.stopPropagation() }
  const effectiveTool = router.temporaryActive ? router.effectiveTool : activeTool
  const definition = imageEditorToolRegistry.get(effectiveTool)
  const dispatch = (phase: 'down' | 'move' | 'up', event: RoutedPointer): void => {
    if (!definition || (event.target instanceof Element && event.target.closest('[data-viewport-control]'))) return
    if (event.target instanceof Element && event.target.closest(EDITABLE)) return
    if (phase !== 'down' && cancelledPointer.current === event.pointerId) {
      if (phase === 'up') cancelledPointer.current = null
      stop(event)
      return
    }
    const port = definition.input === 'navigation' ? ports.current?.navigation : definition.input === 'move' ? ports.current?.move : null
    if (phase === 'down') {
      if (event.button !== 0 || (event.isPrimary === false && event.pointerType && event.pointerType !== 'mouse')) { stop(event); return }
      if (router.lifecycle.phase !== 'idle') { stop(event); return }
      const target = event.target instanceof Element ? event.target : null
      const slot = target?.closest('[data-tool-overlay-slot]')?.getAttribute('data-tool-overlay-slot')
      if (!port && !definition.createGesture && !definition.overlays?.some(entry => entry.id === slot)) { stop(event); return }
      // An overlay may still own its asynchronous commit after pointerup. Never cancel it to begin another stroke.
      if (definition.overlays?.some(overlay => pointerAvailability.current.get(overlay.id)?.() === false)) { stop(event); return }
      cancelledPointer.current = null
      const cancelLegacy = (): void => {
        cancelledPointer.current = event.pointerId
        if (legacyCancel.current === cancelLegacy) legacyCancel.current = null
        if (port) { port.cancel(event); return }
        for (const overlay of definition.overlays ?? []) {
          overlay.onCancel?.({ controller, bus })
          if (overlay.resetOnCancel) setOverlayResetVersions(versions => ({ ...versions, [overlay.id]: (versions[overlay.id] ?? 0) + 1 }))
        }
        if (!target?.isConnected) return
        cancelledDispatch.current = true
        try { target.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: event.pointerId })) }
        finally { cancelledDispatch.current = false }
      }
      legacyCancel.current = cancelLegacy
      const gesture = definition.createGesture?.({ controller, bus, time: inputOf(event, phase).time,
        referenceGrid: coordinates?.referenceGrid ?? controller.document.geometry })
      router.lifecycle.begin(gesture ?? { begin: () => {}, preview: () => {}, commit: () => {}, cancel: cancelLegacy }, inputOf(event, phase))
    } else if (router.lifecycle.pointerId !== event.pointerId) {
      // 预览外发起的 Dockview 分隔条/面板拖动会穿过预览；没有工具租约时交回原宿主。
      if (router.lifecycle.pointerId !== null) stop(event)
      return
    }
    if (port) {
      if (phase === 'up' && (lastPoint.current?.x !== event.clientX || lastPoint.current?.y !== event.clientY)) port.move(event)
      port[phase](event)
      if (definition.input === 'navigation') stop(event)
    }
    lastPoint.current = { x: event.clientX, y: event.clientY }
    if (definition.createGesture) stop(event)
    if (phase === 'move') router.lifecycle.preview(inputOf(event, phase))
    if (phase === 'up') {
      if (definition.legacyFinalMove && event.target instanceof Element) {
        event.target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: event.pointerId,
          pointerType: event.pointerType, clientX: event.clientX, clientY: event.clientY, pressure: event.pressure,
          tiltX: event.tiltX, tiltY: event.tiltY, twist: event.twist, shiftKey: event.shiftKey }))
      }
      // A layer transform also needs the final sample: its old hook commits its pending transform.
      void router.lifecycle.commit(inputOf(event, phase)).catch(error => logger.error('图片编辑手势失败', error, { event: 'image_editor.tools.gesture.failed' }))
      if (port) legacyCancel.current = null
    }
  }
  return {
    effectiveTool, temporaryHandActive: router.temporaryActive && effectiveTool === 'hand', overlayResetVersions,
    bindKeyboard,
    bindPointerAvailability,
    connect: (next) => { ports.current = next },
    handlers: {
      onPointerDownCapture: event => dispatch('down', event), onPointerMoveCapture: event => dispatch('move', event), onPointerUpCapture: event => dispatch('up', event),
      onPointerCancelCapture: event => {
        if (cancelledDispatch.current) return
        if (router.lifecycle.pointerId !== event.pointerId) {
          if (router.lifecycle.pointerId !== null) stop(event)
          return
        }
        cancel('pointercancel')
        stop(event)
      },
      onLostPointerCapture: event => {
        if (router.lifecycle.pointerId !== event.pointerId) {
          if (router.lifecycle.pointerId !== null) stop(event)
          return
        }
        if (router.lifecycle.phase !== 'committing') cancel('lostcapture')
        stop(event)
      },
      onMouseDownCapture: event => { if (definition?.input === 'navigation') event.stopPropagation() },
      onTouchStartCapture: event => { if (definition?.input === 'navigation') event.stopPropagation() },
    },
  }
}
