import { useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { MousePointer2 } from 'lucide-react'
import { directorCursorSnapshot, subscribeDirectorCursor } from './application/recordingDirectorCursor'

/** Visible in the recorded application; never sends OS mouse events or steals input. */
export function RecordingDirectorCursor(): React.ReactElement | null {
  const cursor = useSyncExternalStore(subscribeDirectorCursor, directorCursorSnapshot)
  return cursor ? createPortal(<div aria-hidden className="pointer-events-none fixed left-0 top-0 z-tooltip transition-transform duration-500" style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}>
    <MousePointer2 className={cursor.clicking ? 'h-8 w-8 fill-accent text-accent-text' : 'h-8 w-8 fill-panel text-text1'} />
  </div>, document.body) : null
}
