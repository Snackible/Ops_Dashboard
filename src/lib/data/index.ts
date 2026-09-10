import { mockDataClient } from "./mockDataClient";
import { supabaseDataClient } from "./supabaseDataClient";
import { isSupabaseConfigured } from "./supabaseClient";
import type { DataClient } from "./dataClient";

// Swap point: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see
// .env.example) to switch from the localStorage mock to the real Supabase
// backend — nothing that calls `dataClient` needs to change either way.
export const dataClient: DataClient = isSupabaseConfigured ? supabaseDataClient : mockDataClient;

export type { DataClient } from "./dataClient";
