// ============================================================
// index.js - Main Entry Point (Baileys + Gemini + Telegram)
// ============================================================
import "dotenv/config";
import { makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import express from "express";
import cron from "node-cron";
import { state, addLog, getFullSystemPrompt } from "./state.js";
import { getGeminiReply, getGeminiImageReply } from "./gemini.js";
import { startTelegramBot, notifyAdmin, sendPhotoToAdmin } from "./telegram.js";

// ============================================================
// 🌐 Express Keep-alive Server
// ============================================================
const app = express();
const PORT = process.env.PORT || 8000;

app.get("/",       (req, res) => res.send("🤖 WhatsApp AI Bot is running!"));
app.get("/health", (req, res) => res.json({
  status: "ok",
  botOn: state.isOn,
  groupReply: state.replyInGroups,
  uptime: Math.floor(process.uptime()) + "s",
  timestamp: new Date().toISOString(),
}));

app.listen(PORT, () => console.log(`✅ Keep-alive server on port ${PORT}`));

// ============================================================
// 🕐 Cron Jobs — Server জাগিয়ে রাখো
// ============================================================

// Self-ping: প্রতি 4 মিনিটে নিজেকে ping
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

// Daily Report: প্রতিদিন সকাল ৮টায় Telegram এ
cron.schedule("0 8 * * *", async () => {
  const hours = (process.uptime() / 3600).toFixed(1);
  await notifyAdmin(
    `🌅 *Daily Status Report*\n\n` +
    `🤖 AI Reply: ${state.isOn ? "✅ চালু" : "🔴 বন্ধ"}\n` +
    `👥 Group Reply: ${state.replyInGroups ? "✅ চালু" : "🔴 বন্ধ"}\n` +
    `⏱️ Uptime: ${hours} ঘণ্টা\n` +
    `📨 Logs: ${state.logs.length} টি`
  );
}, { timezone: "Asia/Dhaka" });

// ============================================================
// 📱 WhatsApp Connection (Baileys)
// ============================================================
const processedMessages = new Set();

async function connectWhatsApp() {
  const { state: authState, saveCreds } = await useMultiFileAuthState("./auth_info");

  const sock = makeWASocket({
    auth: authState,
    logger: pino({ level: "silent" }),
    browser: ["WhatsApp AI Bot", "Chrome", "1.0"],
  });

  state.sock = sock;

  // ---- QR Code → Telegram এ পাঠাও ----
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("📱 QR Code ready — Telegram এ পাঠাচ্ছি...");
      try {
        const qrBuffer = await QRCode.toBuffer(qr, { width: 400 });
        await sendPhotoToAdmin(qrBuffer, "📱 WhatsApp QR Code! এটা scan করো (১ মিনিটের মধ্যে)");
        await notifyAdmin("1️⃣ WhatsApp খোলো\n2️⃣ Settings → Linked Devices\n3️⃣ Link a Device\n4️⃣ এই QR code scan করো");
      } catch (err) {
        await notifyAdmin(`📱 *QR Code Scan করো:*\nhttps://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`);
      }
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;

      console.log(`🔴 Connection closed. Code: ${code}. Reconnect: ${shouldReconnect}`);

      if (shouldReconnect) {
        await notifyAdmin(`🔄 *WhatsApp disconnect! Reconnect হচ্ছে...*\nCode: ${code}`);
        setTimeout(connectWhatsApp, 5000);
      } else {
        await notifyAdmin("🔴 *WhatsApp Logout হয়ে গেছে! Bot restart দরকার।*");
      }
    }

    if (connection === "open") {
      console.log("✅ WhatsApp connected!");
      await notifyAdmin("✅ *WhatsApp সফলভাবে connect হয়েছে!*\n\nBot এখন active। Telegram থেকে control করো।");
    }
  });

  // Session save করো
  sock.ev.on("creds.update", saveCreds);

  // ============================================================
  // 📨 Message Handler
  // ============================================================
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      try {
        // নিজের পাঠানো message ignore
        if (msg.key.fromMe) continue;

        // Status update ignore
        if (msg.key.remoteJid === "status@broadcast") continue;

        const msgId = msg.key.id;
        if (!msgId || processedMessages.has(msgId)) continue;
        processedMessages.add(msgId);
        // keep memory clean
        if (processedMessages.size > 1000) {
          const first = processedMessages.values().next().value;
          processedMessages.delete(first);
        }

        const isGroup    = msg.key.remoteJid.endsWith("@g.us");
        const jid        = msg.key.remoteJid;
        const pushName   = msg.pushName || "Unknown";
        const msgContent = msg.message;

        if (!msgContent) continue;

        // ---- Message type detect ----
        const textMsg   = msgContent.conversation
                       || msgContent.extendedTextMessage?.text
                       || msgContent.imageMessage?.caption
                       || "";
        const isImage   = !!msgContent.imageMessage;

        // ============================================================
        // GROUP MESSAGE
        // ============================================================
        if (isGroup) {
          if (!state.replyInGroups) continue;
          if (!state.isOn) continue;

          // Group whitelist check
          if (state.groupWhitelist.size > 0 && !state.groupWhitelist.has(jid)) continue;

          // Show typing indicator
          await sock.presenceSubscribe(jid);
          await sock.sendPresenceUpdate("composing", jid);

          const systemPrompt = getFullSystemPrompt();
          let reply;
          if (isImage) {
            await notifyAdmin(`📨 *Group Image*\n👤 ${pushName}\n👥 Group: ${jid}\n📎 Caption: ${textMsg || "(নেই)"}`);
            const buffer = await downloadMediaMessage(msg, "buffer", {});
            reply = await getGeminiImageReply(jid, buffer, "image/jpeg", textMsg, systemPrompt);
          } else if (textMsg) {
            await notifyAdmin(`📨 *Group Message*\n👤 ${pushName}\n👥 ${jid}\n💬 ${textMsg}`);
            reply = await getGeminiReply(jid, textMsg, systemPrompt);
          } else {
            await sock.sendPresenceUpdate("paused", jid);
            continue;
          }

          // Stop typing indicator
          await sock.sendPresenceUpdate("paused", jid);

          // Group এ quoted reply দাও
          await sock.sendMessage(jid, { text: reply }, { quoted: msg });
          await notifyAdmin(`🤖 *Group Reply পাঠানো:*\n${reply}`);

          addLog({ type: "group", from: `${pushName} (${jid})`, message: textMsg || "[image]", reply });
          continue;
        }

        // ============================================================
        // PERSONAL MESSAGE
        // ============================================================
        if (!state.isOn) continue;

        // Whitelist check
        const senderNumber = jid.replace("@s.whatsapp.net", "");
        if (state.whitelist.size > 0 && !state.whitelist.has(senderNumber) && !state.whitelist.has(jid)) continue;

        // Show typing indicator
        await sock.presenceSubscribe(jid);
        await sock.sendPresenceUpdate("composing", jid);

        const systemPrompt = getFullSystemPrompt();
        let reply;
        if (isImage) {
          await notifyAdmin(`📨 *Personal Image*\n👤 ${pushName} (${senderNumber})\n📎 Caption: ${textMsg || "(নেই)"}`);
          const buffer = await downloadMediaMessage(msg, "buffer", {});
          reply = await getGeminiImageReply(jid, buffer, "image/jpeg", textMsg, systemPrompt);
        } else if (textMsg) {
          await notifyAdmin(`📨 *Personal Message*\n👤 ${pushName} (${senderNumber})\n💬 ${textMsg}`);
          reply = await getGeminiReply(jid, textMsg, systemPrompt);
        } else {
          await sock.sendPresenceUpdate("paused", jid);
          continue;
        }

        // Stop typing indicator
        await sock.sendPresenceUpdate("paused", jid);

        // Reply পাঠাও
        await sock.sendMessage(jid, { text: reply });
        await notifyAdmin(`🤖 *Reply পাঠানো:*\n${reply}`);

        addLog({ type: "personal", from: `${pushName} (${senderNumber})`, message: textMsg || "[image]", reply });

      } catch (err) {
        console.error("❌ Message error:", err.message);
        await notifyAdmin(`❌ *Message error:*\n${err.message}`);
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
  console.log("🚀 Starting WhatsApp AI Bot (Baileys)...");
  startTelegramBot();
  await connectWhatsApp();
  console.log("✅ All systems ready!");
}

main().catch(async (err) => {
  console.error("💥 Fatal:", err);
  await notifyAdmin(`💥 *Fatal Error!*\n${err.message}`);
  process.exit(1);
});
