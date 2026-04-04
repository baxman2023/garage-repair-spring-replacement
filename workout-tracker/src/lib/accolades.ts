import type { AccoladeDefinition, EvaluationContext, EarnedAccolade } from '../types/accolade';

export const ACCOLADE_DEFINITIONS: AccoladeDefinition[] = [
  {
    id: 'first_rep',
    name: 'First Rep',
    description: 'Complete your first workout session',
    icon: '🏋️',
    category: 'first',
    evaluate: (ctx) => ctx.sessions.length === 1,
  },
  {
    id: 'upload_pro',
    name: 'Upload Pro',
    description: 'Parse your first workout document',
    icon: '📄',
    category: 'first',
    evaluate: () => false, // Triggered manually from upload flow
  },
  {
    id: 'creature_of_habit',
    name: 'Creature of Habit',
    description: 'Complete 3 workouts in a single week',
    icon: '📅',
    category: 'consistency',
    evaluate: (ctx) => {
      const now = new Date(ctx.currentSession.date);
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7);
      const weekSessions = ctx.sessions.filter(s => {
        const d = new Date(s.date);
        return d >= weekStart && d < weekEnd;
      });
      return weekSessions.length >= 3;
    },
  },
  {
    id: 'iron_streak',
    name: 'Iron Streak',
    description: 'Work out 7 consecutive days',
    icon: '🔥',
    category: 'consistency',
    evaluate: (ctx) => {
      if (ctx.sessions.length < 7) return false;
      const dates = [...new Set(ctx.sessions.map(s => s.date.slice(0, 10)))].sort();
      let streak = 1;
      for (let i = dates.length - 1; i > 0; i--) {
        const curr = new Date(dates[i]);
        const prev = new Date(dates[i - 1]);
        const diff = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
        if (diff === 1) {
          streak++;
          if (streak >= 7) return true;
        } else {
          streak = 1;
        }
      }
      return false;
    },
  },
  {
    id: 'month_warrior',
    name: 'Month Warrior',
    description: 'Complete 20+ workouts in a calendar month',
    icon: '⚔️',
    category: 'consistency',
    evaluate: (ctx) => {
      const month = ctx.currentSession.date.slice(0, 7);
      const count = ctx.sessions.filter(s => s.date.startsWith(month)).length;
      return count >= 20;
    },
  },
  {
    id: 'pr_crusher',
    name: 'PR Crusher',
    description: 'Hit a new personal record weight on any exercise',
    icon: '💪',
    category: 'weight_pr',
    evaluate: (ctx) => {
      for (const entry of ctx.currentSession.exercises) {
        const completed = entry.sets.filter(s => s.completed);
        const currentMax = Math.max(0, ...completed.map(s => s.weight ?? 0));
        if (currentMax <= 0) continue;

        const previous = ctx.sessions
          .filter(s => s.id !== ctx.currentSession.id)
          .flatMap(s => s.exercises.filter(e => e.exerciseId === entry.exerciseId))
          .flatMap(e => e.sets.filter(s => s.completed));
        const prevMax = Math.max(0, ...previous.map(s => s.weight ?? 0));

        if (currentMax > prevMax && previous.length > 0) {
          return { earned: true, details: `New weight PR!` };
        }
      }
      return false;
    },
  },
  {
    id: 'double_up',
    name: 'Double Up',
    description: 'Lift 2x your first recorded weight on any exercise',
    icon: '🚀',
    category: 'weight_pr',
    evaluate: (ctx) => {
      for (const entry of ctx.currentSession.exercises) {
        const completed = entry.sets.filter(s => s.completed);
        const currentMax = Math.max(0, ...completed.map(s => s.weight ?? 0));
        if (currentMax <= 0) continue;

        const allPrev = ctx.sessions
          .sort((a, b) => a.date.localeCompare(b.date))
          .flatMap(s => s.exercises.filter(e => e.exerciseId === entry.exerciseId))
          .flatMap(e => e.sets.filter(s => s.completed && (s.weight ?? 0) > 0));

        if (allPrev.length > 0) {
          const firstWeight = allPrev[0].weight ?? 0;
          if (firstWeight > 0 && currentMax >= firstWeight * 2) return true;
        }
      }
      return false;
    },
  },
  {
    id: 'century_club',
    name: 'Century Club',
    description: '100 reps of a single exercise in one session',
    icon: '💯',
    category: 'rep_pr',
    evaluate: (ctx) => {
      for (const entry of ctx.currentSession.exercises) {
        const totalReps = entry.sets.filter(s => s.completed).reduce((sum, s) => sum + s.reps, 0);
        if (totalReps >= 100) return true;
      }
      return false;
    },
  },
  {
    id: 'rep_machine',
    name: 'Rep Machine',
    description: 'Beat your previous best reps at the same weight',
    icon: '⚡',
    category: 'rep_pr',
    evaluate: (ctx) => {
      for (const entry of ctx.currentSession.exercises) {
        const completed = entry.sets.filter(s => s.completed);

        for (const set of completed) {
          const weight = set.weight ?? 0;
          const prevSets = ctx.sessions
            .filter(s => s.id !== ctx.currentSession.id)
            .flatMap(s => s.exercises.filter(e => e.exerciseId === entry.exerciseId))
            .flatMap(e => e.sets.filter(s => s.completed && (s.weight ?? 0) === weight));

          const prevMaxReps = Math.max(0, ...prevSets.map(s => s.reps));
          if (set.reps > prevMaxReps && prevSets.length > 0) return true;
        }
      }
      return false;
    },
  },
  {
    id: 'ton_club',
    name: 'Ton Club',
    description: '1,000+ kg total volume in a single session',
    icon: '🏆',
    category: 'volume_milestone',
    evaluate: (ctx) => {
      const volume = ctx.currentSession.exercises
        .flatMap(e => e.sets.filter(s => s.completed))
        .reduce((sum, s) => sum + s.reps * (s.weight ?? 0), 0);
      return volume >= 1000;
    },
  },
  {
    id: 'heavy_lifter',
    name: 'Heavy Lifter',
    description: '10,000+ kg cumulative volume across all sessions',
    icon: '🗿',
    category: 'volume_milestone',
    evaluate: (ctx) => {
      const total = ctx.sessions
        .flatMap(s => s.exercises)
        .flatMap(e => e.sets.filter(s => s.completed))
        .reduce((sum, s) => sum + s.reps * (s.weight ?? 0), 0);
      return total >= 10000;
    },
  },
  {
    id: 'renaissance_athlete',
    name: 'Renaissance Athlete',
    description: 'Log 20 distinct exercises',
    icon: '🎨',
    category: 'variety',
    evaluate: (ctx) => ctx.exercises.length >= 20,
  },
  {
    id: 'well_rounded',
    name: 'Well Rounded',
    description: 'Train 5+ different muscle groups',
    icon: '🎯',
    category: 'variety',
    evaluate: (ctx) => {
      const groups = new Set(ctx.exercises.filter(e => e.muscleGroup).map(e => e.muscleGroup));
      return groups.size >= 5;
    },
  },
];

export function evaluateAccolades(ctx: EvaluationContext): EarnedAccolade[] {
  const newAccolades: EarnedAccolade[] = [];

  for (const def of ACCOLADE_DEFINITIONS) {
    if (ctx.earnedAccolades.some(a => a.accoladeId === def.id)) continue;

    const result = def.evaluate(ctx);
    const earned = typeof result === 'boolean' ? result : result.earned;
    const details = typeof result === 'object' ? result.details : undefined;

    if (earned) {
      newAccolades.push({
        accoladeId: def.id,
        earnedAt: new Date().toISOString(),
        details,
      });
    }
  }

  return newAccolades;
}
