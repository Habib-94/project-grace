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
  pendingTeamRequest?: string | null;
}
