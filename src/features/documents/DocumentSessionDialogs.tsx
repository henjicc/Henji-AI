import { DocumentSaveNameDialog } from './DocumentSaveNameDialog'
import { useDocumentPromptStore } from './documentPromptStore'

export function DocumentSessionDialogs(): JSX.Element | null {
  const current = useDocumentPromptStore((state) => state.queue[0])
  if (!current) return null
  switch (current.type) {
    case 'saveName':
      return <DocumentSaveNameDialog key={current.key} info={current.info} onDone={current.resolve} />
  }
}
