import type { WorkoutSession, ExerciseDefinition } from '../types/exercise';

export interface ExerciseProgress {
  date: string;
  maxWeight: number;
  maxReps: number;
  totalVolume: number;
  estimated1RM: number;
  bestSetWeight: number;
  bestSetReps: number;
}

export interface PersonalRecord {
  exerciseId: string;
  exerciseName: string;
  type: 'weight' | 'reps' | 'volume' | 'estimated1RM';
  value: number;
  date: string;
  previousValue?: number;
}

// Epley formula: weight * (1 + reps / 30)
function estimate1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30));
}

export function getExerciseProgress(
  exerciseId: string,
  sessions: WorkoutSession[]
): ExerciseProgress[] {
  return sessions
    .filter(s => s.exercises.some(e => e.exerciseId === exerciseId))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(session => {
      const entry = session.exercises.find(e => e.exerciseId === exerciseId)!;
      const completedSets = entry.sets.filter(s => s.completed);

      let maxWeight = 0;
      let maxReps = 0;
      let totalVolume = 0;
      let estimated1RM = 0;
      let bestSetWeight = 0;
      let bestSetReps = 0;

      for (const set of completedSets) {
        const w = set.weight ?? 0;
        maxWeight = Math.max(maxWeight, w);
        maxReps = Math.max(maxReps, set.reps);
        totalVolume += set.reps * (w || 1);

        const e1rm = estimate1RM(w, set.reps);
        if (e1rm > estimated1RM) {
          estimated1RM = e1rm;
          bestSetWeight = w;
          bestSetReps = set.reps;
        }
      }

      return {
        date: session.date,
        maxWeight,
        maxReps,
        totalVolume,
        estimated1RM,
        bestSetWeight,
        bestSetReps,
      };
    });
}

export function detectNewPRs(
  currentSession: WorkoutSession,
  allSessions: WorkoutSession[],
  exercises: ExerciseDefinition[]
): PersonalRecord[] {
  const prs: PersonalRecord[] = [];
  const previousSessions = allSessions.filter(s => s.id !== currentSession.id);

  for (const entry of currentSession.exercises) {
    const exercise = exercises.find(e => e.id === entry.exerciseId);
    if (!exercise) continue;

    const completedSets = entry.sets.filter(s => s.completed);
    if (completedSets.length === 0) continue;

    const currentMaxWeight = Math.max(...completedSets.map(s => s.weight ?? 0));
    const currentMaxReps = Math.max(...completedSets.map(s => s.reps));
    const currentVolume = completedSets.reduce((sum, s) => sum + s.reps * (s.weight ?? 1), 0);

    // Find previous bests
    let prevMaxWeight = 0;
    let prevMaxReps = 0;
    let prevMaxVolume = 0;

    for (const session of previousSessions) {
      const prevEntry = session.exercises.find(e => e.exerciseId === entry.exerciseId);
      if (!prevEntry) continue;
      const prevCompleted = prevEntry.sets.filter(s => s.completed);
      prevMaxWeight = Math.max(prevMaxWeight, ...prevCompleted.map(s => s.weight ?? 0));
      prevMaxReps = Math.max(prevMaxReps, ...prevCompleted.map(s => s.reps));
      prevMaxVolume = Math.max(prevMaxVolume, prevCompleted.reduce((sum, s) => sum + s.reps * (s.weight ?? 1), 0));
    }

    if (currentMaxWeight > prevMaxWeight && currentMaxWeight > 0 && previousSessions.length > 0) {
      prs.push({
        exerciseId: entry.exerciseId,
        exerciseName: exercise.name,
        type: 'weight',
        value: currentMaxWeight,
        date: currentSession.date,
        previousValue: prevMaxWeight,
      });
    }

    if (currentMaxReps > prevMaxReps && previousSessions.length > 0) {
      prs.push({
        exerciseId: entry.exerciseId,
        exerciseName: exercise.name,
        type: 'reps',
        value: currentMaxReps,
        date: currentSession.date,
        previousValue: prevMaxReps,
      });
    }

    if (currentVolume > prevMaxVolume && previousSessions.length > 0) {
      prs.push({
        exerciseId: entry.exerciseId,
        exerciseName: exercise.name,
        type: 'volume',
        value: currentVolume,
        date: currentSession.date,
        previousValue: prevMaxVolume,
      });
    }
  }

  return prs;
}
