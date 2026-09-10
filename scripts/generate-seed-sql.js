// Regenerates supabase/seed.sql from src/data/catalog.json.
// Run with: node scripts/generate-seed-sql.js
import { readFileSync, writeFileSync } from "node:fs";

const catalog = JSON.parse(readFileSync(new URL("../src/data/catalog.json", import.meta.url), "utf8"));
const esc = (s) => s.replace(/'/g, "''");

let sql = "-- Generated from src/data/catalog.json — re-run scripts/generate-seed-sql.js if the ratecard changes.\n\n";
sql += "insert into inventory_items (sku_id, category, product_name, grammage_g, mrp_inr, shelf_life_days, current_stock, active, tier) values\n";
sql += catalog
  .map(
    (i) =>
      `  ('${i.skuId}', '${esc(i.category)}', '${esc(i.productName)}', ${i.grammageG}, ${i.mrpInr}, ${i.shelfLifeDays}, 0, true, 'yellow')`
  )
  .join(",\n");
sql += "\non conflict (sku_id) do nothing;\n\n";
sql += `insert into b2b_accounts (account_id, company_name, contact_name, contact_email, contact_phone, pricing_tier_id) values
  ('acct-blue-orchard', 'Blue Orchard Mart', 'Rahul Mehta', 'rahul@blueorchardmart.example', '+91 98200 11223', null),
  ('acct-corner-cafe', 'Corner Cafe Collective', 'Ayesha Khan', 'ayesha@cornercafe.example', '+91 98100 44556', null)
on conflict (account_id) do nothing;
`;

writeFileSync(new URL("../supabase/seed.sql", import.meta.url), sql);
console.log(`wrote supabase/seed.sql (${catalog.length} items)`);
