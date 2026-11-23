// ============================================================
// orders.js - Order Management, Storage & Formatters
// ============================================================
import fs from "fs";

const ORDERS_FILE = "./orders_data.json";

function loadOrders() {
  try {
    if (fs.existsSync(ORDERS_FILE)) {
      return JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8"));
    }
  } catch (err) {
    console.error("Orders load error:", err.message);
  }
  return [];
}

const orders = loadOrders();

export function saveOrders() {
  try {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), "utf-8");
  } catch (err) {
    console.error("Orders save error:", err.message);
  }
}

export function createOrder({ customerPhone, customerName, address, items, totalAmount, paymentMethod, notes }) {
  const orderId = "ORD-" + Math.floor(1000 + Math.random() * 9000);
  const newOrder = {
    id: orderId,
    date: new Date().toLocaleString("en-BD", { timeZone: "Asia/Dhaka" }),
    customerPhone: customerPhone || "N/A",
    customerName: customerName || "সম্মানিত কাস্টমার",
    address: address || "N/A",
    items: items || [],
    totalAmount: totalAmount || 0,
    paymentMethod: paymentMethod || "Cash on Delivery",
    notes: notes || "",
    status: "Pending", // Pending, Confirmed, Cancelled, Delivered
  };

  orders.unshift(newOrder);
  saveOrders();
  return newOrder;
}

export function getOrderById(orderId) {
  return orders.find((o) => o.id === orderId);
}

export function updateOrderStatus(orderId, status) {
  const order = getOrderById(orderId);
  if (order) {
    order.status = status;
    saveOrders();
    return true;
  }
  return false;
}

export function getAllOrders() {
  return orders;
}

export function formatOrderCard(order) {
  const itemsText = Array.isArray(order.items)
    ? order.items.map((i) => `• ${i.name || i.product} (${i.size || ""} ${i.color || ""}) x ${i.quantity || 1} - ৳${i.price || ""}`).join("\n")
    : String(order.items);

  return (
    `🛒 *নতুন অর্ডার এসেছে! [#${order.id}]*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 *কাস্টমার:* ${order.customerName}\n` +
    `📞 *ফোন:* \`${order.customerPhone}\`\n` +
    `📍 *ঠিকানা:* ${order.address}\n\n` +
    `📦 *আইটেমসমূহ:*\n${itemsText}\n\n` +
    `💵 *মোট মূল্য:* ৳${order.totalAmount}\n` +
    `💳 *পেমেন্ট:* ${order.paymentMethod}\n` +
    `📌 *স্ট্যাটাস:* ${order.status === "Pending" ? "⏳ পেন্ডিং" : order.status === "Confirmed" ? "✅ কনফার্মড" : "❌ বাতিল"}\n` +
    `━━━━━━━━━━━━━━━━━━━━`
  );
}
