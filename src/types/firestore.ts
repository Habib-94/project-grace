// src/types/firestore.ts

export interface Team {
  id: string;
  teamName: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  homeColor?: string;
  awayColor?: string;
  createdBy?: string;
  createdAt?: string;
}

export interface User {
  uid: string;
  name?: string;
  email: string;
  role?: string;
  teamId?: string | null;
  isCoordinator?: boolean;
  /** When true, the coordinator's email is shown to prospective players viewing the team */
  shareEmail?: boolean;
  pendingTeamRequest?: string | null;
}

// ─── Tournament Types ──────────────────────────────────────────────────────────

export type TournamentFormat = 'knockout' | 'group_playoff';
export type TournamentVenueType = 'single' | 'multi';
export type TournamentStatus = 'open' | 'in_progress' | 'completed' | 'cancelled';
export type MatchStatus = 'pending' | 'scheduled' | 'completed' | 'void';

export interface TournamentTeamEntry {
  teamId: string;
  teamName: string;
  elo: number;
  signedUpAt: string; // ISO string
  latitude?: number;
  longitude?: number;
  /** Preferred day of week for home games in multi-venue tournaments (0=Sun, 1=Mon, ..., 6=Sat) */
  preferredDay?: number;
  /** Preferred kick-off time for home games, e.g. "19:00" */
  preferredTime?: string;
}

export interface Tournament {
  id: string;
  name: string;
  description?: string;
  hostTeamId: string;
  hostTeamName: string;
  hostUserId: string;
  format: TournamentFormat;
  venueType: TournamentVenueType;
  /** Only set when venueType === 'single' */
  venueName?: string;
  venueLatitude?: number;
  venueLongitude?: number;
  startDate: string; // ISO string
  endDate: string;   // ISO string
  maxTeams: number;
  teams: TournamentTeamEntry[];
  status: TournamentStatus;
  /** Optional ELO gate */
  eloMin?: number | null;
  eloMax?: number | null;
  /** Optional location gate — radius in miles from a lat/lng */
  locationRadiusMiles?: number | null;
  locationGateLat?: number | null;
  locationGateLng?: number | null;
  locationGateLabel?: string | null;
  /** Best-of series length for knockout rounds (1, 3 or 5). Default 1. */
  knockoutLegs?: 1 | 3 | 5;
  /** How many times each pairing plays in the group stage (1, 2 or 3). Default 1. */
  groupLegsPerPairing?: 1 | 2 | 3;
  createdAt: string; // ISO string
}

export interface TournamentMatch {
  id: string;
  tournamentId: string;
  round: number;          // 1-based
  matchNumber: number;    // within the round
  group?: string;         // e.g. 'A', 'B' for group stage
  /** 1-based leg number within a series. Omitted for single-leg matches. */
  legNumber?: number;
  /** Total legs in the series (1, 3 or 5). Omitted for single-leg matches. */
  totalLegs?: number;
  homeTeamId: string | null;
  homeTeamName: string | null;
  awayTeamId: string | null;
  awayTeamName: string | null;
  /** Linked game document id — set once a game slot is reserved */
  gameId?: string | null;
  homeScore?: number | null;
  awayScore?: number | null;
  winnerId?: string | null;
  status: MatchStatus;
  startISO?: string | null;
  venueName?: string | null;
}
