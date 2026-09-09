import { mockDataClient } from "./mockDataClient";
import type { DataClient } from "./dataClient";

// Swap point for later: when a real backend (Supabase, etc.) is wired up,
// import and export a client implementing the same DataClient interface
// here, gated by an env var — nothing that calls `dataClient` needs to change.
export const dataClient: DataClient = mockDataClient;

export type { DataClient, LineItemDecision } from "./dataClient";
