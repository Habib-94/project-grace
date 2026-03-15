// ELO Rating System for Ice Hockey Games
// Based on standard ELO calculations with margin of victory multiplier

/**
 * Calculate expected score for a team
 * @param teamRating - The team's current ELO rating
 * @param opponentRating - The opponent's current ELO rating
 * @returns Expected score (probability of winning, 0-1)
 */
export function calculateExpectedScore(teamRating: number, opponentRating: number): number {
  return 1 / (1 + Math.pow(10, (opponentRating - teamRating) / 400));
}

/**
 * Calculate margin of victory multiplier
 * Higher goal differentials result in larger rating changes
 * @param goalDifferential - Absolute difference in goals
 * @param winnerRating - Rating of the winning team
 * @param loserRating - Rating of the losing team
 * @returns Multiplier for the K-factor
 */
function calculateMOVMultiplier(
  goalDifferential: number,
  winnerRating: number,
  loserRating: number
): number {
  // Base multiplier on goal differential
  let multiplier = 1;
  
  if (goalDifferential === 1) {
    multiplier = 1;
  } else if (goalDifferential === 2) {
    multiplier = 1.5;
  } else {
    // For 3+ goal differential: 1.5 + 0.15 * (differential - 2)
    multiplier = 1.5 + 0.15 * (goalDifferential - 2);
  }
  
  // Cap the maximum multiplier at 2.5
  multiplier = Math.min(multiplier, 2.5);
  
  // Adjust if underdog wins (bigger upset = bigger change)
  if (loserRating > winnerRating) {
    const ratingDiff = loserRating - winnerRating;
    const upsetFactor = 1 + (ratingDiff / 800); // Scale based on rating difference
    multiplier *= upsetFactor;
  }
  
  return multiplier;
}

/**
 * Calculate new ELO ratings after a game
 * @param team1Rating - Current rating of team 1
 * @param team2Rating - Current rating of team 2
 * @param team1Score - Goals scored by team 1
 * @param team2Score - Goals scored by team 2
 * @param kFactor - K-factor (default 32, higher = more volatile)
 * @returns Object with new ratings for both teams
 */
export function calculateNewRatings(
  team1Rating: number,
  team2Rating: number,
  team1Score: number,
  team2Score: number,
  kFactor: number = 32
): {
  team1NewRating: number;
  team2NewRating: number;
  team1Change: number;
  team2Change: number;
} {
  // Ensure ratings are within valid range
  team1Rating = Math.max(800, Math.min(3000, team1Rating));
  team2Rating = Math.max(800, Math.min(3000, team2Rating));
  
  // Calculate expected scores
  const team1Expected = calculateExpectedScore(team1Rating, team2Rating);
  const team2Expected = calculateExpectedScore(team2Rating, team1Rating);
  
  // Determine actual scores (1 for win, 0.5 for draw, 0 for loss)
  let team1Actual: number;
  let team2Actual: number;
  
  if (team1Score > team2Score) {
    team1Actual = 1;
    team2Actual = 0;
  } else if (team2Score > team1Score) {
    team1Actual = 0;
    team2Actual = 1;
  } else {
    // Draw
    team1Actual = 0.5;
    team2Actual = 0.5;
  }
  
  // Calculate margin of victory multiplier
  const goalDifferential = Math.abs(team1Score - team2Score);
  let movMultiplier = 1;
  
  if (goalDifferential > 0) {
    const winnerRating = team1Score > team2Score ? team1Rating : team2Rating;
    const loserRating = team1Score > team2Score ? team2Rating : team1Rating;
    movMultiplier = calculateMOVMultiplier(goalDifferential, winnerRating, loserRating);
  }
  
  // Calculate rating changes
  const team1Change = Math.round(kFactor * movMultiplier * (team1Actual - team1Expected));
  const team2Change = Math.round(kFactor * movMultiplier * (team2Actual - team2Expected));
  
  // Calculate new ratings
  let team1NewRating = team1Rating + team1Change;
  let team2NewRating = team2Rating + team2Change;
  
  // Ensure ratings stay within bounds (800-3000)
  team1NewRating = Math.max(800, Math.min(3000, team1NewRating));
  team2NewRating = Math.max(800, Math.min(3000, team2NewRating));
  
  return {
    team1NewRating,
    team2NewRating,
    team1Change,
    team2Change,
  };
}

/**
 * Format rating change for display
 * @param change - The rating change value
 * @returns Formatted string with + or - prefix
 */
export function formatRatingChange(change: number): string {
  if (change > 0) return `+${change}`;
  return `${change}`;
}

/**
 * Get descriptive text for rating change
 * @param change - The rating change value
 * @param wasUnderdog - Whether this team was the underdog
 * @returns Descriptive message
 */
export function getRatingChangeDescription(change: number, wasUnderdog: boolean): string {
  const absChange = Math.abs(change);
  
  if (change > 0) {
    if (wasUnderdog && absChange > 40) {
      return 'Major upset victory!';
    } else if (absChange > 30) {
      return 'Dominant win!';
    } else if (absChange > 15) {
      return 'Solid victory';
    } else {
      return 'Expected win';
    }
  } else {
    if (wasUnderdog && absChange < 10) {
      return 'Minimal rating loss';
    } else if (absChange > 30) {
      return 'Tough loss';
    } else {
      return 'Expected loss';
    }
  }
}
