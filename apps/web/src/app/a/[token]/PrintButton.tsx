'use client';

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      style={{
        padding: '0.35rem 0.7rem',
        borderRadius: 6,
        border: '1px solid #444',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
        fontSize: 12,
      }}
    >
      Print / save as PDF
    </button>
  );
}
