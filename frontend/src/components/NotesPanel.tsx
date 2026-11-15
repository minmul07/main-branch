type NotesPanelProps = { page: number; onClose: () => void }

export default function NotesPanel({ page, onClose }: NotesPanelProps) {
  return (
    <aside className="notes-panel" aria-label="메모">
      <header className="notes-panel-header">
        <h3>{page}페이지 메모</h3>
        <button type="button" className="notes-panel-close" aria-label="메모 닫기" onClick={onClose}>×</button>
      </header>
      <p className="notes-empty">메모가 없습니다.</p>
    </aside>
  )
}