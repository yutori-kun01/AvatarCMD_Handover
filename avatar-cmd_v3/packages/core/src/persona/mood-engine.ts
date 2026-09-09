// ==============================================
// Mood Engine — Monster v4 Ported
// ==============================================
// Simulates avatar emotional state for natural content variance
// Formula: NewMood = (Baseline * (1 - Decay)) + (CurrentMood * Decay) + RandomVariation

export interface MoodState {
  score: number;           // 0.0 - 1.0
  lastUpdated: Date;
  creativityModifier: number;
  energyModifier: number;
  riskTolerance: number;
}

export interface MoodConfig {
  baseline: number;        // Default: 0.5
  volatility: number;      // 0.0 - 1.0, how much mood swings
  recoveryRate: number;    // How fast mood returns to baseline
}

const DEFAULT_CONFIG: MoodConfig = {
  baseline: 0.5,
  volatility: 0.3,
  recoveryRate: 0.1,
};

export class MoodEngine {
  private config: MoodConfig;

  constructor(config?: Partial<MoodConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Calculate the current mood based on time decay and random variation.
   */
  calculate(currentScore: number, lastUpdated: Date): MoodState {
    const minutesElapsed =
      (Date.now() - lastUpdated.getTime()) / (1000 * 60);

    // Exponential decay toward baseline
    const decay = Math.exp(
      (-this.config.recoveryRate * minutesElapsed) / 60
    );

    // Random variation scaled by volatility
    const randomVariation =
      (Math.random() - 0.5) * this.config.volatility * 0.2;

    // New mood calculation
    let newScore =
      this.config.baseline * (1 - decay) +
      currentScore * decay +
      randomVariation;

    // Clamp to [0, 1]
    newScore = Math.max(0, Math.min(1, newScore));

    return {
      score: newScore,
      lastUpdated: new Date(),
      creativityModifier: 0.8 + newScore * 0.4,  // 0.8 - 1.2
      energyModifier: 0.7 + newScore * 0.6,       // 0.7 - 1.3
      riskTolerance: 0.3 + newScore * 0.4,        // 0.3 - 0.7
    };
  }

  /**
   * Check if an intuition spark should be triggered.
   * Returns the spark type if triggered, null otherwise.
   */
  checkSpark(
    threshold: number = 0.01
  ): SparkResult | null {
    const roll = Math.random();
    if (roll >= threshold) return null;

    // Weighted selection of spark types
    const sparkRoll = Math.random();
    let sparkType: SparkType;

    if (sparkRoll < 0.3) sparkType = "sudden_insight";
    else if (sparkRoll < 0.55) sparkType = "creative_leap";
    else if (sparkRoll < 0.75) sparkType = "pattern_break";
    else if (sparkRoll < 0.9) sparkType = "emotional_surge";
    else sparkType = "risky_move";

    return {
      type: sparkType,
      directive: SPARK_DIRECTIVES[sparkType],
    };
  }
}

export type SparkType =
  | "sudden_insight"
  | "creative_leap"
  | "pattern_break"
  | "emotional_surge"
  | "risky_move";

export interface SparkResult {
  type: SparkType;
  directive: string;
}

const SPARK_DIRECTIVES: Record<SparkType, string> = {
  sudden_insight:
    "全く新しい視点からこのトピックを捉え直す。予想外の角度から洞察を提供する。",
  creative_leap:
    "メタファーや比喩を活用して、鮮やかな描写で読者の想像力を刺激する。",
  pattern_break:
    "通常とは異なる文体・構成を使う。リスト形式、対話形式、逆説など。",
  emotional_surge:
    "感情的なエネルギーを高め、読者の共感を強く引き出す表現を使う。",
  risky_move:
    "挑発的な問いかけや、議論を呼ぶ主張を含める。安全地帯を出る。",
};
