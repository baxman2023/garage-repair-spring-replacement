import { useCallback, useState } from 'react';
import { evaluateAccolades, ACCOLADE_DEFINITIONS } from '../lib/accolades';
import type { EarnedAccolade, EvaluationContext } from '../types/accolade';
import type { WorkoutSession, ExerciseDefinition } from '../types/exercise';

export function useAccoladeEvaluator() {
  const [pendingToasts, setPendingToasts] = useState<EarnedAccolade[]>([]);

  const evaluate = useCallback((
    currentSession: WorkoutSession,
    sessions: WorkoutSession[],
    exercises: ExerciseDefinition[],
    earnedAccolades: EarnedAccolade[],
    addAccolade: (a: EarnedAccolade) => void,
  ) => {
    const ctx: EvaluationContext = {
      sessions,
      exercises,
      currentSession,
      earnedAccolades,
    };

    const newAccolades = evaluateAccolades(ctx);
    for (const a of newAccolades) {
      addAccolade(a);
    }
    if (newAccolades.length > 0) {
      setPendingToasts(newAccolades);
    }
    return newAccolades;
  }, []);

  const dismissToast = useCallback(() => {
    setPendingToasts(prev => prev.slice(1));
  }, []);

  const currentToast = pendingToasts[0];
  const toastDef = currentToast
    ? ACCOLADE_DEFINITIONS.find(d => d.id === currentToast.accoladeId)
    : undefined;

  return { evaluate, currentToast, toastDef, dismissToast, pendingToasts };
}
