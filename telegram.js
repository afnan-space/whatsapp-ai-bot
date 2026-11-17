// ============================================================
// telegram.js - Telegram Control Panel with Persona & Rules commands
// ============================================================
import { Telegraf } from "telegraf";
import { state, addLog, saveConfig, getFullSystemPrompt } from "./state.js";
import { clearAllHistory } from "./gemini.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = String(process.env.TELEGRAM_ADMIN_CHAT_ID);

let bot = null;
if (token) {
  bot = new Telegraf(token, {
    handlerTimeout: 90000,
  });
}

// ---- Admin Guard ----
function requireAdmin(ctx, next) {
  if (String(ctx.chat.id) !== ADMIN_ID) return;
  return next();
}

// ============================================================
// Commands
// ============================================================
if (bot) {
  bot.start(requireAdmin, (ctx) => ctx.reply(
`🤖 *WhatsApp AI Bot — Control Panel*

*🎛️ Bot Control:*
/on — AI reply চালু
/off — AI reply বন্ধ
/status — বর্তমান অবস্থা ও সেটিংস দেখো

*👤 Persona & Owner Details:*
/setowner [নাম] — তোমার নাম সেট করো
/setbio [তোমার সম্পর্কে] — তোমার পরিচয় ও কাজের বিবরণ
/settone [ধরণ] — কথা বলার স্টাইল (যেমন: friendly, formal, funny)
/setrules [নিয়মাবলী] — AI কোন কোন কাজ করবে বা করবে না

*🧹 Memory & Cache:*
/clearmemory — চ্যাট হিস্ট্রি মুছে নতুন করে শুরু

*👥 Contacts & Groups:*
/whitelist add 880xxx — শুধু নির্দিষ্ট নম্বরে রিপ্লাই
/whitelist clear — সবাইকে রিপ্লাই
/groupon / /groupoff — গ্রুপে রিপ্লাই অন/অফ

*📨 Logs & Manual Send:*
/logs — সাম্প্রতিক মেসেজ
/send [number] [message] — WhatsApp-এ মেসেজ পাঠাও`,
{ parse_mode: "Markdown" }
  ));

  // /on
  bot.command("on", requireAdmin, (ctx) => {
    state.isOn = true;
    saveConfig();
    ctx.reply("✅ Bot চালু! এখন থেকে Gemini AI reply করবে।");
  });

  // /off
  bot.command("off", requireAdmin, (ctx) => {
    state.isOn = false;
    saveConfig();
    ctx.reply("🔴 Bot বন্ধ। কোনো auto-reply হবে না।");
  });

  // /status
  bot.command("status", requireAdmin, (ctx) => {
    ctx.reply(
      `📊 *Bot Status*\n\n` +
      `🤖 AI Reply: ${state.isOn ? "✅ চালু" : "🔴 বন্ধ"}\n` +
      `👤 Owner: *${state.ownerName}*\n` +
      `ℹ️ Bio: _${state.ownerBio}_\n` +
      `🎭 Tone: _${state.speakingTone}_\n` +
      `👥 Group Reply: ${state.replyInGroups ? "✅ চালু" : "🔴 বন্ধ"}\n` +
      `📋 Whitelist: ${state.whitelist.size === 0 ? "সবাই" : state.whitelist.size + " জন"}\n` +
      `📨 Logs: ${state.logs.length} টি\n\n` +
      `📜 *Active Rules:*\n\`\`\`\n${state.customRules}\n\`\`\``,
      { parse_mode: "Markdown" }
    );
  });

  // /setowner
  bot.command("setowner", requireAdmin, (ctx) => {
    const name = ctx.message.text.replace("/setowner", "").trim();
    if (!name) return ctx.reply("ব্যবহার: `/setowner মামুন`", { parse_mode: "Markdown" });
    state.ownerName = name;
    saveConfig();
    clearAllHistory();
    ctx.reply(`✅ Owner নাম সেট হয়েছে: *${name}*`, { parse_mode: "Markdown" });
  });

  // /setbio
  bot.command("setbio", requireAdmin, (ctx) => {
    const bio = ctx.message.text.replace("/setbio", "").trim();
    if (!bio) return ctx.reply("ব্যবহার: `/setbio আমি সফটওয়্যার ডেভেলপার, ব্যস্ত থাকি। কোনো জরুরি কথা থাকলে লিখে রাখুন।`", { parse_mode: "Markdown" });
    state.ownerBio = bio;
    saveConfig();
    clearAllHistory();
    ctx.reply(`✅ তোমার Bio আপডেট হয়েছে:\n"${bio}"`);
  });

  // /settone
  bot.command("settone", requireAdmin, (ctx) => {
    const tone = ctx.message.text.replace("/settone", "").trim();
    if (!tone) return ctx.reply("ব্যবহার: `/settone খুব ফ্রেন্ডলি এবং সংক্ষেপে বাংলিশে কথা বলবে`", { parse_mode: "Markdown" });
    state.speakingTone = tone;
    saveConfig();
    clearAllHistory();
    ctx.reply(`✅ Speaking Tone আপডেট হয়েছে:\n"${tone}"`);
  });

  // /setrules
  bot.command("setrules", requireAdmin, (ctx) => {
    const rules = ctx.message.text.replace("/setrules", "").trim();
    if (!rules) {
      return ctx.reply(
        `বর্তমান রুলস:\n\`\`\`\n${state.customRules}\n\`\`\`\n\nনতুন রুলস দিতে:\n/setrules [তোমার নতুন নিয়মের লিস্ট]`,
        { parse_mode: "Markdown" }
      );
    }
    state.customRules = rules;
    saveConfig();
    clearAllHistory();
    ctx.reply(`✅ নতুন Rules সেট হয়েছে!\n\nসব চ্যাট হিস্ট্রি রিসেট করা হয়েছে।`);
  });

  // /clearmemory
  bot.command("clearmemory", requireAdmin, (ctx) => {
    clearAllHistory();
    ctx.reply("🧹 সব চ্যাট হিস্ট্রি মুছে ফেলা হয়েছে!");
  });

  // /whitelist
  bot.command("whitelist", requireAdmin, (ctx) => {
    const args = ctx.message.text.split(" ").slice(1);
    const [action, number] = args;

    if (!action || action === "list") {
      return ctx.reply(state.whitelist.size === 0
        ? "📋 Whitelist খালি — সবাইকে reply করছে।"
        : `📋 Whitelist:\n${[...state.whitelist].join("\n")}`);
    }
    if (action === "add" && number) {
      state.whitelist.add(number);
      saveConfig();
      return ctx.reply(`✅ ${number} যোগ হয়েছে।`);
    }
    if (action === "remove" && number) {
      state.whitelist.delete(number);
      saveConfig();
      return ctx.reply(`✅ ${number} সরানো হয়েছে।`);
    }
    if (action === "clear") {
      state.whitelist.clear();
      saveConfig();
      return ctx.reply("✅ Whitelist খালি — সবাইকে reply করবে।");
    }
    ctx.reply("❓ /whitelist add/remove/clear [number]");
  });

  // /groupon /groupoff
  bot.command("groupon", requireAdmin, (ctx) => { 
    state.replyInGroups = true; 
    saveConfig(); 
    ctx.reply("✅ Group reply চালু!"); 
  });
  bot.command("groupoff", requireAdmin, (ctx) => { 
    state.replyInGroups = false; 
    saveConfig(); 
    ctx.reply("🔴 Group reply বন্ধ।"); 
  });

  // /send
  bot.command("send", requireAdmin, async (ctx) => {
    const parts = ctx.message.text.split(" ");
    const number = parts[1];
    const message = parts.slice(2).join(" ");

    if (!number || !message) return ctx.reply("❓ /send 880xxxxxxxxxx তোমার message");
    if (!state.sock) return ctx.reply("❌ WhatsApp এখনো connect হয়নি!");

    try {
      const jid = number.includes("@") ? number : `${number}@s.whatsapp.net`;
      await state.sock.sendMessage(jid, { text: message });
      ctx.reply(`✅ পাঠানো হয়েছে → ${number}\n💬 "${message}"`);
    } catch (err) {
      ctx.reply(`❌ Error: ${err.message}`);
    }
  });

  // /logs
  bot.command("logs", requireAdmin, (ctx) => {
    if (state.logs.length === 0) return ctx.reply("📭 এখনো কোনো মেসেজ নেই।");
    const text = state.logs.slice(0, 8).map(l =>
      `🕐 ${l.time}\n👤 ${l.from}\n💬 ${l.message?.substring(0, 60) || "[image]"}\n🤖 ${l.reply?.substring(0, 60) || ""}...`
    ).join("\n\n—\n\n");
    ctx.reply(`📋 *সাম্প্রতিক মেসেজ:*\n\n${text}`, { parse_mode: "Markdown" });
  });
}

// ---- Helper: Admin কে notify করো ----
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

// ---- Admin কে image পাঠাও ----
export async function sendPhotoToAdmin(source, caption) {
  if (!bot) return;
  try {
    await bot.telegram.sendPhoto(ADMIN_ID, { source }, { caption });
  } catch (err) {
    console.error("Telegram photo error:", err.message);
  }
}

export function startTelegramBot() {
  if (!bot) {
    console.warn("⚠️ TELEGRAM_BOT_TOKEN not provided.");
    return;
  }
  bot.launch().then(() => {
    console.log("✅ Telegram bot started!");
  }).catch((err) => {
    console.error("⚠️ Telegram bot launch failed (retrying in background):", err.message);
  });

  process.once("SIGINT",  () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

export default bot;
