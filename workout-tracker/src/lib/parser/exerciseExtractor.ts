import type { ParsedExercise, ParseResult } from '../../types/parser';

const BODYWEIGHT_EXERCISES = new Set([
  'push-up', 'push-ups', 'pushup', 'pushups', 'push up', 'push ups',
  'pull-up', 'pull-ups', 'pullup', 'pullups', 'pull up', 'pull ups',
  'chin-up', 'chin-ups', 'chinup', 'chinups', 'chin up', 'chin ups',
  'dip', 'dips', 'tricep dip', 'tricep dips',
  'burpee', 'burpees',
  'plank', 'planks', 'side plank',
  'sit-up', 'sit-ups', 'situp', 'situps', 'sit up', 'sit ups',
  'crunch', 'crunches',
  'lunge', 'lunges', 'bodyweight lunge', 'bodyweight lunges',
  'squat', 'squats', 'bodyweight squat', 'bodyweight squats', 'air squat', 'air squats',
  'mountain climber', 'mountain climbers',
  'jumping jack', 'jumping jacks',
  'leg raise', 'leg raises', 'hanging leg raise', 'hanging leg raises',
  'flutter kick', 'flutter kicks',
  'bicycle crunch', 'bicycle crunches',
  'russian twist', 'russian twists',
  'superman', 'supermans',
  'glute bridge', 'glute bridges',
  'wall sit', 'wall sits',
  'box jump', 'box jumps',
  'muscle-up', 'muscle-ups', 'muscle up', 'muscle ups',
  'pistol squat', 'pistol squats',
  'handstand push-up', 'handstand push-ups',
  'inverted row', 'inverted rows',
  'dead hang',
]);

const KNOWN_EXERCISES: Record<string, string> = {
  'bench press': 'Chest', 'flat bench': 'Chest', 'incline bench': 'Chest', 'decline bench': 'Chest',
  'dumbbell press': 'Chest', 'db press': 'Chest', 'chest press': 'Chest', 'floor press': 'Chest',
  'chest fly': 'Chest', 'dumbbell fly': 'Chest', 'cable fly': 'Chest', 'pec deck': 'Chest',
  'squat': 'Legs', 'back squat': 'Legs', 'front squat': 'Legs', 'goblet squat': 'Legs',
  'leg press': 'Legs', 'hack squat': 'Legs', 'bulgarian split squat': 'Legs',
  'lunge': 'Legs', 'walking lunge': 'Legs', 'reverse lunge': 'Legs',
  'leg extension': 'Legs', 'leg curl': 'Legs', 'hamstring curl': 'Legs',
  'calf raise': 'Legs', 'standing calf raise': 'Legs', 'seated calf raise': 'Legs',
  'romanian deadlift': 'Legs', 'rdl': 'Legs', 'stiff leg deadlift': 'Legs',
  'hip thrust': 'Legs', 'glute bridge': 'Glutes',
  'deadlift': 'Back', 'sumo deadlift': 'Back', 'trap bar deadlift': 'Back',
  'barbell row': 'Back', 'bent over row': 'Back', 'pendlay row': 'Back',
  'dumbbell row': 'Back', 'db row': 'Back', 'one arm row': 'Back',
  'cable row': 'Back', 'seated row': 'Back', 'seated cable row': 'Back',
  'lat pulldown': 'Back', 'lat pull down': 'Back', 'pull down': 'Back',
  't-bar row': 'Back', 'face pull': 'Back',
  'overhead press': 'Shoulders', 'ohp': 'Shoulders', 'military press': 'Shoulders',
  'shoulder press': 'Shoulders', 'db shoulder press': 'Shoulders',
  'lateral raise': 'Shoulders', 'side raise': 'Shoulders', 'side lateral raise': 'Shoulders',
  'front raise': 'Shoulders', 'rear delt fly': 'Shoulders', 'reverse fly': 'Shoulders',
  'arnold press': 'Shoulders', 'upright row': 'Shoulders',
  'bicep curl': 'Arms', 'barbell curl': 'Arms', 'dumbbell curl': 'Arms', 'db curl': 'Arms',
  'hammer curl': 'Arms', 'preacher curl': 'Arms', 'concentration curl': 'Arms',
  'ez bar curl': 'Arms', 'cable curl': 'Arms', 'incline curl': 'Arms',
  'tricep extension': 'Arms', 'skull crusher': 'Arms', 'skullcrusher': 'Arms',
  'tricep pushdown': 'Arms', 'tricep push down': 'Arms', 'cable pushdown': 'Arms',
  'overhead tricep extension': 'Arms', 'close grip bench': 'Arms',
  'kickback': 'Arms', 'tricep kickback': 'Arms',
  'shrug': 'Back', 'barbell shrug': 'Back', 'dumbbell shrug': 'Back',
  'ab wheel': 'Core', 'ab rollout': 'Core', 'cable crunch': 'Core',
  'hanging leg raise': 'Core', 'plank': 'Core', 'russian twist': 'Core',
  'woodchop': 'Core', 'pallof press': 'Core',
};

// Pattern: 3x10, 3 x 12, 4 x 8-12, 3 sets of 10, 3 sets x 10
const SET_REP_PATTERN = /(\d+)\s*(?:x|×|sets?\s*(?:of|x)?)\s*(\d+(?:\s*[-–]\s*\d+)?)/i;
// Pattern: 225 lbs, 100kg, 135 lb, 60 kg, @225
const WEIGHT_PATTERN = /(?:@\s*)?(\d+(?:\.\d+)?)\s*(lbs?|kg|pounds?|kilograms?)/i;
// BW / bodyweight markers
const BW_PATTERN = /\b(?:bw|body\s*weight|bodyweight)\b/i;

export function extractExercises(rawText: string): ParseResult {
  const lines = rawText.split(/\n|\r\n?/).map(l => l.trim()).filter(Boolean);
  const exercises: ParsedExercise[] = [];
  const warnings: string[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase();

    // Skip headers, dates, notes-like lines
    if (/^(day|week|date|note|rest|warm[- ]?up|cool[- ]?down|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(lower)) {
      continue;
    }

    // Try to find a set x rep pattern
    const setRepMatch = line.match(SET_REP_PATTERN);
    const weightMatch = line.match(WEIGHT_PATTERN);
    const isBWMarker = BW_PATTERN.test(line);

    // Try to identify the exercise name
    let exerciseName = '';
    let confidence = 0;

    // Check against known exercises
    for (const [key] of Object.entries(KNOWN_EXERCISES)) {
      if (lower.includes(key)) {
        exerciseName = key.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
        confidence = 0.7;
        break;
      }
    }

    // If no known exercise found, try to extract name before set/rep pattern
    if (!exerciseName && setRepMatch) {
      const beforePattern = line.substring(0, line.indexOf(setRepMatch[0])).trim();
      if (beforePattern.length > 1 && beforePattern.length < 60) {
        // Clean up: remove leading numbers, bullets, dashes
        exerciseName = beforePattern.replace(/^[\d.\-–•*)\]]+\s*/, '').trim();
        confidence = 0.4;
      }
    }

    if (!exerciseName) continue;

    // Check if bodyweight
    const isBodyweight = isBWMarker ||
      BODYWEIGHT_EXERCISES.has(lower.replace(/^[\d.\-–•*)\]]+\s*/, '').split(/\s+\d/)[0].trim().toLowerCase()) ||
      BODYWEIGHT_EXERCISES.has(exerciseName.toLowerCase());

    // Boost confidence for set/rep patterns
    if (setRepMatch) confidence += 0.3;

    const parsed: ParsedExercise = {
      name: exerciseName,
      suggestedSets: setRepMatch ? parseInt(setRepMatch[1]) : undefined,
      suggestedReps: setRepMatch ? setRepMatch[2].trim() : undefined,
      suggestedWeight: weightMatch ? parseFloat(weightMatch[1]) : undefined,
      isBodyweight: isBodyweight || (!weightMatch && !isBWMarker && BODYWEIGHT_EXERCISES.has(exerciseName.toLowerCase())),
      confidence: Math.min(confidence, 1),
      rawText: line,
    };

    // Avoid duplicates
    if (!exercises.some(e => e.name.toLowerCase() === parsed.name.toLowerCase())) {
      exercises.push(parsed);
    }
  }

  if (exercises.length === 0) {
    warnings.push('No exercises could be automatically detected. You can add them manually.');
  }

  return { exercises, rawText, warnings };
}
