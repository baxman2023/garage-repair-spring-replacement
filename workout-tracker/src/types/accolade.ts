import type { WorkoutSession, ExerciseDefinition } from './exercise';

export type AccoladeCategory =
  | 'weight_pr'
  | 'rep_pr'
  | 'volume_milestone'
  | 'consistency'
  | 'variety'
  | 'first';

export interface EvaluationContext {
  sessions: WorkoutSession[];
  exercises: ExerciseDefinition[];
  currentSession: WorkoutSession;
  earnedAccolades: EarnedAccolade[];
}

export interface AccoladeDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: AccoladeCategory;
  evaluate: (ctx: EvaluationContext) => boolean | { earned: boolean; details?: string };
}

export interface EarnedAccolade {
  accoladeId: string;
  earnedAt: string;
  exerciseId?: string;
  details?: string;
}
