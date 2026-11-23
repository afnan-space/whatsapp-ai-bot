// ============================================================
// sheets.js - Google Sheets Webhook Sync
// ============================================================

export async function syncOrderToGoogleSheets(order) {
  const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log("ℹ️ Google Sheets Webhook URL not set. Skipping live sheet sync.");
    return false;
  }

  try {
    const itemsSummary = Array.isArray(order.items)
      ? order.items.map((i) => `${i.name || i.product} (${i.size || ""} ${i.color || ""}) x ${i.quantity || 1}`).join(", ")
      : String(order.items);

    const payload = {
      orderId: order.id,
      date: order.date,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      address: order.address,
      items: itemsSummary,
      totalAmount: order.totalAmount,
      paymentMethod: order.paymentMethod,
      status: order.status,
      notes: order.notes,
    };

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      console.log(`✅ Order #${order.id} synced to Google Sheets successfully!`);
      return true;
    } else {
      console.warn(`⚠️ Google Sheets sync response: ${res.status}`);
      return false;
    }
  } catch (err) {
    console.error("❌ Google Sheets sync error:", err.message);
    return false;
  }
}
