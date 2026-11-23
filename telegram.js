// ============================================================
// telegram.js - Commercial Telegram Control Center & Mode-Specific Dashboard
// ============================================================
import { Telegraf, Markup } from "telegraf";
import QRCode from "qrcode";
import { state, addLog, saveConfig, getFullSystemPrompt, catalog, saveCatalog } from "./state.js";
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

// ============================================================
// Dynamic Mode-Specific Dashboard Generator
// ============================================================
export function renderDashboard(ctx) {
  // 1. If NOT connected to WhatsApp, show simple Onboarding Screen
  if (!state.isWhatsAppConnected) {
    const buttons = Markup.inlineKeyboard([
      [Markup.button.callback("🔑 WhatsApp Connect (QR)", "btn_request_qr")],
      [Markup.button.callback("🔄 Refresh Connection Status", "btn_refresh_status")],
    ]);

    const msg =
      `👋 *স্বাগতম! WhatsApp AI Agent Control Center-এ*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🔴 *কানেকশন স্ট্যাটাস:* WhatsApp ডিসকানেক্টেড\n\n` +
      `বট চালু করতে এবং সেটিংস ব্যবহার করতে প্রথমে WhatsApp অ্যাকাউন্ট কানেক্ট করুন।\n\n` +
      `👇 *নিচের বাটনে চাপ দিয়ে QR কোড স্ক্যান করুন:*`;

    return ctx.reply(msg, { parse_mode: "Markdown", ...buttons });
  }

  const appUrl = process.env.APP_URL || "https://whatsapp-ai-bot-nwxy.onrender.com";

  // ============================================================
  // 2. PERSONAL ASSISTANT MODE DASHBOARD
  // ============================================================
  if (state.mode === "personal") {
    const buttons = Markup.inlineKeyboard([
      [
        Markup.button.callback("🎭 Mode: 👤 Personal", "btn_menu_modes"),
        Markup.button.callback("👤 My Bio & Instructions", "btn_menu_personal_settings"),
      ],
      [
        Markup.button.callback("💳 Subscription & Quota", "btn_menu_sub"),
        Markup.button.webApp("📱 Open WebApp Sheet", `${appUrl}/webapp`),
      ],
      [
        Markup.button.callback(state.isOn ? "🟢 Bot: ON" : "🔴 Bot: OFF", "btn_toggle_power"),
        Markup.button.callback("🔴 Disconnect", "btn_disconnect_wa"),
      ],
    ]);

    const msg =
      `💼 *WhatsApp AI Assistant — Personal Desk*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🟢 *WhatsApp:* কানেক্টেড ✅\n` +
      `🎯 *সক্রিয় মোড:* 👤 Personal Assistant\n` +
      `👤 *মালিকের নাম:* ${state.ownerName}\n` +
      `ℹ️ *আমার পরিচয় (Bio):* _${state.personal?.bio}_\n` +
      `🎭 *কথার টোন:* _${state.personal?.tone}_\n` +
      `📝 *বটকে দেওয়া নির্দেশ:* _${state.personal?.instruction}_\n` +
      `⚡ *AI স্ট্যাটাস:* ${state.isOn ? "সচল (Active)" : "বন্ধ (Paused)"}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `নিচের বাটন চেপে আপনার নির্দেশ ও পরিচয় পরিবর্তন করুন:`;

    return ctx.reply(msg, { parse_mode: "Markdown", ...buttons });
  }

  // ============================================================
  // 3. CUSTOMER SUPPORT / FAQ MODE DASHBOARD
  // ============================================================
  if (state.mode === "support") {
    const buttons = Markup.inlineKeyboard([
      [
        Markup.button.callback("🎭 Mode: 🎧 Support", "btn_menu_modes"),
        Markup.button.callback("🎧 Support & Policy Settings", "btn_menu_support_settings"),
      ],
      [
        Markup.button.callback("💳 Subscription & Quota", "btn_menu_sub"),
        Markup.button.webApp("📱 Open WebApp Sheet", `${appUrl}/webapp`),
      ],
      [
        Markup.button.callback(state.isOn ? "🟢 Bot: ON" : "🔴 Bot: OFF", "btn_toggle_power"),
        Markup.button.callback("🔴 Disconnect", "btn_disconnect_wa"),
      ],
    ]);

    const msg =
      `💼 *WhatsApp AI Assistant — Support Desk*\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🟢 *WhatsApp:* কানেক্টেড ✅\n` +
      `🎯 *সক্রিয় মোড:* 🎧 Customer Support / FAQ\n` +
      `🏢 *হেল্পডেস্ক:* ${state.support?.orgName}\n` +
      `🎧 *সাপোর্ট টোন:* _${state.support?.tone}_\n` +
      `📋 *পলিসি ও নিয়মাবলী:* _${state.support?.instruction}_\n` +
      `⚡ *AI স্ট্যাটাস:* ${state.isOn ? "সচল (Active)" : "বন্ধ (Paused)"}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `নিচের বাটন চেপে সাপোর্ট তথ্য ও পলিসি আপডেট করুন:`;

    return ctx.reply(msg, { parse_mode: "Markdown", ...buttons });
  }

  // ============================================================
  // 4. BUSINESS / PRODUCT SALES MODE DASHBOARD (Default)
  // ============================================================
  const pendingOrdersCount = getAllOrders().filter((o) => o.status === "Pending").length;
  const buttons = Markup.inlineKeyboard([
    [
      Markup.button.callback("🎭 Mode: 🛍️ Sales", "btn_menu_modes"),
      Markup.button.callback("🏢 Shop & Sales Settings", "btn_menu_business_settings"),
    ],
    [
      Markup.button.callback("📦 Product Manager", "btn_menu_products"),
      Markup.button.callback(`🛒 Orders (${pendingOrdersCount} pending)`, "btn_view_orders"),
    ],
    [
      Markup.button.callback("💳 Subscription & Quota", "btn_menu_sub"),
      Markup.button.webApp("📱 Open WebApp Sheet", `${appUrl}/webapp`),
    ],
    [
      Markup.button.callback(state.isOn ? "🟢 Bot: ON" : "🔴 Bot: OFF", "btn_toggle_power"),
      Markup.button.callback("🔴 Disconnect", "btn_disconnect_wa"),
    ],
  ]);

  const msg =
    `💼 *WhatsApp AI Assistant — Sales & Store Desk*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🟢 *WhatsApp:* কানেক্টেড ✅\n` +
    `🎯 *সক্রিয় মোড:* 🛍️ Product Sales (Business)\n` +
    `🏢 *দোকান:* ${state.business?.shopName} | *মালিক:* ${state.ownerName}\n` +
    `📦 *প্রোডাক্ট:* ${(catalog.products || []).length} টি | 🛒 *পেন্ডিং অর্ডার:* ${pendingOrdersCount} টি\n` +
    `🎭 *সেলস টোন:* _${state.business?.tone}_\n` +
    `📝 *সেলস নির্দেশ:* _${state.business?.instruction}_\n` +
    `⚡ *AI স্ট্যাটাস:* ${state.isOn ? "সচল (Active)" : "বন্ধ (Paused)"}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `নিচের বাটন চেপে প্রোডাক্ট বা অর্ডার ম্যানেজ করুন:`;

  return ctx.reply(msg, { parse_mode: "Markdown", ...buttons });
}

if (bot) {
  // Main Start Command
  bot.start(requireAdmin, (ctx) => {
    state.activeAdminPrompts.delete(ctx.chat.id);
    return renderDashboard(ctx);
  });

  // Login / QR Handlers
  const handleLoginRequest = async (ctx) => {
    if (state.isWhatsAppConnected) {
      return ctx.reply("✅ আপনার WhatsApp ইতিমধ্যে কানেক্টেড রয়েছে!");
    }

    if (!state.latestQR) {
      return ctx.reply("⏳ নতুন QR কোড তৈরি হচ্ছে... দয়া করে ৫-১০ সেকেন্ড পর আবার 'WhatsApp Connect (QR)' বাটনে চাপ দিন।");
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
      ctx.reply(`📱 QR Code: https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(state.latestQR)}`);
    }
  };

  bot.command("login", requireAdmin, handleLoginRequest);
  bot.action("btn_request_qr", handleLoginRequest);

  bot.action("btn_refresh_status", async (ctx) => {
    await ctx.answerCbQuery();
    return renderDashboard(ctx);
  });

  // ============================================================
  // Mode Selection Handlers
  // ============================================================
  bot.action("btn_menu_modes", async (ctx) => {
    await ctx.answerCbQuery();
    const buttons = Markup.inlineKeyboard([
      [Markup.button.callback("🛍️ Product Sales (Business Mode)", "set_mode_business")],
      [Markup.button.callback("👤 Personal Assistant Mode", "set_mode_personal")],
      [Markup.button.callback("🎧 Customer Support / FAQ Mode", "set_mode_support")],
      [Markup.button.callback("⬅️ Back to Dashboard", "btn_back_home")],
    ]);

    ctx.reply(
      `🎭 *AI Operation Mode নির্বাচন করুন:*\n\n` +
      `১. *🛍️ Product Sales (Business):* ক্যাটালগ দেখে দাম ও সাইজ বলবে, ছবি চিনে স্বয়ংক্রিয় অর্ডার নেবে এবং আপনাকে কার্ড পাঠাবে।\n\n` +
      `২. *👤 Personal Assistant:* আপনার ব্যক্তিগত সহকারী হিসেবে চ্যাট করবে, অপ্রয়োজনীয় বড় কাজ এড়িয়ে চলবে এবং প্রয়োজনীয় মেসেজ নোট রাখবে।\n\n` +
      `৩. *🎧 Customer Support:* আপনার প্রতিষ্ঠানের নিয়মাবলী, পলিসি ও ডেলিভারি সংক্রান্ত প্রশ্নের উত্তর দেবে।`,
      { parse_mode: "Markdown", ...buttons }
    );
  });

  bot.action(/set_mode_(.+)/, async (ctx) => {
    const selectedMode = ctx.match[1];
    state.mode = selectedMode;
    saveConfig();
    clearAllHistory();
    await ctx.answerCbQuery(`মোড সেট হয়েছে: ${selectedMode}`);
    ctx.reply(`✅ *মোড সফলভাবে পরিবর্তন করা হয়েছে!* এখন AI নতুন মোড অনুযায়ী হোয়াটসঅ্যাপে রেসপন্স করবে।`, { parse_mode: "Markdown" });
    return renderDashboard(ctx);
  });

  // ============================================================
  // Personal Mode Settings Menu
  // ============================================================
  bot.action("btn_menu_personal_settings", async (ctx) => {
    await ctx.answerCbQuery();
    const buttons = Markup.inlineKeyboard([
      [Markup.button.callback("✏️ Set My Name", "prompt_personal_owner_name")],
      [Markup.button.callback("ℹ️ Set My Bio (পরিচয়)", "prompt_personal_bio")],
      [Markup.button.callback("🎭 Set Speaking Tone", "prompt_personal_tone")],
      [Markup.button.callback("📝 Set Instructions (কী করবে/বলবে)", "prompt_personal_instruction")],
      [Markup.button.callback("⬅️ Back to Dashboard", "btn_back_home")],
    ]);

    ctx.reply(
      `👤 *Personal Assistant সেটিংস:*\n\n` +
      `👤 মালিকের নাম: *${state.ownerName}*\n` +
      `ℹ️ আমার পরিচয় (Bio): _${state.personal?.bio}_\n` +
      `🎭 কথার টোন: _${state.personal?.tone}_\n` +
      `📝 নির্দেশাবলী: _${state.personal?.instruction}_\n\n` +
      `যা পরিবর্তন করতে চান নিচের বাটনে চাপ দিন:`,
      { parse_mode: "Markdown", ...buttons }
    );
  });

  bot.action("prompt_personal_owner_name", async (ctx) => {
    await ctx.answerCbQuery();
    state.activeAdminPrompts.set(ctx.chat.id, { step: "personal_owner_name" });
    ctx.reply("👤 আপনার নাম লিখে পাঠান (যেমন: 'মামুন'):");
  });

  bot.action("prompt_personal_bio", async (ctx) => {
    await ctx.answerCbQuery();
    state.activeAdminPrompts.set(ctx.chat.id, { step: "personal_bio" });
    ctx.reply("ℹ️ আপনার সম্পর্কে পরিচয় বা বায়ো লিখে পাঠান (যেমন: 'আমি ফ্রিল্যান্সার ও প্রোগ্রামার, বর্তমানে কাজ নিয়ে ব্যস্ত থাকি'):");
  });

  bot.action("prompt_personal_tone", async (ctx) => {
    await ctx.answerCbQuery();
    state.activeAdminPrompts.set(ctx.chat.id, { step: "personal_tone" });
    ctx.reply("🎭 AI কেমন টোনে কথা বলবে? (যেমন: 'খুব বিনয়ী, ক্যাজুয়াল বাংলিশে এবং মাত্র ২-৩ লাইনে'):");
  });

  bot.action("prompt_personal_instruction", async (ctx) => {
    await ctx.answerCbQuery();
    state.activeAdminPrompts.set(ctx.chat.id, { step: "personal_instruction" });
    ctx.reply("📝 বট কী করবে এবং কীভাবে উত্তর দেবে তা বিস্তারিত লিখে পাঠান (যেমন: 'কেউ মেসেজ দিলে বলবে আমি কাজে ব্যস্ত আছি, কোনো কাজ থাকলে আর্জেন্ট মেসেজ রেখে যেতে বলবে'):");
  });

  // ============================================================
  // Business Mode Settings Menu
  // ============================================================
  bot.action("btn_menu_business_settings", async (ctx) => {
    await ctx.answerCbQuery();
    const buttons = Markup.inlineKeyboard([
      [Markup.button.callback("🏢 Set Shop Name", "prompt_business_shop_name")],
      [Markup.button.callback("🚚 Set Delivery Charges", "prompt_delivery_charges")],
      [Markup.button.callback("🎭 Set Sales Tone", "prompt_business_tone")],
      [Markup.button.callback("📝 Set Sales Guidelines", "prompt_business_instruction")],
      [Markup.button.callback("⬅️ Back to Dashboard", "btn_back_home")],
    ]);

    ctx.reply(
      `🏢 *Shop & Sales সেটিংস:*\n\n` +
      `🏢 দোকানের নাম: *${state.business?.shopName}*\n` +
      `🚚 ডেলিভারি চার্জ: ঢাকা ৳${catalog.deliveryCharges?.insideDhaka || 80} | বাইরে ৳${catalog.deliveryCharges?.outsideDhaka || 130}\n` +
      `🎭 সেলস টোন: _${state.business?.tone}_\n` +
      `📝 সেলস নির্দেশাবলী: _${state.business?.instruction}_\n\n` +
      `যা পরিবর্তন করতে চান নিচের বাটনে চাপ দিন:`,
      { parse_mode: "Markdown", ...buttons }
    );
  });

  bot.action("prompt_business_shop_name", async (ctx) => {
    await ctx.answerCbQuery();
    state.activeAdminPrompts.set(ctx.chat.id, { step: "business_shop_name" });
    ctx.reply("🏢 আপনার দোকানের নাম লিখে পাঠান (যেমন: 'Urban Style BD'):");
  });

  bot.action("prompt_delivery_charges", async (ctx) => {
    await ctx.answerCbQuery();
    state.activeAdminPrompts.set(ctx.chat.id, { step: "delivery_charges" });
    ctx.reply("🚚 ঢাকার ভেতরে ও বাইরে ডেলিভারি চার্জ কমা দিয়ে লিখে পাঠান (যেমন: '80, 130'):");
  });

  bot.action("prompt_business_tone", async (ctx) => {
    await ctx.answerCbQuery();
    state.activeAdminPrompts.set(ctx.chat.id, { step: "business_tone" });
    ctx.reply("🎭 সেলসের জন্য AI কেমন টোনে কথা বলবে? (যেমন: 'উদ্যমী, মিষ্টি ও বিনয়ী সেলস স্টাইল'):");
  });

  bot.action("prompt_business_instruction", async (ctx) => {
    await ctx.answerCbQuery();
    state.activeAdminPrompts.set(ctx.chat.id, { step: "business_instruction" });
    ctx.reply("📝 AI কীভাবে সেলস হ্যান্ডেল করবে এবং অর্ডার নেবে তা লিখে পাঠান (যেমন: 'প্রোডাক্টের সাইজ ও কালার জেনে অর্ডার কনফার্ম করতে উৎসাহ দেবে এবং নাম, ফোন নম্বর ও সম্পূর্ণ ঠিকানা চাইবে'):");
  });

  // ============================================================
  // Customer Support Mode Settings Menu
  // ============================================================
  bot.action("btn_menu_support_settings", async (ctx) => {
    await ctx.answerCbQuery();
    const buttons = Markup.inlineKeyboard([
      [Markup.button.callback("🏢 Set Org Name", "prompt_support_org_name")],
      [Markup.button.callback("🎧 Set Support Tone", "prompt_support_tone")],
      [Markup.button.callback("📋 Set Support Policies / FAQs", "prompt_support_instruction")],
      [Markup.button.callback("⬅️ Back to Dashboard", "btn_back_home")],
    ]);

    ctx.reply(
      `🎧 *Customer Support সেটিংস:*\n\n` +
      `🏢 প্রতিষ্ঠানের নাম: *${state.support?.orgName}*\n` +
      `🎧 সাপোর্ট টোন: _${state.support?.tone}_\n` +
      `📋 পলিসি ও নিয়মাবলী: _${state.support?.instruction}_\n\n` +
      `যা পরিবর্তন করতে চান নিচের বাটনে চাপ দিন:`,
      { parse_mode: "Markdown", ...buttons }
    );
  });

  bot.action("prompt_support_org_name", async (ctx) => {
    await ctx.answerCbQuery();
    state.activeAdminPrompts.set(ctx.chat.id, { step: "support_org_name" });
    ctx.reply("🏢 হেল্পডেস্ক বা প্রতিষ্ঠানের নাম লিখে পাঠান:");
  });

  bot.action("prompt_support_tone", async (ctx) => {
    await ctx.answerCbQuery();
    state.activeAdminPrompts.set(ctx.chat.id, { step: "support_tone" });
    ctx.reply("🎧 সাপোর্টের টোন কেমন হবে? (যেমন: 'ধৈর্যশীল ও শান্ত কাস্টমার কেয়ার স্টাইল'):");
  });

  bot.action("prompt_support_instruction", async (ctx) => {
    await ctx.answerCbQuery();
    state.activeAdminPrompts.set(ctx.chat.id, { step: "support_instruction" });
    ctx.reply("📋 দোকানের ডেলিভারি টাইম, রিটার্ন পলিসি এবং সাধারণ নিয়মগুলো লিখে পাঠান:");
  });

  // ============================================================
  // Product Catalog Manager Menu
  // ============================================================
  bot.action("btn_menu_products", async (ctx) => {
    await ctx.answerCbQuery();
    const products = catalog.products || [];
    const list = products
      .map((p, idx) => `${idx + 1}. *${p.name}* — ৳${p.price}\n   সাইজ: ${(p.sizes || []).join(", ")} | কালার: ${(p.colors || []).join(", ")}`)
      .join("\n\n");

    const buttons = Markup.inlineKeyboard([
      [Markup.button.callback("➕ Add New Product", "prompt_add_product")],
      [Markup.button.callback("🗑️ Delete Product", "prompt_delete_product")],
      [Markup.button.callback("⬅️ Back to Dashboard", "btn_back_home")],
    ]);

    ctx.reply(
      `📦 *প্রোডাক্ট ক্যাটালগ ম্যানেজার (${products.length}টি প্রোডাক্ট):*\n\n` +
      `${list || "বর্তমানে কোনো প্রোডাক্ট নেই।"}\n\n` +
      `নতুন প্রোডাক্ট যুক্ত করতে বা মুছতে নিচের বাটন ব্যবহার করুন:`,
      { parse_mode: "Markdown", ...buttons }
    );
  });

  bot.action("prompt_add_product", async (ctx) => {
    await ctx.answerCbQuery();
    state.activeAdminPrompts.set(ctx.chat.id, { step: "add_product_format" });
    ctx.reply(
      `➕ *নতুন প্রোডাক্ট যুক্ত করার নিয়ম:*\n` +
      `নিচের ফরম্যাটে মেসেজ পাঠান:\n\n` +
      `নাম: Polo T-Shirt\n` +
      `দাম: 550\n` +
      `সাইজ: M, L, XL\n` +
      `কালার: Black, Navy\n` +
      `বিবরণ: প্রিমিয়াম কটন ফেব্রিক`,
      { parse_mode: "Markdown" }
    );
  });

  bot.action("prompt_delete_product", async (ctx) => {
    await ctx.answerCbQuery();
    const products = catalog.products || [];
    if (!products.length) return ctx.reply("কোনো প্রোডাক্ট নেই মোছার জন্য।");

    const delButtons = products.map((p) => [
      Markup.button.callback(`❌ Delete: ${p.name.slice(0, 20)}`, `delete_prod_${p.id}`),
    ]);
    delButtons.push([Markup.button.callback("⬅️ Back", "btn_menu_products")]);

    ctx.reply("যে প্রোডাক্টটি ডিলিট করতে চান নির্বাচন করুন:", Markup.inlineKeyboard(delButtons));
  });

  bot.action(/delete_prod_(.+)/, async (ctx) => {
    const prodId = ctx.match[1];
    catalog.products = (catalog.products || []).filter((p) => p.id !== prodId);
    saveCatalog();
    clearAllHistory();
    await ctx.answerCbQuery("প্রোডাক্ট মুছে ফেলা হয়েছে!");
    ctx.reply("✅ প্রোডাক্ট সফলভাবে ক্যাটালগ থেকে মুছে ফেলা হয়েছে।");
    return renderDashboard(ctx);
  });

  // ============================================================
  // Subscription & Quota Menu
  // ============================================================
  bot.action("btn_menu_sub", async (ctx) => {
    await ctx.answerCbQuery();
    const sub = state.subscription;
    const remaining = Math.max(0, sub.totalMessages - sub.usedMessages);
    const percentage = Math.min(100, Math.round((sub.usedMessages / sub.totalMessages) * 100));

    const buttons = Markup.inlineKeyboard([
      [Markup.button.callback("🚀 Upgrade Plan / Add Quota", "btn_upgrade_sub")],
      [Markup.button.callback("⬅️ Back to Dashboard", "btn_back_home")],
    ]);

    ctx.reply(
      `💳 *সাবস্ক্রিপশন ও মেসেজ কোটা স্ট্যাটাস:*\n\n` +
      `📦 বর্তমান প্ল্যান: *${sub.plan}*\n` +
      `📨 ব্যবহৃত মেসেজ: *${sub.usedMessages}* / ${sub.totalMessages} টি (${percentage}% ব্যবহৃত)\n` +
      `⏳ বাকি আছে: *${remaining}* টি AI রিপ্লাই\n` +
      `📅 মেয়াদ: *${sub.expiresAt}*\n\n` +
      `_আপনার প্যাকেজ শেষ হয়ে গেলে AI স্বয়ংক্রিয়ভাবে নতুন মেসেজ পজ রাখবে।_`,
      { parse_mode: "Markdown", ...buttons }
    );
  });

  bot.action("btn_upgrade_sub", async (ctx) => {
    await ctx.answerCbQuery();
    ctx.reply(
      `💎 *প্যাকেজ আপগ্রেড করতে যোগাযোগ করুন:*\n\n` +
      `• *Starter Plan:* মাসে ১,০০০ মেসেজ — ৳৯৯৯/মাস\n` +
      `• *Business Pro:* মাসে ৩,০০০ মেসেজ + গুগল শিটস সিঙ্ক — ৳১,৯৯৯/মাস\n` +
      `• *Unlimited Enterprise:* আনলিমিটেড মেসেজ + কাস্টম সাপোর্ট — ৳৩,৯৯৯/মাস\n\n` +
      `আপগ্রেড বা পেমেন্টের জন্য অ্যাডমিনকে মেসেজ দিন।`,
      { parse_mode: "Markdown" }
    );
  });

  // Power Toggle (On / Off)
  bot.action("btn_toggle_power", async (ctx) => {
    state.isOn = !state.isOn;
    saveConfig();
    await ctx.answerCbQuery(`বট ${state.isOn ? "চালু" : "বন্ধ"} করা হয়েছে`);
    return renderDashboard(ctx);
  });

  // Disconnect WhatsApp
  bot.action("btn_disconnect_wa", async (ctx) => {
    await ctx.answerCbQuery();
    if (state.sock) {
      try {
        await state.sock.logout();
      } catch (_) {}
    }
    state.isWhatsAppConnected = false;
    ctx.reply("🔴 WhatsApp ডিসকানেক্ট করা হয়েছে। পুনরায় কানেক্ট করতে /start চাপুন।");
  });

  // Back to Dashboard
  bot.action("btn_back_home", async (ctx) => {
    await ctx.answerCbQuery();
    state.activeAdminPrompts.delete(ctx.chat.id);
    return renderDashboard(ctx);
  });

  // View Orders (Only in Business Mode)
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
        [
          Markup.button.callback(`👤 Takeover (${ord.customerPhone.slice(-4)})`, `takeover_${ord.customerPhone}`),
        ],
      ]);
      ctx.reply(card, { parse_mode: "Markdown", ...buttons });
    }
  });

  // Order Actions
  bot.action(/order_confirm_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    updateOrderStatus(orderId, "Confirmed");
    await ctx.answerCbQuery(`অর্ডার #${orderId} কনফার্ম করা হয়েছে!`);
    const ord = getOrderById(orderId);
    if (ord) await ctx.editMessageText(formatOrderCard(ord), { parse_mode: "Markdown" });
  });

  bot.action(/order_cancel_(.+)/, async (ctx) => {
    const orderId = ctx.match[1];
    updateOrderStatus(orderId, "Cancelled");
    await ctx.answerCbQuery(`অর্ডার #${orderId} বাতিল করা হয়েছে!`);
    const ord = getOrderById(orderId);
    if (ord) await ctx.editMessageText(formatOrderCard(ord), { parse_mode: "Markdown" });
  });

  bot.action(/takeover_(.+)/, async (ctx) => {
    const phone = ctx.match[1];
    state.mutedContacts.add(phone);
    saveConfig();
    await ctx.answerCbQuery(`${phone}-এর জন্য AI Mute করা হয়েছে!`);
    ctx.reply(`👤 *Takeover Mode Activated!*\n${phone} এর জন্য AI রিপ্লাই বন্ধ করা হয়েছে। আপনি ম্যানুয়ালি চ্যাট করুন।\nশেষ হলে \`/resume ${phone}\` লিখুন।`, { parse_mode: "Markdown" });
  });

  // ============================================================
  // Text Message Listener for Interactive Admin Inputs
  // ============================================================
  bot.on("text", requireAdmin, async (ctx) => {
    const prompt = state.activeAdminPrompts.get(ctx.chat.id);
    if (!prompt) return;

    const input = ctx.message.text.trim();

    // Personal Mode Inputs
    if (prompt.step === "personal_owner_name") {
      state.ownerName = input;
      saveConfig();
      clearAllHistory();
      state.activeAdminPrompts.delete(ctx.chat.id);
      ctx.reply(`✅ মালিকের নাম সেট হয়েছে: *${input}*`, { parse_mode: "Markdown" });
      return renderDashboard(ctx);
    }

    if (prompt.step === "personal_bio") {
      state.personal.bio = input;
      saveConfig();
      clearAllHistory();
      state.activeAdminPrompts.delete(ctx.chat.id);
      ctx.reply(`✅ আমার পরিচয় (Bio) আপডেট হয়েছে:\n"${input}"`);
      return renderDashboard(ctx);
    }

    if (prompt.step === "personal_tone") {
      state.personal.tone = input;
      saveConfig();
      clearAllHistory();
      state.activeAdminPrompts.delete(ctx.chat.id);
      ctx.reply(`✅ Personal AI টোন সেট হয়েছে:\n"${input}"`);
      return renderDashboard(ctx);
    }

    if (prompt.step === "personal_instruction") {
      state.personal.instruction = input;
      saveConfig();
      clearAllHistory();
      state.activeAdminPrompts.delete(ctx.chat.id);
      ctx.reply(`✅ Personal AI-এর জন্য আপনার নতুন নির্দেশ সেভ হয়েছে!`);
      return renderDashboard(ctx);
    }

    // Business Mode Inputs
    if (prompt.step === "business_shop_name") {
      state.business.shopName = input;
      saveConfig();
      clearAllHistory();
      state.activeAdminPrompts.delete(ctx.chat.id);
      ctx.reply(`✅ দোকানের নাম সেট হয়েছে: *${input}*`, { parse_mode: "Markdown" });
      return renderDashboard(ctx);
    }

    if (prompt.step === "delivery_charges") {
      const parts = input.split(",").map((s) => parseInt(s.trim(), 10));
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        catalog.deliveryCharges = { insideDhaka: parts[0], outsideDhaka: parts[1] };
        saveCatalog();
        clearAllHistory();
        state.activeAdminPrompts.delete(ctx.chat.id);
        ctx.reply(`✅ ডেলিভারি চার্জ আপডেট হয়েছে: ঢাকা ৳${parts[0]} | ঢাকার বাইরে ৳${parts[1]}`);
        return renderDashboard(ctx);
      } else {
        return ctx.reply("❌ ফরম্যাট সঠিক হয়নি। উদাহরণ: 80, 130");
      }
    }

    if (prompt.step === "business_tone") {
      state.business.tone = input;
      saveConfig();
      clearAllHistory();
      state.activeAdminPrompts.delete(ctx.chat.id);
      ctx.reply(`✅ সেলস টোন সেট হয়েছে:\n"${input}"`);
      return renderDashboard(ctx);
    }

    if (prompt.step === "business_instruction") {
      state.business.instruction = input;
      saveConfig();
      clearAllHistory();
      state.activeAdminPrompts.delete(ctx.chat.id);
      ctx.reply(`✅ সেলস গাইডলাইন ও নির্দেশ সেভ হয়েছে!`);
      return renderDashboard(ctx);
    }

    // Support Mode Inputs
    if (prompt.step === "support_org_name") {
      state.support.orgName = input;
      saveConfig();
      clearAllHistory();
      state.activeAdminPrompts.delete(ctx.chat.id);
      ctx.reply(`✅ প্রতিষ্ঠানের নাম সেট হয়েছে: *${input}*`, { parse_mode: "Markdown" });
      return renderDashboard(ctx);
    }

    if (prompt.step === "support_tone") {
      state.support.tone = input;
      saveConfig();
      clearAllHistory();
      state.activeAdminPrompts.delete(ctx.chat.id);
      ctx.reply(`✅ সাপোর্ট টোন সেট হয়েছে:\n"${input}"`);
      return renderDashboard(ctx);
    }

    if (prompt.step === "support_instruction") {
      state.support.instruction = input;
      saveConfig();
      clearAllHistory();
      state.activeAdminPrompts.delete(ctx.chat.id);
      ctx.reply(`✅ সাপোর্ট পলিসি ও এফএকিউ নির্দেশ সেভ হয়েছে!`);
      return renderDashboard(ctx);
    }

    // Add Product Format
    if (prompt.step === "add_product_format") {
      try {
        const lines = input.split("\n");
        const prod = {
          id: "PROD-" + Math.floor(10 + Math.random() * 90),
          name: "",
          price: 0,
          sizes: ["Standard"],
          colors: ["Default"],
          description: "",
        };

        for (const line of lines) {
          if (line.startsWith("নাম:")) prod.name = line.replace("নাম:", "").trim();
          if (line.startsWith("দাম:")) prod.price = parseInt(line.replace("দাম:", "").trim(), 10) || 0;
          if (line.startsWith("সাইজ:")) prod.sizes = line.replace("সাইজ:", "").split(",").map((s) => s.trim());
          if (line.startsWith("কালার:")) prod.colors = line.replace("কালার:", "").split(",").map((c) => c.trim());
          if (line.startsWith("বিবরণ:")) prod.description = line.replace("বিবরণ:", "").trim();
        }

        if (!prod.name) {
          return ctx.reply("❌ প্রোডাক্টের নাম পাওয়া যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।");
        }

        if (!catalog.products) catalog.products = [];
        catalog.products.push(prod);
        saveCatalog();
        clearAllHistory();
        state.activeAdminPrompts.delete(ctx.chat.id);

        ctx.reply(`✅ নতুন প্রোডাক্ট *${prod.name}* (৳${prod.price}) সফলভাবে ক্যাটালগে যুক্ত হয়েছে!`, { parse_mode: "Markdown" });
        return renderDashboard(ctx);
      } catch (err) {
        ctx.reply("❌ ফরম্যাটে কোনো ত্রুটি ছিল। আবার চেষ্টা করুন।");
      }
    }
  });

  bot.command("resume", requireAdmin, (ctx) => {
    const phone = ctx.message.text.replace("/resume", "").trim().replace("+", "");
    if (!phone) return ctx.reply("ব্যবহার: `/resume 88017XXXXXXXX`", { parse_mode: "Markdown" });
    state.mutedContacts.delete(phone);
    saveConfig();
    ctx.reply(`▶️ *${phone}*-এর জন্য AI পুনরায় চালু করা হয়েছে।`, { parse_mode: "Markdown" });
  });
}

// Order Alert Notification
export async function sendOrderAlert(order) {
  if (!bot) return;
  try {
    const card = formatOrderCard(order);
    const buttons = Markup.inlineKeyboard([
      [
        Markup.button.callback("✅ Confirm Order", `order_confirm_${order.id}`),
        Markup.button.callback("❌ Cancel Order", `order_cancel_${order.id}`),
      ],
      [Markup.button.callback("👤 Takeover / Pause AI", `takeover_${order.customerPhone}`)],
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
      console.log("✅ Telegram commercial dashboard connected!");
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
