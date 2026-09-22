import { eventBus } from "../events";
import { getCurrentUser } from "../auth/authStore";
import { notificationStore } from "./notificationStore";
import { dataClient } from "../data";

/** Subscriber #1 on the event bus: alerts whoever is on the Ops dashboard when a new request lands. */
export function registerOpsPopupSound(): void {
  eventBus.on("RequestSubmitted", async ({ request }) => {
    if (getCurrentUser()?.role !== "ops") return;
    const account = await dataClient.getAccount(request.accountId);
    const itemCount = request.lineItems.length;
    const totalQty = request.lineItems.reduce((sum, li) => sum + li.qty, 0);
    const who = request.requestedByName ? `${request.requestedByName} at ${account?.companyName ?? "a B2B account"}` : account?.companyName ?? "A B2B account";
    notificationStore.push({
      kind: "info",
      title: "New request",
      body: `${who} requested ${itemCount} item${itemCount === 1 ? "" : "s"} (${totalQty} units total).`,
    });
  });

  eventBus.on("ProductRequestSubmitted", async ({ request }) => {
    if (getCurrentUser()?.role !== "ops") return;
    const [account, inventory] = await Promise.all([dataClient.getAccount(request.accountId), dataClient.getInventory()]);
    const item = inventory.find((i) => i.skuId === request.skuId);
    notificationStore.push({
      kind: "warning",
      title: "Product requested",
      body: `${account?.companyName ?? "A B2B account"} wants ${request.qty} × ${item?.productName ?? request.skuId} — not enough in stock.`,
    });
  });
}
