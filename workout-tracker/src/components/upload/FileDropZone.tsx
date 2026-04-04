import { useState, useRef } from 'react';

interface Props {
  onFile: (file: File) => void;
  loading: boolean;
}

export function FileDropZone({ onFile, loading }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFile(file);
  };

  return (
    <div
      onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
        isDragging
          ? 'border-primary bg-primary/10'
          : 'border-surface-lighter hover:border-primary/50'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.doc,.docx,.txt"
        onChange={handleChange}
        className="hidden"
      />

      {loading ? (
        <div>
          <div className="text-4xl mb-3 animate-spin">⏳</div>
          <p className="text-sm text-text-muted">Parsing document...</p>
        </div>
      ) : (
        <div>
          <div className="text-4xl mb-3">📄</div>
          <p className="text-sm font-medium mb-1">Drop your workout document here</p>
          <p className="text-xs text-text-muted">Supports PDF, DOCX, DOC, and TXT files</p>
        </div>
      )}
    </div>
  );
}
