import { useState } from 'react';
import type { ParsedExercise } from '../../types/parser';

interface Props {
  exercises: ParsedExercise[];
  warnings: string[];
  onConfirm: (exercises: ParsedExercise[]) => void;
  onCancel: () => void;
}

export function ParsedExerciseList({ exercises: initial, warnings, onConfirm, onCancel }: Props) {
  const [exercises, setExercises] = useState(initial);

  const update = (index: number, updates: Partial<ParsedExercise>) => {
    setExercises(prev => prev.map((e, i) => i === index ? { ...e, ...updates } : e));
  };

  const remove = (index: number) => {
    setExercises(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-sm">Parsed Exercises ({exercises.length})</h3>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs border border-surface-lighter rounded-lg text-text-muted hover:text-text transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(exercises)}
            disabled={exercises.length === 0}
            className="px-3 py-1.5 text-xs bg-success hover:bg-success/90 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            Add to Library
          </button>
        </div>
      </div>

      {warnings.map((w, i) => (
        <p key={i} className="text-xs text-accent mb-2">{w}</p>
      ))}

      {exercises.length === 0 ? (
        <p className="text-sm text-text-muted text-center py-6">
          No exercises found. Try a different document or add exercises manually from the Workout tab.
        </p>
      ) : (
        <div className="space-y-2">
          {exercises.map((ex, i) => (
            <div key={i} className="bg-surface-light rounded-lg p-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <input
                  type="text"
                  value={ex.name}
                  onChange={e => update(i, { name: e.target.value })}
                  className="flex-1 bg-surface text-sm rounded px-2 py-1 border border-surface-lighter focus:border-primary outline-none"
                />
                <button
                  onClick={() => remove(i)}
                  className="text-text-muted hover:text-danger text-sm px-1"
                >
                  ×
                </button>
              </div>

              <div className="flex items-center gap-3 text-xs">
                {ex.suggestedSets && (
                  <span className="text-text-muted">
                    {ex.suggestedSets} sets × {ex.suggestedReps || '?'} reps
                  </span>
                )}
                {ex.suggestedWeight && (
                  <span className="text-text-muted">{ex.suggestedWeight} lbs</span>
                )}
                <label className="flex items-center gap-1 ml-auto">
                  <input
                    type="checkbox"
                    checked={ex.isBodyweight}
                    onChange={e => update(i, { isBodyweight: e.target.checked })}
                    className="rounded"
                  />
                  <span className="text-text-muted">Bodyweight</span>
                </label>
              </div>

              <p className="text-[10px] text-text-muted mt-1 truncate" title={ex.rawText}>
                Source: {ex.rawText}
              </p>

              <div className="mt-1">
                <div className="flex items-center gap-1">
                  <div className="flex-1 bg-surface-lighter rounded-full h-1">
                    <div
                      className={`h-1 rounded-full ${
                        ex.confidence > 0.7 ? 'bg-success' : ex.confidence > 0.4 ? 'bg-accent' : 'bg-danger'
                      }`}
                      style={{ width: `${ex.confidence * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-text-muted">
                    {Math.round(ex.confidence * 100)}%
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
