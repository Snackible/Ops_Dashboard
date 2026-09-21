import { mockDataClient } from "./mockDataClient";
import { sheetsDataClient } from "./sheetsDataClient";
import { isSheetsConfigured } from "./sheetsClient";
import type { DataClient } from "./dataClient";

// Swap point: production builds (and `vercel dev` with VITE_USE_SHEETS_API=true,
// see .env.example) use the real backend (/api/sheets); plain `npm run dev`
// stays on the localStorage mock — nothing that calls `dataClient` needs to
// change either way.
export const dataClient: DataClient = isSheetsConfigured ? sheetsDataClient : mockDataClient;

export type { DataClient } from "./dataClient";
