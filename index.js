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
    botOn: state.isOn,
    uptime: Math.floor(process.uptime()) + "s",
    timestamp: new Date().toISOString(),
  })
);

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
      console.log("📱 QR Code ready — sending to Telegram...");
      try {
        const qrBuffer = await QRCode.toBuffer(qr, { width: 400 });
        await sendPhotoToAdmin(qrBuffer, "📱 WhatsApp QR Code! ১ মিনিটের মধ্যে স্ক্যান করুন");
        await notifyAdmin("1️⃣ WhatsApp ওপেন করুন\n2️⃣ Settings → Linked Devices\n3️⃣ এই QR স্ক্যান করুন");
      } catch (err) {
        await notifyAdmin(`📱 *QR Code:* https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`);
      }
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log(`🔴 WhatsApp Connection closed. Code: ${code}. Reconnect: ${shouldReconnect}`);

      if (shouldReconnect) {
        await notifyAdmin(`🔄 *WhatsApp reconnecting...* (Code: ${code})`);
        setTimeout(connectWhatsApp, 5000);
      } else {
        await notifyAdmin("🔴 *WhatsApp Logout হয়ে গেছে! আবার QR স্ক্যান করতে হবে।*");
      }
    }

    if (connection === "open") {
      console.log("✅ WhatsApp business connected!");
      await notifyAdmin("✅ *WhatsApp সফলভাবে কানেক্ট হয়েছে!*\nদোকানের AI সেলস অ্যাসিস্ট্যান্ট এখন একটিভ।");
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
