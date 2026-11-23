// ============================================================
// index.js - Main Entry Point (Baileys + Gemini + Telegram + Orders)
// ============================================================
import "dotenv/config";
import { makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import express from "express";
import cron from "node-cron";
import { state, addLog, getFullSystemPrompt, canReplyToContact } from "./state.js";
import { getGeminiReply, getGeminiImageReply } from "./gemini.js";
import { startTelegramBot, notifyAdmin, sendPhotoToAdmin, sendOrderAlert } from "./telegram.js";
import { createOrder } from "./orders.js";
import { syncOrderToGoogleSheets } from "./sheets.js";

// ============================================================
// 🌐 Express Keep-alive Server
// ============================================================
const app = express();
const PORT = process.env.PORT || 8000;

app.get("/", (req, res) => res.send("🤖 WhatsApp AI Business Agent is running!"));
app.get("/health", (req, res) =>
  res.json({
    status: "ok",
    shop: state.shopName,
    mode: state.mode,
    botOn: state.isOn,
    isWhatsAppConnected: state.isWhatsAppConnected,
    usedMessages: state.subscription.usedMessages,
    uptime: Math.floor(process.uptime()) + "s",
    timestamp: new Date().toISOString(),
  })
);

// Mobile WebApp Sheet / Dashboard Endpoint
app.get("/webapp", (req, res) => {
  const allOrders = getAllOrders();
  const prods = catalog.products || [];
  const sub = state.subscription;
  const remaining = Math.max(0, sub.totalMessages - sub.usedMessages);

  const html = `
<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${state.shopName} — Control Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen p-4 font-sans">
  <div class="max-w-md mx-auto space-y-4">
    <!-- Header -->
    <div class="bg-slate-800 border border-slate-700 rounded-2xl p-4 shadow-lg">
      <div class="flex justify-between items-center">
        <div>
          <h1 class="text-xl font-bold text-white">${state.shopName}</h1>
          <p class="text-xs text-slate-400">মালিক: ${state.ownerName}</p>
        </div>
        <span class="px-2.5 py-1 text-xs font-semibold rounded-full ${state.isWhatsAppConnected ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'}">
          ${state.isWhatsAppConnected ? '🟢 Connected' : '🔴 Disconnected'}
        </span>
      </div>
    </div>

    <!-- Quota Card -->
    <div class="bg-gradient-to-br from-indigo-900/60 to-purple-900/60 border border-indigo-700/40 rounded-2xl p-4">
      <div class="flex justify-between items-center mb-2">
        <span class="text-xs font-medium text-indigo-300">সাবস্ক্রিপশন: ${sub.plan}</span>
        <span class="text-xs font-bold text-white">${sub.usedMessages} / ${sub.totalMessages}</span>
      </div>
      <div class="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
        <div class="bg-indigo-400 h-2.5 rounded-full" style="width: ${Math.min(100, Math.round((sub.usedMessages / sub.totalMessages) * 100))}%"></div>
      </div>
      <p class="text-[11px] text-slate-300 mt-2">বাকি আছে: ${remaining} টি AI রিপ্লাই</p>
    </div>

    <!-- Orders Section -->
    <div class="bg-slate-800 border border-slate-700 rounded-2xl p-4">
      <h2 class="text-sm font-bold text-slate-200 mb-3 flex items-center justify-between">
        <span>🛒 সাম্প্রতিক অর্ডারসমূহ</span>
        <span class="text-xs font-normal text-indigo-400">${allOrders.length} টি</span>
      </h2>
      <div class="space-y-2.5 max-h-60 overflow-y-auto pr-1">
        ${allOrders.length === 0 ? '<p class="text-xs text-slate-400 text-center py-4">এখনো কোনো অর্ডার আসেনি।</p>' : ''}
        ${allOrders.slice(0, 5).map(o => `
          <div class="bg-slate-900/80 border border-slate-700/60 p-2.5 rounded-xl text-xs space-y-1">
            <div class="flex justify-between font-semibold">
              <span class="text-indigo-300">#${o.id} - ${o.customerName}</span>
              <span class="${o.status === 'Confirmed' ? 'text-emerald-400' : o.status === 'Pending' ? 'text-amber-400' : 'text-rose-400'}">${o.status}</span>
            </div>
            <p class="text-slate-400">📞 ${o.customerPhone} | ৳${o.totalAmount}</p>
            <p class="text-slate-500 text-[11px]">📍 ${o.address}</p>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Products Catalog Section -->
    <div class="bg-slate-800 border border-slate-700 rounded-2xl p-4">
      <h2 class="text-sm font-bold text-slate-200 mb-3 flex items-center justify-between">
        <span>📦 প্রোডাক্ট ক্যাটালগ</span>
        <span class="text-xs font-normal text-indigo-400">${prods.length} টি</span>
      </h2>
      <div class="space-y-2 max-h-48 overflow-y-auto pr-1">
        ${prods.map(p => `
          <div class="flex justify-between items-center bg-slate-900/60 border border-slate-700/50 p-2 rounded-xl text-xs">
            <div>
              <p class="font-medium text-white">${p.name}</p>
              <p class="text-[11px] text-slate-400">সাইজ: ${(p.sizes || []).join(', ')}</p>
            </div>
            <span class="font-bold text-emerald-400">৳${p.price}</span>
          </div>
        `).join('')}
      </div>
    </div>
  </div>
</body>
</html>
  `;
  res.send(html);
});

app.listen(PORT, () => console.log(`✅ Keep-alive server on port ${PORT}`));

// ============================================================
// 🕐 Cron Jobs — Server Keepalive & Daily Heartbeat
// ============================================================
cron.schedule("*/4 * * * *", async () => {
  try {
    const url = process.env.APP_URL || `http://127.0.0.1:${PORT}`;
    const res = await fetch(`${url}/health`);
    if (res.ok) {
      const data = await res.json();
      console.log(`🏓 Ping OK [${new Date().toLocaleTimeString("en-BD", { timeZone: "Asia/Dhaka" })}] uptime: ${data.uptime}`);
    }
  } catch (err) {
    console.warn("⚠️ Self-ping failed:", err.message);
  }
});

cron.schedule(
  "0 8 * * *",
  async () => {
    const hours = (process.uptime() / 3600).toFixed(1);
    await notifyAdmin(
      `🌅 *Daily Business Report*\n\n` +
      `🏢 দোকান: *${state.shopName}*\n` +
      `🤖 AI স্ট্যাটাস: ${state.isOn ? "✅ চালু" : "🔴 বন্ধ"}\n` +
      `⏱️ আপটাইম: ${hours} ঘণ্টা\n` +
      `📨 হ্যান্ডেলড মেসেজ: ${state.logs.length} টি`
    );
  },
  { timezone: "Asia/Dhaka" }
);

// ============================================================
// 📱 WhatsApp Connection (Baileys)
// ============================================================
const processedMessages = new Set();

function extractOrderJSON(replyText) {
  const match = replyText.match(/<<<ORDER_CONFIRMED>>>([\s\S]*?)<<<END_ORDER>>>/);
  if (!match) return { cleanReply: replyText, orderData: null };

  const cleanReply = replyText.replace(/<<<ORDER_CONFIRMED>>>[\s\S]*?<<<END_ORDER>>>/, "").trim();
  try {
    const orderData = JSON.parse(match[1].trim());
    return { cleanReply, orderData };
  } catch (e) {
    console.error("Order JSON parse error:", e.message);
    return { cleanReply, orderData: null };
  }
}

async function connectWhatsApp() {
  const { state: authState, saveCreds } = await useMultiFileAuthState("./auth_info");

  const sock = makeWASocket({
    auth: authState,
    logger: pino({ level: "silent" }),
    browser: ["WhatsApp AI Business Bot", "Chrome", "1.0"],
  });

  state.sock = sock;

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("📱 New WhatsApp QR Code generated in memory.");
      state.latestQR = qr;
      state.isWhatsAppConnected = false;
    }

    if (connection === "close") {
      state.isWhatsAppConnected = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log(`🔴 WhatsApp Connection closed. Code: ${code}. Reconnect: ${shouldReconnect}`);

      if (shouldReconnect) {
        setTimeout(connectWhatsApp, 5000);
      } else {
        await notifyAdmin("🔴 *WhatsApp Logout হয়ে গেছে!* পুনরায় লগইন করতে Telegram-এ `/login` লিখুন বা Login বাটনে চাপুন।");
      }
    }

    if (connection === "open") {
      state.isWhatsAppConnected = true;
      state.latestQR = null;
      console.log("✅ WhatsApp business connected!");
      await notifyAdmin("✅ *WhatsApp সফলভাবে কানেক্ট হয়েছে!*\nদোকানের AI সেলস অ্যাসিস্ট্যান্ট এখন সম্পূর্ণ প্রস্তুত।");
    }
  });

  sock.ev.on("creds.update", saveCreds);

  // ============================================================
  // 📨 Message Handler
  // ============================================================
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      try {
        if (msg.key.fromMe) continue;
        if (msg.key.remoteJid === "status@broadcast") continue;

        const msgId = msg.key.id;
        if (!msgId || processedMessages.has(msgId)) continue;
        processedMessages.add(msgId);
        if (processedMessages.size > 1000) {
          const first = processedMessages.values().next().value;
          processedMessages.delete(first);
        }

        const isGroup = msg.key.remoteJid.endsWith("@g.us");
        const jid = msg.key.remoteJid;
        const pushName = msg.pushName || "সম্মানিত কাস্টমার";
        const msgContent = msg.message;
        if (!msgContent) continue;

        const textMsg =
          msgContent.conversation ||
          msgContent.extendedTextMessage?.text ||
          msgContent.imageMessage?.caption ||
          "";
        const isImage = !!msgContent.imageMessage;

        // Skip groups if not explicitly allowed
        if (isGroup && !state.replyInGroups) continue;
        if (!state.isOn) continue;

        const senderNumber = jid.replace("@s.whatsapp.net", "").replace("@g.us", "");

        // Check if contact is allowed (rate limit & human takeover check)
        const check = canReplyToContact(senderNumber);
        if (!check.allowed) {
          if (check.reason === "muted_by_admin") {
            console.log(`⏸️ ${senderNumber} is in human takeover mode. AI skipped.`);
          } else if (check.reason === "limit_reached") {
            console.log(`🛑 Daily reply limit reached for ${senderNumber}`);
          }
          continue;
        }

        // Show typing indicator
        await sock.presenceSubscribe(jid);
        await sock.sendPresenceUpdate("composing", jid);

        const systemPrompt = getFullSystemPrompt();
        let rawReply = "";

        if (isImage) {
          await notifyAdmin(`📸 *নতুন ছবি পাঠিয়েছেন কাস্টমার*\n👤 ${pushName} (\`${senderNumber}\`)\n💬 ক্যাপশন: ${textMsg || "(নেই)"}`);
          const buffer = await downloadMediaMessage(msg, "buffer", {});
          rawReply = await getGeminiImageReply(jid, buffer, "image/jpeg", textMsg, systemPrompt);
        } else if (textMsg) {
          await notifyAdmin(`💬 *মেসেজ:* ${textMsg}\n👤 *কাস্টমার:* ${pushName} (\`${senderNumber}\`)`);
          rawReply = await getGeminiReply(jid, textMsg, systemPrompt);
        } else {
          await sock.sendPresenceUpdate("paused", jid);
          continue;
        }

        // Stop typing indicator
        await sock.sendPresenceUpdate("paused", jid);

        // Check if reply contains confirmed order
        const { cleanReply, orderData } = extractOrderJSON(rawReply);

        // Send reply to customer
        await sock.sendMessage(jid, { text: cleanReply });

        // If an order is captured, process it immediately
        if (orderData) {
          orderData.customerPhone = orderData.customerPhone || senderNumber;
          orderData.customerName = orderData.customerName || pushName;
          const savedOrder = createOrder(orderData);

          // Alert Admin on Telegram with Action Buttons
          await sendOrderAlert(savedOrder);

          // Live sync to Google Sheets
          syncOrderToGoogleSheets(savedOrder);
        }

        addLog({
          type: isGroup ? "group" : "personal",
          from: `${pushName} (${senderNumber})`,
          message: textMsg || "[image]",
          reply: cleanReply,
          orderCaptured: !!orderData,
        });
      } catch (err) {
        console.error("❌ Message handler error:", err.message);
        try {
          await sock.sendPresenceUpdate("paused", msg.key.remoteJid);
        } catch (_) {}
      }
    }
  });

  return sock;
}

// ============================================================
// 🚀 Start
// ============================================================
async function main() {
  console.log("🚀 Starting Commercial WhatsApp AI Business Bot...");
  startTelegramBot();
  await connectWhatsApp();
  console.log("✅ Business Bot is Live & Ready!");
}

main().catch(async (err) => {
  console.error("💥 Fatal error on boot:", err);
  await notifyAdmin(`💥 *Fatal Error on server:*\n${err.message}`);
  process.exit(1);
});
