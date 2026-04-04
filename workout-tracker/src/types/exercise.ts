export interface ExerciseDefinition {
  id: string;
  name: string;
  isBodyweight: boolean;
  muscleGroup?: string;
}

export interface WorkoutSet {
  setNumber: number;
  reps: number;
  weight?: number;
  completed: boolean;
}

export interface ExerciseEntry {
  exerciseId: string;
  sets: WorkoutSet[];
}

export interface WorkoutSession {
  id: string;
  date: string;
  name?: string;
  exercises: ExerciseEntry[];
  notes?: string;
}
