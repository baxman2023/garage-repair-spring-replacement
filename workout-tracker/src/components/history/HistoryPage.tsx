import { useState } from 'react';
import { SessionDetail } from './SessionDetail';
import { ExerciseProgressChart } from './ExerciseProgressChart';
import type { WorkoutSession, ExerciseDefinition } from '../../types/exercise';

type View = { type: 'list' } | { type: 'session'; id: string } | { type: 'exercise'; id: string };

interface Props {
  sessions: WorkoutSession[];
  exercises: ExerciseDefinition[];
  deleteSession: (id: string) => void;
}

export function HistoryPage({ sessions, exercises, deleteSession }: Props) {
  const [view, setView] = useState<View>({ type: 'list' });

  const sorted = [...sessions].sort((a, b) => b.date.localeCompare(a.date));

  if (view.type === 'session') {
    const session = sessions.find(s => s.id === view.id);
    if (!session) return null;
    return (
      <SessionDetail
        session={session}
        exercises={exercises}
        onBack={() => setView({ type: 'list' })}
        onViewExercise={(id) => setView({ type: 'exercise', id })}
      />
    );
  }

  if (view.type === 'exercise') {
    const exercise = exercises.find(e => e.id === view.id);
    if (!exercise) return null;
    return (
      <ExerciseProgressChart
        exerciseId={view.id}
        exercise={exercise}
        sessions={sessions}
        onBack={() => setView({ type: 'list' })}
      />
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-1">History</h2>
      <p className="text-text-muted text-sm mb-4">
        {sessions.length} workout{sessions.length !== 1 ? 's' : ''} logged
      </p>

      {sessions.length === 0 ? (
        <div className="text-center py-12 text-text-muted">
          <p className="text-4xl mb-3">📊</p>
          <p className="text-sm">No workouts recorded yet</p>
          <p className="text-xs mt-1">Complete a workout to see your history here</p>
        </div>
      ) : (
        <>
          {exercises.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-bold mb-2">Exercise Progress</h3>
              <div className="flex flex-wrap gap-2">
                {exercises
                  .filter(e => sessions.some(s => s.exercises.some(ex => ex.exerciseId === e.id)))
                  .map(e => (
                    <button
                      key={e.id}
                      onClick={() => setView({ type: 'exercise', id: e.id })}
                      className="bg-surface-light px-3 py-1.5 rounded-lg text-xs hover:bg-surface-lighter transition-colors"
                    >
                      {e.name}
                      {e.isBodyweight && <span className="ml-1 text-primary-light text-[10px]">BW</span>}
                    </button>
                  ))}
              </div>
            </div>
          )}

          <h3 className="text-sm font-bold mb-2">Sessions</h3>
          <div className="space-y-2">
            {sorted.map(session => {
              const totalSets = session.exercises
                .flatMap(e => e.sets.filter(s => s.completed)).length;
              const exerciseNames = session.exercises
                .map(e => exercises.find(ex => ex.id === e.exerciseId)?.name)
                .filter(Boolean);

              return (
                <div
                  key={session.id}
                  className="bg-surface-light rounded-xl p-3 flex items-center justify-between"
                >
                  <button
                    onClick={() => setView({ type: 'session', id: session.id })}
                    className="text-left flex-1"
                  >
                    <p className="font-bold text-sm">
                      {session.name || 'Workout Session'}
                    </p>
                    <p className="text-xs text-text-muted">
                      {new Date(session.date).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric'
                      })}
                      {' • '}
                      {session.exercises.length} exercises • {totalSets} sets
                    </p>
                    <p className="text-[10px] text-text-muted mt-0.5 truncate">
                      {exerciseNames.join(', ')}
                    </p>
                  </button>
                  <button
                    onClick={() => {
                      if (confirm('Delete this session?')) deleteSession(session.id);
                    }}
                    className="text-text-muted hover:text-danger text-sm px-2 ml-2"
                  >
                    🗑
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
