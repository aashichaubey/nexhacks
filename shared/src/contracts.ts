export type TranscriptPacket = {
  id: string;
  windowStart: string;
  windowEnd: string;
  transcript: string;
  sttConfidence: number;
  vadConfidence: number;
  source: string;
};

export type Signal = {
  id: string;
  signalType: string;
  entity: string;
  polarity: "supports_outcome" | "weakens_outcome" | "neutral";
  confidence: number;
  timeHorizon: "immediate" | "short" | "mid" | "long";
  explanation?: string;
  ts: string;
};

export type MarketCandidate = {
  id: string;
  title: string;
  url: string;
  probability: number;
  volumeUsd: number;
  liquidityUsd: number;
  timeRemainingMinutes: number;
  matchedSignals: string[];
  ts: string;
};

export type Envelope<T> = {
  type: "transcript_packet" | "signal" | "market" | "control";
  payload: T;
  ts: string;
};

export type UserProfile = {
  favoriteTeams: string[];
  favoriteLeagues: string[];
  marketTypes: string[];
  alertIntensity: "low" | "medium" | "high";
};
