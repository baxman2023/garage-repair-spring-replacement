import { ACCOLADE_DEFINITIONS } from '../../lib/accolades';
import type { EarnedAccolade } from '../../types/accolade';
import { BadgeCard } from './BadgeCard';

interface Props {
  earnedAccolades: EarnedAccolade[];
}

export function AccoladesPage({ earnedAccolades }: Props) {
  const earnedCount = earnedAccolades.length;
  const totalCount = ACCOLADE_DEFINITIONS.length;

  return (
    <div>
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold mb-1">Accolades</h2>
        <p className="text-text-muted">
          {earnedCount} / {totalCount} unlocked
        </p>
        <div className="w-full bg-surface-lighter rounded-full h-2 mt-3">
          <div
            className="bg-accent h-2 rounded-full transition-all"
            style={{ width: `${(earnedCount / totalCount) * 100}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {ACCOLADE_DEFINITIONS.map(def => (
          <BadgeCard
            key={def.id}
            definition={def}
            earned={earnedAccolades.find(a => a.accoladeId === def.id)}
          />
        ))}
      </div>
    </div>
  );
}
