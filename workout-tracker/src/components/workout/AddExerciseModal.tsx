import { useState } from 'react';
import type { ExerciseDefinition } from '../../types/exercise';

interface Props {
  exercises: ExerciseDefinition[];
  onSelect: (exercise: ExerciseDefinition) => void;
  onCreateNew: (name: string, isBodyweight: boolean, muscleGroup?: string) => ExerciseDefinition;
  onClose: () => void;
}

export function AddExerciseModal({ exercises, onSelect, onCreateNew, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [isBodyweight, setIsBodyweight] = useState(false);
  const [muscleGroup, setMuscleGroup] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const filtered = exercises.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = () => {
    if (!newName.trim()) return;
    const ex = onCreateNew(newName.trim(), isBodyweight, muscleGroup || undefined);
    onSelect(ex);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-surface-light w-full max-w-lg max-h-[80vh] rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col">
        <div className="p-4 border-b border-surface-lighter flex justify-between items-center">
          <h2 className="font-bold">Add Exercise</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text text-lg">×</button>
        </div>

        {!showCreate ? (
          <>
            <div className="p-4">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search exercises..."
                className="w-full bg-surface rounded-lg px-3 py-2 text-sm border border-surface-lighter focus:border-primary outline-none"
                autoFocus
              />
            </div>

            <div className="flex-1 overflow-y-auto px-4 pb-2">
              {filtered.length > 0 ? (
                filtered.map(ex => (
                  <button
                    key={ex.id}
                    onClick={() => onSelect(ex)}
                    className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-surface-lighter transition-colors flex items-center justify-between"
                  >
                    <span className="text-sm">{ex.name}</span>
                    <span className="flex items-center gap-2">
                      {ex.isBodyweight && (
                        <span className="text-[10px] bg-primary/20 text-primary-light px-1.5 py-0.5 rounded">BW</span>
                      )}
                      {ex.muscleGroup && (
                        <span className="text-[10px] text-text-muted">{ex.muscleGroup}</span>
                      )}
                    </span>
                  </button>
                ))
              ) : (
                <p className="text-text-muted text-sm text-center py-4">
                  {search ? 'No matching exercises' : 'No exercises in library yet'}
                </p>
              )}
            </div>

            <div className="p-4 border-t border-surface-lighter">
              <button
                onClick={() => {
                  setShowCreate(true);
                  setNewName(search);
                }}
                className="w-full bg-primary hover:bg-primary-dark text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                + Create New Exercise
              </button>
            </div>
          </>
        ) : (
          <div className="p-4 space-y-3">
            <div>
              <label className="text-xs text-text-muted block mb-1">Exercise Name</label>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                className="w-full bg-surface rounded-lg px-3 py-2 text-sm border border-surface-lighter focus:border-primary outline-none"
                autoFocus
              />
            </div>

            <div>
              <label className="text-xs text-text-muted block mb-1">Muscle Group (optional)</label>
              <select
                value={muscleGroup}
                onChange={e => setMuscleGroup(e.target.value)}
                className="w-full bg-surface rounded-lg px-3 py-2 text-sm border border-surface-lighter focus:border-primary outline-none"
              >
                <option value="">None</option>
                <option value="Chest">Chest</option>
                <option value="Back">Back</option>
                <option value="Shoulders">Shoulders</option>
                <option value="Arms">Arms</option>
                <option value="Legs">Legs</option>
                <option value="Core">Core</option>
                <option value="Glutes">Glutes</option>
                <option value="Full Body">Full Body</option>
              </select>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isBodyweight}
                onChange={e => setIsBodyweight(e.target.checked)}
                className="rounded"
              />
              Bodyweight exercise (no weight tracking)
            </label>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 py-2.5 rounded-lg text-sm border border-surface-lighter text-text-muted hover:text-text transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleCreate}
                className="flex-1 bg-primary hover:bg-primary-dark text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
              >
                Create & Add
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
