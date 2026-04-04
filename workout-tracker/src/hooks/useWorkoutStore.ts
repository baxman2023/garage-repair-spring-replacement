import { useCallback } from 'react';
import { v4 as uuid } from 'uuid';
import { useLocalStorage } from './useLocalStorage';
import type { ExerciseDefinition, WorkoutSession } from '../types/exercise';
import type { EarnedAccolade } from '../types/accolade';

const EXERCISES_KEY = 'wt_exercises';
const SESSIONS_KEY = 'wt_sessions';
const ACCOLADES_KEY = 'wt_accolades';

export function useWorkoutStore() {
  const [exercises, setExercises] = useLocalStorage<ExerciseDefinition[]>(EXERCISES_KEY, []);
  const [sessions, setSessions] = useLocalStorage<WorkoutSession[]>(SESSIONS_KEY, []);
  const [earnedAccolades, setEarnedAccolades] = useLocalStorage<EarnedAccolade[]>(ACCOLADES_KEY, []);

  const addExercise = useCallback((name: string, isBodyweight: boolean, muscleGroup?: string) => {
    const existing = exercises.find(e => e.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const ex: ExerciseDefinition = { id: uuid(), name, isBodyweight, muscleGroup };
    setExercises(prev => [...prev, ex]);
    return ex;
  }, [exercises, setExercises]);

  const addSession = useCallback((session: Omit<WorkoutSession, 'id'>) => {
    const full: WorkoutSession = { ...session, id: uuid() };
    setSessions(prev => [...prev, full]);
    return full;
  }, [setSessions]);

  const deleteSession = useCallback((id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
  }, [setSessions]);

  const addAccolade = useCallback((accolade: EarnedAccolade) => {
    setEarnedAccolades(prev => [...prev, accolade]);
  }, [setEarnedAccolades]);

  const getExerciseById = useCallback((id: string) => {
    return exercises.find(e => e.id === id);
  }, [exercises]);

  const getSessionsForExercise = useCallback((exerciseId: string) => {
    return sessions.filter(s => s.exercises.some(e => e.exerciseId === exerciseId));
  }, [sessions]);

  return {
    exercises,
    sessions,
    earnedAccolades,
    setExercises,
    addExercise,
    addSession,
    deleteSession,
    addAccolade,
    setEarnedAccolades,
    getExerciseById,
    getSessionsForExercise,
  };
}
