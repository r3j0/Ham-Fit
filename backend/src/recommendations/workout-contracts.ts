/** Existing BE API/storage shapes. No scoring or data-team implementation lives here. */
export const FITNESS_FACTORS = [
  'strength',
  'muscularEndurance',
  'cardiovascularEndurance',
  'flexibility',
  'agility',
  'power',
] as const;
export type FactorVector = Record<(typeof FITNESS_FACTORS)[number], number>;
export type RecommendationVideo = {
  videoId: string;
  title: string;
  originalUrl: string;
  ageGroup: string;
  equipment: string[];
  fitnessWeights: FactorVector;
  durationSeconds: number;
};
export type WorkoutLog = {
  videoId: string;
  date: string;
  completed: boolean;
  fitnessWeights?: FactorVector;
};
export type WeightAdjustment = Record<
  (typeof FITNESS_FACTORS)[number],
  { previous: number; delta: number; next: number }
>;
