// ============================================================
// telegram.js - Telegram Control Panel with Persona, Orders & Takeover
// ============================================================
import { Telegraf, Markup } from "telegraf";
import QRCode from "qrcode";
import { state, addLog, saveConfig, getFullSystemPrompt, catalog } from "./state.js";
import { clearAllHistory } from "./gemini.js";
import { getAllOrders, updateOrderStatus, formatOrderCard, getOrderById } from "./orders.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = String(process.env.TELEGRAM_ADMIN_CHAT_ID);

let bot = null;
if (token) {
  bot = new Telegraf(token, {
    handlerTimeout: 90000,
  });

  bot.catch((err, ctx) => {
    console.error(`⚠️ Telegram bot error for ${ctx.updateType}:`, err.message);
  });
}

process.on("unhandledRejection", (reason) => {
  console.warn("⚠️ Handled async warning:", reason?.message || reason);
});

function requireAdmin(ctx, next) {
  if (String(ctx.chat.id) !== ADMIN_ID) return;
  return next();
}

if (bot) {
  // Main Dashboard / Help
  bot.start(requireAdmin, (ctx) => {
    const statusText = state.isWhatsAppConnected ? "🟢 WhatsApp Connected" : "🔴 WhatsApp Disconnected";
    const buttons = Markup.inlineKeyboard([
      [
        Markup.button.callback("🔑 WhatsApp Login (QR)", "btn_request_qr"),
        Markup.button.callback("📊 Status", "btn_check_status"),
      ],
      [
        Markup.button.callback("🛒 View Orders", "btn_view_orders"),
        Markup.button.callback("📦 View Catalog", "btn_view_catalog"),
      ],
    ]);

    return ctx.reply(
      `💼 *WhatsApp AI Business Assistant — Command Desk*\n` +
      `দোকান: *${state.shopName}* | মালিক: *${state.ownerName}*\n` +
      `স্ট্যাটাস: *${statusText}*\n\n` +
      `*দ্রুত অ্যাকশন নিতে নিচের বাটনে চাপ দিন:*`,
      { parse_mode: "Markdown", ...buttons }
    );
  });

  // Dedicated /login command and button callback
  const handleLoginRequest = async (ctx) => {
    if (state.isWhatsAppConnected) {
      return ctx.reply("✅ আপনার WhatsApp ইতিমধ্যে কানেক্টেড রয়েছে! আর কোনো QR স্ক্যান করার প্রয়োজন নেই।");
    }

    if (!state.latestQR) {
      return ctx.reply("⏳ নতুন QR কোড জেনারেট হচ্ছে... দয়া করে ৫-১০ সেকেন্ড পর আবার চেষ্টা করুন।");
    }

    try {
      const qrBuffer = await QRCode.toBuffer(state.latestQR, { width: 400 });
      await ctx.replyWithPhoto(
        { source: qrBuffer },
        {
          caption:
            "📱 *WhatsApp Login QR Code*\n\n" +
            "১. আপনার ফোনের WhatsApp ওপেন করুন\n" +
            "২. Settings → Linked Devices → Link a Device\n" +
            "৩. এই QR কোডটি স্ক্যান করে নিন (৪০ সেকেন্ডের মধ্যে)",
          parse_mode: "Markdown",
        }
      );
    } catch (err) {
      ctx.reply(`📱 QR Code Link: https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(state.latestQR)}`);
    }
  };

  bot.command("login", requireAdmin, handleLoginRequest);
  bot.action("btn_request_qr", handleLoginRequest);

  bot.action("btn_check_status", async (ctx) => {
    await ctx.answerCbQuery();
    const statusText = state.isWhatsAppConnected ? "🟢 WhatsApp Connected" : "🔴 WhatsApp Disconnected";
    ctx.reply(
      `📊 *Business Bot Status*\n\n` +
      `🏢 দোকান: *${state.shopName}*\n` +
      `📱 WhatsApp: *${statusText}*\n` +
      `🤖 AI রিপ্লাই: ${state.isOn ? "✅ সচল" : "🔴 বন্ধ"}\n` +
      `🛒 মোট অর্ডার: ${getAllOrders().length} টি\n` +
      `💬 দৈনিক রিপ্লাই লিমিট: ${state.maxDailyRepliesPerUser} টি`,
      { parse_mode: "Markdown" }
    );
  });

  bot.action("btn_view_orders", async (ctx) => {
    await ctx.answerCbQuery();
    const all = getAllOrders();
    if (!all.length) return ctx.reply("📭 এখনো কোনো নতুন অর্ডার আসেনি।");
    const recent = all.slice(0, 3);
    for (const ord of recent) {
      const card = formatOrderCard(ord);
      const buttons = Markup.inlineKeyboard([
        [
          Markup.button.callback("✅ Confirm", `order_confirm_${ord.id}`),
          Markup.button.callback("❌ Cancel", `order_cancel_${ord.id}`),
        ],
      ]);
      ctx.reply(card, { parse_mode: "Markdown", ...buttons });
    }
  });

  bot.action("btn_view_catalog", async (ctx) => {
    await ctx.answerCbQuery();
    const list = (catalog.products || [])
      .map((p, idx) => `${idx + 1}. *${p.name}* (ID: \`${p.id}\`)\n   💵 দাম: ৳${p.price} | সাইজ: ${(p.sizes || []).join(", ")} | কালার: ${(p.colors || []).join(", ")}`)
      .join("\n\n");
    ctx.reply(`📦 *প্রোডাক্ট ক্যাটালগ:*\n\n${list || "কোনো প্রোডাক্ট পাওয়া যায়নি।"}`, { parse_mode: "Markdown" });
  });

  bot.command("on", requireAdmin, (ctx) => {
    state.isOn = true;
    saveConfig();
    ctx.reply("✅ AI Bot চালু করা হয়েছে! এখন WhatsApp কাস্টমারদের রিপ্লাই দেওয়া হবে।");
  });

  bot.command("off", requireAdmin, (ctx) => {
    state.isOn = false;
    saveConfig();
    ctx.reply("🔴 AI Bot বন্ধ করা হয়েছে। কোনো অটো-রিপ্লাই হবে না।");
  });

  bot.command("shop", requireAdmin, (ctx) => {
    const name = ctx.message.text.replace("/shop", "").trim();
    if (!name) return ctx.reply(`বর্তমান দোকানের নাম: *${state.shopName}*\nপরিবর্তন করতে লিখুন: \`/shop আমার দোকান\``, { parse_mode: "Markdown" });
    state.shopName = name;
    saveConfig();
    clearAllHistory();
    ctx.reply(`✅ দোকানের নাম আপডেট করা হয়েছে: *${name}*`, { parse_mode: "Markdown" });
  });

  bot.command("setowner", requireAdmin, (ctx) => {
    const name = ctx.message.text.replace("/setowner", "").trim();
    if (!name) return ctx.reply("ব্যবহার: `/setowner মামুন`", { parse_mode: "Markdown" });
    state.ownerName = name;
    saveConfig();
    clearAllHistory();
    ctx.reply(`✅ Owner নাম সেট হয়েছে: *${name}*`, { parse_mode: "Markdown" });
  });

  bot.command("maxreplies", requireAdmin, (ctx) => {
    const num = parseInt(ctx.message.text.replace("/maxreplies", "").trim(), 10);
    if (!num || isNaN(num)) return ctx.reply(`বর্তমান লিমিট: প্রতি কাস্টমারকে দিনে সর্বোচ্চ *${state.maxDailyRepliesPerUser}* টি রিপ্লাই।\nপরিবর্তন করতে: \`/maxreplies 20\``, { parse_mode: "Markdown" });
    state.maxDailyRepliesPerUser = num;
    saveConfig();
    ctx.reply(`✅ প্রতি ইউজারের জন্য দৈনিক ম্যাক্স রিপ্লাই লিমিট সেট করা হয়েছে: *${num}* টি।`);
  });

  bot.command("catalog", requireAdmin, (ctx) => {
    const list = (catalog.products || [])
      .map((p, idx) => `${idx + 1}. *${p.name}* (ID: \`${p.id}\`)\n   💵 দাম: ৳${p.price} | সাইজ: ${(p.sizes || []).join(", ")} | কালার: ${(p.colors || []).join(", ")}`)
      .join("\n\n");
    ctx.reply(`📦 *প্রোডাক্ট ক্যাটালগ:*\n\n${list || "কোনো প্রোডাক্ট পাওয়া যায়নি।"}`, { parse_mode: "Markdown" });
  });

  bot.command("orders", requireAdmin, (ctx) => {
    const all = getAllOrders();
    if (!all.length) return ctx.reply("📭 এখনো কোনো নতুন অর্ডার আসেনি।");

    const recent = all.slice(0, 5);
    for (const ord of recent) {
      const card = formatOrderCard(ord);
      const buttons = Markup.inlineKeyboard([
        [
          Markup.button.callback("✅ Confirm", `order_confirm_${ord.id}`),
          Markup.button.callback("❌ Cancel", `order_cancel_${ord.id}`),
        ],
        [
          Markup.button.callback(`👤 Takeover (${ord.customerPhone.slice(-4)})`, `takeover_${ord.customerPhone}`),
        ],
      ]);
      ctx.reply(card, { parse_mode: "Markdown", ...buttons });
    }
  });

  // Human Takeover / Mute AI for a customer
  bot.command("takeover", requireAdmin, (ctx) => {
    const phone = ctx.message.text.replace("/takeover", "").trim().replace("+", "");
    if (!phone) return ctx.reply("ব্যবহার: `/takeover 88017XXXXXXXX`", { parse_mode: "Markdown" });
    state.mutedContacts.add(phone);
    saveConfig();
    ctx.reply(`⏸️ *${phone}*-এর জন্য AI সাময়িকভাবে বন্ধ (Mute) করা হয়েছে। এখন আপনি সরাসরি WhatsApp থেকে রিপ্লাই দিতে পারেন।\n\nআবার AI চালু করতে: \`/resume ${phone}\``, { parse_mode: "Markdown" });
  });

  bot.command("resume", requireAdmin, (ctx) => {
    const phone = ctx.message.text.replace("/resume", "").trim().replace("+", "");
    if (!phone) return ctx.reply("ব্যবহার: `/resume 88017XXXXXXXX`", { parse_mode: "Markdown" });
    state.mutedContacts.delete(phone);
    saveConfig();
    ctx.reply(`▶️ *${phone}*-এর জন্য AI পুনরায় চালু করা হয়েছে।`, { parse_mode: "Markdown" });
  });

  // Action Button Callbacks (Inline Keyboards)
  bot.action(/order_confirm_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    updateOrderStatus(orderId, "Confirmed");
    await ctx.answerCbQuery(`অর্ডার #${orderId} কনফার্ম করা হয়েছে!`);
    const ord = getOrderById(orderId);
    if (ord) {
      await ctx.editMessageText(formatOrderCard(ord), { parse_mode: "Markdown" });
    }
  });

  bot.action(/order_cancel_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    updateOrderStatus(orderId, "Cancelled");
    await ctx.answerCbQuery(`অর্ডার #${orderId} বাতিল করা হয়েছে!`);
    const ord = getOrderById(orderId);
    if (ord) {
      await ctx.editMessageText(formatOrderCard(ord), { parse_mode: "Markdown" });
    }
  });

  bot.action(/takeover_(.+)/, async (ctx) => {
    const phone = ctx.match[1];
    state.mutedContacts.add(phone);
    saveConfig();
    await ctx.answerCbQuery(`${phone}-এর জন্য AI Mute করা হয়েছে!`);
    ctx.reply(`👤 *Takeover Mode Activated!*\n${phone} এর জন্য AI রিপ্লাই বন্ধ করা হয়েছে। আপনি ম্যানুয়ালি চ্যাট করুন।\nশেষ হলে \`/resume ${phone}\` লিখুন।`, { parse_mode: "Markdown" });
  });

  bot.command("status", requireAdmin, (ctx) => {
    ctx.reply(
      `📊 *Business Bot Status*\n\n` +
      `🏢 দোকান: *${state.shopName}*\n` +
      `🤖 AI স্ট্যাটাস: ${state.isOn ? "✅ সচল" : "🔴 বন্ধ"}\n` +
      `💬 প্রতি কাস্টমার দৈনিক লিমিট: *${state.maxDailyRepliesPerUser}* টি\n` +
      `⏸️ Muted/Takeover Contacts: ${state.mutedContacts.size} জন\n` +
      `🛒 মোট অর্ডার সংখ্যা: ${getAllOrders().length} টি\n` +
      `📦 ক্যাটালগে প্রোডাক্ট: ${(catalog.products || []).length} টি\n` +
      `📨 মোট হ্যান্ডেলড লগ: ${state.logs.length} টি`,
      { parse_mode: "Markdown" }
    );
  });

  bot.command("send", requireAdmin, async (ctx) => {
    const parts = ctx.message.text.split(" ");
    const number = parts[1];
    const message = parts.slice(2).join(" ");

    if (!number || !message) return ctx.reply("ব্যবহার: `/send 880xxxxxxxxxx আপনার মেসেজ`");
    if (!state.sock) return ctx.reply("❌ WhatsApp এখনো কানেক্টেড নেই!");

    try {
      const jid = number.includes("@") ? number : `${number}@s.whatsapp.net`;
      await state.sock.sendMessage(jid, { text: message });
      ctx.reply(`✅ মেসেজ পাঠানো হয়েছে → ${number}\n💬 "${message}"`);
    } catch (err) {
      ctx.reply(`❌ Error: ${err.message}`);
    }
  });
}

// Helper: New Order Notification with Action Buttons
export async function sendOrderAlert(order) {
  if (!bot) return;
  try {
    const card = formatOrderCard(order);
    const buttons = Markup.inlineKeyboard([
      [
        Markup.button.callback("✅ Confirm Order", `order_confirm_${order.id}`),
        Markup.button.callback("❌ Cancel Order", `order_cancel_${order.id}`),
      ],
      [
        Markup.button.callback("👤 Takeover / Pause AI", `takeover_${order.customerPhone}`),
      ],
    ]);

    await bot.telegram.sendMessage(ADMIN_ID, card, {
      parse_mode: "Markdown",
      ...buttons,
    });
  } catch (err) {
    console.error("Order alert error:", err.message);
  }
}

export async function notifyAdmin(message, extra = {}) {
  if (!bot) return;
  try {
    await bot.telegram.sendMessage(ADMIN_ID, message, {
      parse_mode: "Markdown",
      ...extra,
    });
  } catch (err) {
    console.error("Telegram notify error:", err.message);
  }
}

export async function sendPhotoToAdmin(source, caption) {
  if (!bot) return;
  try {
    await bot.telegram.sendPhoto(ADMIN_ID, { source }, { caption });
  } catch (err) {
    console.error("Telegram photo error:", err.message);
  }
}

export async function startTelegramBot() {
  if (!bot) {
    console.warn("⚠️ TELEGRAM_BOT_TOKEN not provided.");
    return;
  }

  const launchWithRetry = async () => {
    try {
      await bot.launch();
      console.log("✅ Telegram business desk connected!");
    } catch (err) {
      console.warn("⚠️ Telegram connect retry in 10s:", err.message);
      setTimeout(launchWithRetry, 10000);
    }
  };

  launchWithRetry();

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

export default bot;
