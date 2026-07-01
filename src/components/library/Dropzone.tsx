import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";

const ACCEPT =
  ".pdf,.epub,.txt,.html,.htm,.md,.markdown,application/pdf,application/epub+zip,text/*";

export function Dropzone(props: { isWorking: boolean; onFile: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOver, setIsOver] = useState(false);

  const handleFile = (file?: File | null) => {
    if (file) props.onFile(file);
  };

  return (
    <button
      className={`dropzone ${isOver ? "is-over" : ""}`}
      type="button"
      onClick={() => inputRef.current?.click()}
      onDragOver={(event) => {
        event.preventDefault();
        setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsOver(false);
        handleFile(event.dataTransfer.files.item(0));
      }}
    >
      <input
        ref={inputRef}
        hidden
        type="file"
        accept={ACCEPT}
        onChange={(event) => {
          handleFile(event.target.files?.item(0));
          event.target.value = "";
        }}
      />
      {props.isWorking ? <Loader2 className="spin" size={26} /> : <Upload size={26} />}
      <strong>{props.isWorking ? "Reading your book…" : "Drop a book here"}</strong>
      <span>or click to browse — everything stays on this device</span>
      <span className="dropzone-formats">
        <span className="pill tint-peach">PDF</span>
        <span className="pill tint-sage">EPUB</span>
        <span className="pill tint-sky">TXT</span>
        <span className="pill tint-lilac">HTML</span>
        <span className="pill tint-butter">MD</span>
      </span>
    </button>
  );
}
