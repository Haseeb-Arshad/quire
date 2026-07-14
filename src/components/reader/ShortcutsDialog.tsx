import { X } from "lucide-react";

const SHORTCUTS: Array<[string[], string]> = [
  [["C"], "Open chapter navigator"],
  [["/"], "Focus search"],
  [["Enter"], "Next search match"],
  [["Shift", "Enter"], "Previous search match"],
  [["B"], "Bookmark where you are (paragraph or page)"],
  [["←"], "Previous chapter (chapter layout)"],
  [["→"], "Next chapter (chapter layout)"],
  [["["], "Previous chapter"],
  [["]"], "Next chapter"],
  [["Esc"], "Close dialogs"],
  [["?"], "This help"]
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="chapter-overlay" onClick={onClose}>
      <div
        className="chapter-panel shortcuts-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shortcuts-head">
          <h3>Keyboard shortcuts</h3>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>
        <table className="shortcuts-table">
          <tbody>
            {SHORTCUTS.map(([keys, label]) => (
              <tr key={label}>
                <td>
                  {keys.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </td>
                <td>{label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Kbd({ children }: { children: string }) {
  return <kbd className="kbd">{children}</kbd>;
}
