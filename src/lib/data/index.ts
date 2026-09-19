import { mockDataClient } from "./mockDataClient";
import { sheetsDataClient } from "./sheetsDataClient";
import { isSheetsConfigured } from "./sheetsClient";
import type { DataClient } from "./dataClient";

// Swap point: set VITE_SHEETS_API_URL (see .env.example) to switch from the
// localStorage mock to the real Google Sheets backend (apps-script/Code.gs)
// — nothing that calls `dataClient` needs to change either way.
export const dataClient: DataClient = isSheetsConfigured ? sheetsDataClient : mockDataClient;

export type { DataClient } from "./dataClient";
