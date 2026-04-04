import { SetRow } from './SetRow';
import type { ExerciseDefinition, ExerciseEntry, WorkoutSet } from '../../types/exercise';

interface Props {
  exercise: ExerciseDefinition;
  entry: ExerciseEntry;
  onChange: (entry: ExerciseEntry) => void;
  onRemove: () => void;
}

export function ExerciseCard({ exercise, entry, onChange, onRemove }: Props) {
  const updateSet = (index: number, set: WorkoutSet) => {
    const newSets = [...entry.sets];
    newSets[index] = set;
    onChange({ ...entry, sets: newSets });
  };

  const removeSet = (index: number) => {
    const newSets = entry.sets.filter((_, i) => i !== index)
      .map((s, i) => ({ ...s, setNumber: i + 1 }));
    onChange({ ...entry, sets: newSets });
  };

  const addSet = () => {
    const lastSet = entry.sets[entry.sets.length - 1];
    const newSet: WorkoutSet = {
      setNumber: entry.sets.length + 1,
      reps: lastSet?.reps || 0,
      weight: lastSet?.weight,
      completed: false,
    };
    onChange({ ...entry, sets: [...entry.sets, newSet] });
  };

  const completedCount = entry.sets.filter(s => s.completed).length;

  return (
    <div className="bg-surface-light rounded-xl p-4 mb-3">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-bold text-sm">{exercise.name}</h3>
          <div className="flex items-center gap-2 mt-0.5">
            {exercise.isBodyweight && (
              <span className="bg-primary/20 text-primary-light text-[10px] font-bold px-1.5 py-0.5 rounded">
                BODYWEIGHT
              </span>
            )}
            {exercise.muscleGroup && (
              <span className="text-[10px] text-text-muted">{exercise.muscleGroup}</span>
            )}
            <span className="text-[10px] text-text-muted">
              {completedCount}/{entry.sets.length} sets
            </span>
          </div>
        </div>
        <button
          onClick={onRemove}
          className="text-text-muted hover:text-danger text-lg"
        >
          ×
        </button>
      </div>

      {entry.sets.map((set, i) => (
        <SetRow
          key={i}
          set={set}
          isBodyweight={exercise.isBodyweight}
          onChange={(s) => updateSet(i, s)}
          onRemove={() => removeSet(i)}
        />
      ))}

      <button
        onClick={addSet}
        className="w-full mt-2 py-1.5 text-xs text-primary-light border border-dashed border-surface-lighter rounded-lg hover:border-primary transition-colors"
      >
        + Add Set
      </button>
    </div>
  );
}
