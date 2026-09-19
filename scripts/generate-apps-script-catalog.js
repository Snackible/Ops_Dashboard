// Regenerates apps-script/Catalog.gs from src/data/catalog.json.
// Run with: node scripts/generate-apps-script-catalog.js
import { readFileSync, writeFileSync } from "node:fs";

const catalog = JSON.parse(readFileSync(new URL("../src/data/catalog.json", import.meta.url), "utf8"));

const body = catalog
  .map(
    (i) =>
      `  { skuId: ${JSON.stringify(i.skuId)}, category: ${JSON.stringify(i.category)}, productName: ${JSON.stringify(
        i.productName
      )}, grammageG: ${i.grammageG}, mrpInr: ${i.mrpInr}, shelfLifeDays: ${i.shelfLifeDays} }`
  )
  .join(",\n");

const out = `/**
 * Generated from src/data/catalog.json - re-run scripts/generate-apps-script-catalog.js
 * if the ratecard changes. Used by setupSheets() in Code.gs to seed the
 * Inventory tab; after that the sheet is the source of truth, not this file.
 */
const CATALOG = [
${body}
];
`;

writeFileSync(new URL("../apps-script/Catalog.gs", import.meta.url), out);
console.log(`wrote apps-script/Catalog.gs (${catalog.length} items)`);
