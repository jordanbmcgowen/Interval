
export enum TimerStatus {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED'
}

export type ThemeName = 'zen' | 'ocean' | 'forest' | 'sunset';

export interface TimerSettings {
  intervalLength: number; // seconds
  totalDuration: number;  // minutes
  enableAICoach: boolean;
  enableVibration: boolean;
  theme: ThemeName;
}

export interface TimerState {
  currentIntervalTime: number;
  totalTimeRemaining: number;
  intervalsCompleted: number;
  status: TimerStatus;
}
