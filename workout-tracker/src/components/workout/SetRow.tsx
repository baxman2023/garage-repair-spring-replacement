import type { WorkoutSet } from '../../types/exercise';

interface Props {
  set: WorkoutSet;
  isBodyweight: boolean;
  onChange: (set: WorkoutSet) => void;
  onRemove: () => void;
}

export function SetRow({ set, isBodyweight, onChange, onRemove }: Props) {
  return (
    <div className={`flex items-center gap-2 py-2 px-3 rounded-lg mb-1 ${
      set.completed ? 'bg-success/10' : 'bg-surface-lighter/50'
    }`}>
      <span className="text-xs text-text-muted w-6">#{set.setNumber}</span>

      <div className="flex items-center gap-1 flex-1">
        <input
          type="number"
          min={0}
          value={set.reps || ''}
          onChange={e => onChange({ ...set, reps: parseInt(e.target.value) || 0 })}
          placeholder="Reps"
          className="w-16 bg-surface text-center text-sm rounded px-2 py-1.5 border border-surface-lighter focus:border-primary outline-none"
        />
        <span className="text-xs text-text-muted">reps</span>
      </div>

      {isBodyweight ? (
        <span className="bg-primary/20 text-primary-light text-xs font-bold px-2 py-1 rounded">
          BW
        </span>
      ) : (
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            step={2.5}
            value={set.weight || ''}
            onChange={e => onChange({ ...set, weight: parseFloat(e.target.value) || 0 })}
            placeholder="Weight"
            className="w-20 bg-surface text-center text-sm rounded px-2 py-1.5 border border-surface-lighter focus:border-primary outline-none"
          />
          <span className="text-xs text-text-muted">lbs</span>
        </div>
      )}

      <button
        onClick={() => onChange({ ...set, completed: !set.completed })}
        className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm transition-colors ${
          set.completed
            ? 'bg-success border-success text-white'
            : 'border-surface-lighter text-text-muted hover:border-success'
        }`}
      >
        {set.completed ? '✓' : ''}
      </button>

      <button
        onClick={onRemove}
        className="text-text-muted hover:text-danger text-sm px-1"
      >
        ×
      </button>
    </div>
  );
}
