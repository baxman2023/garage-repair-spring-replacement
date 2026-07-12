'use client';

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="btn btn-sm">
      Print / save as PDF
    </button>
  );
}
