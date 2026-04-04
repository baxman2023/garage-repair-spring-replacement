import type { AccoladeDefinition } from '../../types/accolade';
import type { EarnedAccolade } from '../../types/accolade';

interface Props {
  definition: AccoladeDefinition;
  earned?: EarnedAccolade;
}

export function BadgeCard({ definition, earned }: Props) {
  return (
    <div
      className={`rounded-xl p-4 text-center transition-all ${
        earned
          ? 'bg-surface-light border border-accent/30'
          : 'bg-surface-light/50 border border-surface-lighter opacity-40 grayscale'
      }`}
    >
      <span className="text-4xl block mb-2">{definition.icon}</span>
      <h3 className="font-bold text-sm mb-1">{definition.name}</h3>
      <p className="text-xs text-text-muted">{definition.description}</p>
      {earned && (
        <p className="text-xs text-accent mt-2">
          {new Date(earned.earnedAt).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}
