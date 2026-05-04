// Centralised difficulty tier config for the 5-tier system.
// Order matters — used by adaptive logic (low → high).
export const DIFFICULTY_TIERS = [
  { value: 'practice', label: 'Practice' },
  { value: 'basic', label: 'Basic' },
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
] as const;

export type DifficultyTier = typeof DIFFICULTY_TIERS[number]['value'];

export const NON_PRACTICE_TIERS: DifficultyTier[] = ['basic', 'easy', 'medium', 'hard'];

export const getDifficultyColor = (diff: string) => {
  switch (diff) {
    case 'practice': return 'bg-accent/20 text-accent-foreground';
    case 'basic':    return 'bg-primary/15 text-primary';
    case 'easy':     return 'bg-success/20 text-success';
    case 'medium':   return 'bg-warning/20 text-warning-foreground';
    case 'hard':     return 'bg-destructive/20 text-destructive';
    default:         return 'bg-muted text-muted-foreground';
  }
};

/** Map a 0–100 practice score to an entry difficulty using 5-tier bands. */
export const scoreToTier = (score: number): DifficultyTier => {
  if (score >= 100) return 'hard';      // 100%+
  if (score >= 80)  return 'medium';    // 80–100%
  if (score >= 50)  return 'easy';      // 50–80%
  if (score >= 20)  return 'basic';     // 20–50%
  return 'practice';                    // 0–20% — practice (kept here so adaptive can step up)
};
