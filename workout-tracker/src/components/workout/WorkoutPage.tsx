import { useState } from 'react';
import { ExerciseCard } from './ExerciseCard';
import { AddExerciseModal } from './AddExerciseModal';
import type { ExerciseDefinition, ExerciseEntry, WorkoutSession } from '../../types/exercise';

interface Props {
  exercises: ExerciseDefinition[];
  addExercise: (name: string, isBodyweight: boolean, muscleGroup?: string) => ExerciseDefinition;
  addSession: (session: Omit<WorkoutSession, 'id'>) => WorkoutSession;
  onSessionSaved: (session: WorkoutSession) => void;
}

export function WorkoutPage({
  exercises, addExercise, addSession, onSessionSaved,
}: Props) {
  const [entries, setEntries] = useState<{ exercise: ExerciseDefinition; entry: ExerciseEntry }[]>([]);
  const [sessionName, setSessionName] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleAddExercise = (exercise: ExerciseDefinition) => {
    if (entries.some(e => e.exercise.id === exercise.id)) {
      setShowAddModal(false);
      return;
    }
    setEntries(prev => [
      ...prev,
      {
        exercise,
        entry: {
          exerciseId: exercise.id,
          sets: [{ setNumber: 1, reps: 0, completed: false }],
        },
      },
    ]);
    setShowAddModal(false);
  };

  const updateEntry = (index: number, entry: ExerciseEntry) => {
    setEntries(prev => {
      const next = [...prev];
      next[index] = { ...next[index], entry };
      return next;
    });
  };

  const removeEntry = (index: number) => {
    setEntries(prev => prev.filter((_, i) => i !== index));
  };

  const handleFinish = () => {
    if (entries.length === 0) return;
    const completedEntries = entries.filter(e =>
      e.entry.sets.some(s => s.completed)
    );
    if (completedEntries.length === 0) return;

    const session = addSession({
      date: new Date().toISOString(),
      name: sessionName || undefined,
      exercises: completedEntries.map(e => e.entry),
    });

    onSessionSaved(session);
    setEntries([]);
    setSessionName('');
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const hasCompletedSets = entries.some(e => e.entry.sets.some(s => s.completed));

  return (
    <div>
      <div className="mb-4">
        <input
          type="text"
          value={sessionName}
          onChange={e => setSessionName(e.target.value)}
          placeholder="Session name (e.g., Push Day, Leg Day)"
          className="w-full bg-surface-light rounded-lg px-3 py-2.5 text-sm border border-surface-lighter focus:border-primary outline-none"
        />
      </div>

      {entries.length === 0 && (
        <div className="text-center py-12 text-text-muted">
          <p className="text-4xl mb-3">🏋️</p>
          <p className="text-sm mb-1">No exercises added yet</p>
          <p className="text-xs">Tap the button below to start your workout,<br />or upload a workout plan from the Upload tab</p>
        </div>
      )}

      {entries.map((e, i) => (
        <ExerciseCard
          key={e.exercise.id}
          exercise={e.exercise}
          entry={e.entry}
          onChange={(entry) => updateEntry(i, entry)}
          onRemove={() => removeEntry(i)}
        />
      ))}

      <button
        onClick={() => setShowAddModal(true)}
        className="w-full bg-surface-light hover:bg-surface-lighter border border-dashed border-surface-lighter rounded-xl py-3 text-sm text-text-muted hover:text-text transition-colors mb-4"
      >
        + Add Exercise
      </button>

      {entries.length > 0 && (
        <button
          onClick={handleFinish}
          disabled={!hasCompletedSets}
          className={`w-full py-3 rounded-xl text-sm font-bold transition-colors ${
            hasCompletedSets
              ? 'bg-success hover:bg-success/90 text-white'
              : 'bg-surface-lighter text-text-muted cursor-not-allowed'
          }`}
        >
          Finish Workout
        </button>
      )}

      {saved && (
        <div className="text-center mt-3 text-success text-sm font-medium animate-pulse">
          Workout saved!
        </div>
      )}

      {showAddModal && (
        <AddExerciseModal
          exercises={exercises}
          onSelect={handleAddExercise}
          onCreateNew={addExercise}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
}
