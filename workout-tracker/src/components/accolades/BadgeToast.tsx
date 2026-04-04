import { useEffect } from 'react';
import type { AccoladeDefinition } from '../../types/accolade';

interface Props {
  accolade: AccoladeDefinition;
  onDismiss: () => void;
}

export function BadgeToast({ accolade, onDismiss }: Props) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] animate-slide-down">
      <div
        className="bg-accent/95 text-surface rounded-xl px-5 py-3 shadow-lg flex items-center gap-3 cursor-pointer min-w-[280px]"
        onClick={onDismiss}
      >
        <span className="text-3xl">{accolade.icon}</span>
        <div>
          <p className="font-bold text-sm">Achievement Unlocked!</p>
          <p className="font-semibold">{accolade.name}</p>
          <p className="text-xs opacity-80">{accolade.description}</p>
        </div>
      </div>
    </div>
  );
}
