export interface ParsedExercise {
  name: string;
  suggestedSets?: number;
  suggestedReps?: string;
  suggestedWeight?: number;
  isBodyweight: boolean;
  confidence: number;
  rawText: string;
}

export interface ParseResult {
  exercises: ParsedExercise[];
  rawText: string;
  warnings: string[];
}
