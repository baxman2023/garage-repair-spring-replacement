import { useState } from 'react';
import { FileDropZone } from './FileDropZone';
import { ParsedExerciseList } from './ParsedExerciseList';
import { parseWorkoutDocument } from '../../lib/parser';
import type { ParsedExercise, ParseResult } from '../../types/parser';
import type { ExerciseDefinition } from '../../types/exercise';
import type { EarnedAccolade } from '../../types/accolade';
import { ACCOLADE_DEFINITIONS } from '../../lib/accolades';

interface Props {
  addExercise: (name: string, isBodyweight: boolean, muscleGroup?: string) => ExerciseDefinition;
  earnedAccolades: EarnedAccolade[];
  addAccolade: (a: EarnedAccolade) => void;
}

export function UploadPage({ addExercise, earnedAccolades, addAccolade }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState(0);

  const handleFile = async (file: File) => {
    setLoading(true);
    setError(null);
    setResult(null);
    setImportedCount(0);

    try {
      const parsed = await parseWorkoutDocument(file);
      setResult(parsed);
    } catch (err) {
      setError(`Failed to parse document: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = (exercises: ParsedExercise[]) => {
    let count = 0;
    for (const ex of exercises) {
      addExercise(ex.name, ex.isBodyweight);
      count++;
    }
    setImportedCount(count);
    setResult(null);

    // Award Upload Pro accolade
    if (!earnedAccolades.some(a => a.accoladeId === 'upload_pro')) {
      const def = ACCOLADE_DEFINITIONS.find(d => d.id === 'upload_pro');
      if (def) {
        addAccolade({
          accoladeId: 'upload_pro',
          earnedAt: new Date().toISOString(),
          details: `Parsed ${count} exercises`,
        });
      }
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold mb-1">Upload Workout</h2>
      <p className="text-text-muted text-sm mb-4">
        Upload a PDF or DOCX file containing your workout plan. We'll extract the exercises automatically.
      </p>

      {!result && (
        <FileDropZone onFile={handleFile} loading={loading} />
      )}

      {error && (
        <div className="mt-4 bg-danger/10 border border-danger/30 rounded-lg p-3 text-sm text-danger">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-4">
          <ParsedExerciseList
            exercises={result.exercises}
            warnings={result.warnings}
            onConfirm={handleConfirm}
            onCancel={() => setResult(null)}
          />
        </div>
      )}

      {importedCount > 0 && !result && (
        <div className="mt-4 bg-success/10 border border-success/30 rounded-lg p-3 text-sm text-success text-center">
          Successfully imported {importedCount} exercises! Head to the Workout tab to start tracking.
        </div>
      )}

      <div className="mt-6 bg-surface-light rounded-xl p-4">
        <h3 className="font-bold text-sm mb-2">Tips for best results</h3>
        <ul className="text-xs text-text-muted space-y-1.5">
          <li>• Use standard notation like "3x10" or "3 sets of 10"</li>
          <li>• Include weight with units (e.g., "135 lbs" or "60 kg")</li>
          <li>• Common exercises are detected automatically</li>
          <li>• Bodyweight exercises (push-ups, pull-ups, etc.) are auto-tagged</li>
          <li>• You can edit any parsed exercise before importing</li>
        </ul>
      </div>
    </div>
  );
}
