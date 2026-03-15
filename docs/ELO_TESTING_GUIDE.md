# ELO Rating System - Testing & Workflow Guide

## Overview
The ELO rating system balances team ratings based on match outcomes and score differentials. Teams with lower ratings gain more points from wins and lose fewer points from losses, while higher-rated teams experience the opposite.

## System Specifications

### Rating Range
- **Minimum Rating**: 800
- **Maximum Rating**: 3000
- **Default Rating**: 1500 (middle of range at 1900 with adjustments)

### K-Factor
- **Base K-Factor**: 32 (standard for competitive games)
- Can be adjusted for different volatility levels

### Margin of Victory (MOV) Multiplier
The system adjusts rating changes based on goal differential:
- **1 goal**: 1.0x (base multiplier)
- **2 goals**: 1.5x
- **3+ goals**: 1.5 + 0.15 × (differential - 2), capped at 2.5x

### Upset Bonus
When an underdog wins, the multiplier increases based on the rating difference:
- Formula: 1 + (ratingDiff / 800)
- This makes major upsets very rewarding

## Complete Workflow

### Step 1: Create a Game Availability
1. Navigate to **Game Scheduler** screen
2. Click **"Create Availability"**
3. Set the following:
   - Game title (e.g., "Saturday Pickup Game")
   - Date and time
   - Game type (Home/Away)
4. The game is posted as available

### Step 2: Request a Game
1. Another team goes to **Find Games** screen
2. Set search radius and location
3. Click **"Search"** to find nearby games
4. Select a game and click **"View"**
5. Click **"Request Game"** (unless it's their own game - they'll see "Your Game")
6. A game request is sent to the home team's coordinator

### Step 3: Accept Game Request
1. Home team coordinator opens **Coordinator Dashboard**
2. Scroll to **"Game Requests"** section
3. Tap on a pending request to view details:
   - Requesting team name
   - Requester info
   - Game time and type
4. Click **"Approve"** to accept the request
5. The game is now linked with both teams:
   - `teamId`: Home team
   - `opponentTeamId`: Requesting (away) team
   - `homeTeamRating`: Current home team ELO
   - `awayTeamRating`: Current away team ELO

### Step 4: Play the Game
- Teams play the ice hockey game
- Coordinators track the final score

### Step 5: Enter Final Score
1. Coordinator opens **Coordinator Dashboard**
2. Click **"Game Results"** button (green)
3. Find the completed game in the list
4. Click **"Enter Score"**
5. Enter final scores for both teams:
   - Home team score
   - Away team score
6. Click **"Preview Rating"** to see expected changes:
   - Shows old rating → new rating
   - Displays rating change (+/-) for each team
   - Provides description (e.g., "Major upset victory!", "Expected win")
7. Click **"Submit Score"** to finalize

### Step 6: Rating Updates
- The system calculates new ratings using the ELO formula
- Both teams' `elo` fields are updated in Firestore
- The game document is marked as `completed: true`
- Historical data is preserved:
   - `homeTeamRating` / `awayTeamRating`: Ratings before the game
   - `homeNewRating` / `awayNewRating`: Ratings after the game
   - `homeRatingChange` / `awayRatingChange`: The delta

## Example Scenarios

### Scenario 1: Even Match
**Setup:**
- Team A (Home): 1500 ELO
- Team B (Away): 1500 ELO
- Final Score: 4-2 (Team A wins)

**Result:**
- Team A: +24 (1524)
- Team B: -24 (1476)

### Scenario 2: Underdog Victory (Close Game)
**Setup:**
- Team A (Home): 850 ELO (Learn to Play)
- Team B (Away): 1500 ELO (Development)
- Final Score: 3-2 (Team A wins)

**Result:**
- Team A: +58 (Major upset!)
- Team B: -58 (Unexpected loss)

### Scenario 3: Underdog Victory (Blowout)
**Setup:**
- Team A (Home): 850 ELO
- Team B (Away): 1500 ELO
- Final Score: 6-0 (Team A wins)

**Result:**
- Team A: +95 (Massive upset!)
- Team B: -95 (Devastating loss)

### Scenario 4: Favorite Wins Big
**Setup:**
- Team A (Home): 2400 ELO (Experienced)
- Team B (Away): 850 ELO (Learn to Play)
- Final Score: 8-1 (Team A wins)

**Result:**
- Team A: +12 (Expected win)
- Team B: -12 (Minimal loss despite score)

### Scenario 5: Favorite Loses
**Setup:**
- Team A (Home): 2400 ELO (Experienced)
- Team B (Away): 850 ELO (Learn to Play)
- Final Score: 2-3 (Team B wins)

**Result:**
- Team A: -68 (Major upset loss)
- Team B: +68 (Incredible win!)

### Scenario 6: Draw
**Setup:**
- Team A (Home): 1400 ELO (Development)
- Team B (Away): 1600 ELO
- Final Score: 2-2 (Draw)

**Result:**
- Team A: +3 (Slight gain as underdog)
- Team B: -3 (Slight loss as favorite)

## Testing Checklist

### Setup
- [ ] Create multiple teams with different skill levels:
  - Team 1: Learn to Play (800 ELO)
  - Team 2: Development (1400 ELO)
  - Team 3: Experienced (2400 ELO)

### Game Creation & Request
- [ ] Create game availability as Team 3
- [ ] Search and find the game as Team 1
- [ ] Request the game
- [ ] Verify "Your Game" appears for Team 3's coordinator

### Game Acceptance
- [ ] Team 3 coordinator views game requests
- [ ] Accept Team 1's request
- [ ] Verify game now shows both teams linked
- [ ] Verify `homeTeamRating` and `awayTeamRating` are set

### Score Entry
- [ ] Navigate to Game Results screen
- [ ] Find the accepted game
- [ ] Click "Enter Score"
- [ ] Enter scores (test various scenarios)
- [ ] Preview ratings and verify calculations
- [ ] Submit score

### Rating Verification
- [ ] Check both teams' updated ELO ratings
- [ ] Verify rating changes match preview
- [ ] Confirm game marked as completed
- [ ] Verify historical data preserved

### Edge Cases
- [ ] Test draw (tie game)
- [ ] Test 1-goal differential
- [ ] Test 5+ goal blowout
- [ ] Test maximum rating (3000) doesn't exceed
- [ ] Test minimum rating (800) doesn't go below
- [ ] Verify underdog gets bonus on win
- [ ] Verify favorite loses significant points on loss

## ELO Formula Reference

### Expected Score
```
E = 1 / (1 + 10^((OpponentRating - TeamRating) / 400))
```

### Rating Change
```
RatingChange = K × MOV × (ActualScore - ExpectedScore)
```

Where:
- **K** = 32 (K-factor)
- **MOV** = Margin of Victory multiplier
- **ActualScore** = 1 (win), 0.5 (draw), 0 (loss)
- **ExpectedScore** = calculated probability

### MOV Calculation
```
if goalDiff == 1: MOV = 1.0
if goalDiff == 2: MOV = 1.5
if goalDiff >= 3: MOV = 1.5 + 0.15 × (goalDiff - 2), max 2.5

if underdog wins:
  upsetFactor = 1 + (ratingDiff / 800)
  MOV = MOV × upsetFactor
```

## Benefits of This System

1. **Fair for All Levels**: Teams with lower ratings aren't punished as harshly for losses against stronger teams
2. **Rewards Upsets**: Underdog victories are highly rewarded
3. **Margin Matters**: Big wins/losses have appropriate impact
4. **Self-Balancing**: Ratings naturally converge to true skill level over time
5. **Transparent**: Users can preview rating changes before submitting scores

## Files Created/Modified

### New Files
- `src/utils/elo.ts` - ELO calculation utilities
- `app/(tabs)/GameResultsScreen.tsx` - Score entry and rating management UI

### Modified Files
- `app/(tabs)/CoordinatorDashboardScreen.tsx`:
  - Updated `handleApproveGameRequest` to link opponent teams
  - Added "Game Results" button
  - Stores initial ratings when game is accepted

## Future Enhancements

- Season-based rating resets
- Leaderboards by region or skill level
- Rating history graphs
- Automated game result notifications
- Dispute resolution system
- Performance statistics (goals/assists/etc.)
