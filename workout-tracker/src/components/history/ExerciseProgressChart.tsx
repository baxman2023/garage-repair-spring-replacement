import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { getExerciseProgress } from '../../lib/progressCalculator';
import type { WorkoutSession, ExerciseDefinition } from '../../types/exercise';

type Metric = 'maxWeight' | 'maxReps' | 'totalVolume' | 'estimated1RM';

interface Props {
  exerciseId: string;
  exercise: ExerciseDefinition;
  sessions: WorkoutSession[];
  onBack: () => void;
}

export function ExerciseProgressChart({ exerciseId, exercise, sessions, onBack }: Props) {
  const [metric, setMetric] = useState<Metric>(exercise.isBodyweight ? 'maxReps' : 'maxWeight');
  const progress = getExerciseProgress(exerciseId, sessions);

  const metricLabels: Record<Metric, string> = {
    maxWeight: 'Max Weight (lbs)',
    maxReps: 'Max Reps',
    totalVolume: 'Total Volume',
    estimated1RM: 'Est. 1RM (lbs)',
  };

  const chartData = progress.map(p => ({
    date: new Date(p.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    value: p[metric],
  }));

  const availableMetrics: Metric[] = exercise.isBodyweight
    ? ['maxReps', 'totalVolume']
    : ['maxWeight', 'maxReps', 'totalVolume', 'estimated1RM'];

  return (
    <div>
      <button
        onClick={onBack}
        className="text-sm text-primary-light hover:text-primary mb-3 flex items-center gap-1"
      >
        ← Back
      </button>

      <h2 className="text-xl font-bold mb-1">{exercise.name}</h2>
      {exercise.isBodyweight && (
        <span className="text-xs bg-primary/20 text-primary-light px-2 py-0.5 rounded">BODYWEIGHT</span>
      )}

      <div className="flex gap-1 mt-3 mb-4 flex-wrap">
        {availableMetrics.map(m => (
          <button
            key={m}
            onClick={() => setMetric(m)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              metric === m
                ? 'bg-primary text-white'
                : 'bg-surface-lighter text-text-muted hover:text-text'
            }`}
          >
            {metricLabels[m]}
          </button>
        ))}
      </div>

      {chartData.length < 2 ? (
        <div className="text-center py-12 text-text-muted">
          <p className="text-sm">Need at least 2 sessions to show a chart</p>
          <p className="text-xs mt-1">{chartData.length} session(s) recorded</p>
        </div>
      ) : (
        <div className="bg-surface-light rounded-xl p-4">
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#363650" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#2a2a3e',
                  border: '1px solid #363650',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#818cf8"
                strokeWidth={2}
                dot={{ fill: '#6366f1', r: 4 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {progress.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="bg-surface-light rounded-xl p-3 text-center">
            <p className="text-xs text-text-muted">Sessions</p>
            <p className="text-xl font-bold">{progress.length}</p>
          </div>
          <div className="bg-surface-light rounded-xl p-3 text-center">
            <p className="text-xs text-text-muted">
              {exercise.isBodyweight ? 'Best Reps' : 'Best Weight'}
            </p>
            <p className="text-xl font-bold">
              {exercise.isBodyweight
                ? Math.max(...progress.map(p => p.maxReps))
                : `${Math.max(...progress.map(p => p.maxWeight))} lbs`
              }
            </p>
          </div>
          {!exercise.isBodyweight && (
            <div className="bg-surface-light rounded-xl p-3 text-center">
              <p className="text-xs text-text-muted">Est. 1RM</p>
              <p className="text-xl font-bold">
                {Math.max(...progress.map(p => p.estimated1RM))} lbs
              </p>
            </div>
          )}
          <div className="bg-surface-light rounded-xl p-3 text-center">
            <p className="text-xs text-text-muted">Total Volume</p>
            <p className="text-xl font-bold">
              {progress.reduce((sum, p) => sum + p.totalVolume, 0).toLocaleString()}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
