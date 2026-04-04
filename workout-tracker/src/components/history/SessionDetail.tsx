import type { WorkoutSession, ExerciseDefinition } from '../../types/exercise';

interface Props {
  session: WorkoutSession;
  exercises: ExerciseDefinition[];
  onBack: () => void;
  onViewExercise: (exerciseId: string) => void;
}

export function SessionDetail({ session, exercises, onBack, onViewExercise }: Props) {
  const totalVolume = session.exercises
    .flatMap(e => e.sets.filter(s => s.completed))
    .reduce((sum, s) => sum + s.reps * (s.weight ?? 0), 0);

  const totalSets = session.exercises
    .flatMap(e => e.sets.filter(s => s.completed)).length;

  return (
    <div>
      <button
        onClick={onBack}
        className="text-sm text-primary-light hover:text-primary mb-3 flex items-center gap-1"
      >
        ← Back
      </button>

      <h2 className="text-xl font-bold mb-0.5">
        {session.name || 'Workout Session'}
      </h2>
      <p className="text-sm text-text-muted mb-4">
        {new Date(session.date).toLocaleDateString('en-US', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        })}
      </p>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-surface-light rounded-lg p-2 text-center">
          <p className="text-lg font-bold">{session.exercises.length}</p>
          <p className="text-[10px] text-text-muted">Exercises</p>
        </div>
        <div className="bg-surface-light rounded-lg p-2 text-center">
          <p className="text-lg font-bold">{totalSets}</p>
          <p className="text-[10px] text-text-muted">Sets</p>
        </div>
        <div className="bg-surface-light rounded-lg p-2 text-center">
          <p className="text-lg font-bold">{totalVolume.toLocaleString()}</p>
          <p className="text-[10px] text-text-muted">Volume</p>
        </div>
      </div>

      {session.exercises.map((entry, i) => {
        const exercise = exercises.find(e => e.id === entry.exerciseId);
        if (!exercise) return null;

        return (
          <div key={i} className="bg-surface-light rounded-xl p-3 mb-2">
            <button
              onClick={() => onViewExercise(entry.exerciseId)}
              className="font-bold text-sm text-primary-light hover:text-primary mb-2 text-left"
            >
              {exercise.name}
              {exercise.isBodyweight && (
                <span className="ml-2 text-[10px] bg-primary/20 px-1.5 py-0.5 rounded">BW</span>
              )}
            </button>

            <div className="space-y-1">
              {entry.sets.filter(s => s.completed).map((set, j) => (
                <div key={j} className="flex items-center gap-3 text-xs text-text-muted">
                  <span className="w-5">#{set.setNumber}</span>
                  <span>{set.reps} reps</span>
                  {!exercise.isBodyweight && set.weight && (
                    <span>@ {set.weight} lbs</span>
                  )}
                  {exercise.isBodyweight && (
                    <span className="text-primary-light">BW</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
