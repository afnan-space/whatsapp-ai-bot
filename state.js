// ============================================================
// state.js - Shared Bot State with Persona, Catalog & Persistence
// ============================================================
import fs from "fs";

const CONFIG_FILE = "./bot_config.json";
const CATALOG_FILE = "./catalog.json";

function loadCatalog() {
  try {
    if (fs.existsSync(CATALOG_FILE)) {
      return JSON.parse(fs.readFileSync(CATALOG_FILE, "utf-8"));
    }
  } catch (err) {
    console.error("Catalog load error:", err.message);
  }
  return { products: [], deliveryCharges: { insideDhaka: 80, outsideDhaka: 130 } };
}

export const catalog = loadCatalog();

const defaultSettings = {
  isOn: true,
  ownerName: "Mamun",
  shopName: "Urban Style BD",
  ownerBio: "ব্যস্ত মানুষ, প্রযুক্তি ও বিজনেস প্রিয়।",
  speakingTone: "friendly, professional, helpful sales assistant in natural conversational Bengali/Banglish",
  replyInGroups: false,
  whitelist: [],
  groupWhitelist: [],
  mutedContacts: [], // Contacts where AI is paused by admin
  maxDailyRepliesPerUser: 15,
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
      return { ...defaultSettings, ...data };
    }
  } catch (e) {
    console.error("Config load error:", e.message);
  }
  return { ...defaultSettings };
}

const saved = loadConfig();

export const state = {
  isOn: saved.isOn,
  ownerName: saved.ownerName,
  shopName: saved.shopName,
  ownerBio: saved.ownerBio,
  speakingTone: saved.speakingTone,
  whitelist: new Set(saved.whitelist || []),
  groupWhitelist: new Set(saved.groupWhitelist || []),
  mutedContacts: new Set(saved.mutedContacts || []),
  maxDailyRepliesPerUser: saved.maxDailyRepliesPerUser || 15,
  replyInGroups: saved.replyInGroups,
  dailyReplyCounts: new Map(), // contactId -> { count, date }
  logs: [],
  sock: null,
  isWhatsAppConnected: false,
  latestQR: null,
};

export function saveConfig() {
  try {
    const data = {
      isOn: state.isOn,
      ownerName: state.ownerName,
      shopName: state.shopName,
      ownerBio: state.ownerBio,
      speakingTone: state.speakingTone,
      whitelist: [...state.whitelist],
      groupWhitelist: [...state.groupWhitelist],
      mutedContacts: [...state.mutedContacts],
      maxDailyRepliesPerUser: state.maxDailyRepliesPerUser,
      replyInGroups: state.replyInGroups,
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.error("Config save error:", e.message);
  }
}

export function canReplyToContact(contactId) {
  if (state.mutedContacts.has(contactId)) {
    return { allowed: false, reason: "muted_by_admin" };
  }

  const today = new Date().toDateString();
  const userStats = state.dailyReplyCounts.get(contactId) || { count: 0, date: today };

  if (userStats.date !== today) {
    userStats.count = 0;
    userStats.date = today;
  }

  if (userStats.count >= state.maxDailyRepliesPerUser) {
    return { allowed: false, reason: "limit_reached" };
  }

  userStats.count++;
  state.dailyReplyCounts.set(contactId, userStats);
  return { allowed: true, count: userStats.count };
}

export function getFullSystemPrompt() {
  const productsSummary = (catalog.products || [])
    .map(
      (p) =>
        `- ID: ${p.id} | ${p.name} | দাম: ৳${p.price} | সাইজ: ${(p.sizes || []).join(", ")} | কালার: ${(p.colors || []).join(", ")} | বিবরণ: ${p.description}`
    )
    .join("\n");

  return `
[ROLE & PERSONA]
তুমি "${state.shopName}"-এর অভিজ্ঞ, বিনয়ী ও উদ্যমী সেলস অ্যাসিস্ট্যান্ট (Virtual AI Assistant)।
মালিক: ${state.ownerName}
টোন: ${state.speakingTone}

[PRODUCT CATALOG & PRICING]
আমাদের দোকানে নিচের প্রোডাক্টগুলো পাওয়া যায়:
${productsSummary}

ডেলিভারি চার্জ:
- ঢাকার ভেতরে: ৳${catalog.deliveryCharges?.insideDhaka || 80}
- ঢাকার বাইরে: ৳${catalog.deliveryCharges?.outsideDhaka || 130}

[ORDER COLLECTION FLOW - অত্যন্ত গুরুত্বপূর্ণ]
যখনই কোনো কাস্টমার কোনো প্রোডাক্ট কিনতে আগ্রহী হবে বা অর্ডার করতে চাইবে:
১. প্রোডাক্টের নাম, সাইজ, কালার ও কয় পিস লাগবে তা নিশ্চিত করো।
২. এরপর ডেলিভারির জন্য তার:
   - পুরো নাম
   - মোবাইল নম্বর (১১ ডিজিটের ভ্যালিড ফোন নম্বর)
   - সম্পূর্ণ ঠিকানা (বাসা/রোড নম্বর, এলাকা ও জেলা)
   - পেমেন্ট পদ্ধতি (Cash on Delivery নাকি bKash)
   ধাপে ধাপে বা সুন্দরভাবে চেয়ে নাও।
৩. যখন কাস্টমার তার নাম, ফোন নম্বর, ঠিকানা এবং প্রোডাক্ট কনফার্ম করবে, তখন তোমার রিপ্লাইয়ের একদম শেষে এই স্পেশাল ফরম্যাটে একটি লুকায়িত JSON ট্যাগ আউটপুট করবে:

<<<ORDER_CONFIRMED>>>
{
  "customerName": "কাস্টমারের নাম",
  "customerPhone": "ফোন নম্বর",
  "address": "সম্পূর্ণ ঠিকানা",
  "items": [
    { "name": "প্রোডাক্টের নাম", "size": "সাইজ", "color": "কালার", "quantity": 1, "price": 450 }
  ],
  "totalAmount": 530,
  "paymentMethod": "Cash on Delivery",
  "notes": "কোনো বিশেষ নির্দেশ থাকলে"
}
<<<END_ORDER>>>

[SAFETY & RESTRICTIONS]
- কোনো বড় কোডিং, অনুবাদ, কবিতা বা নিউজ বুলেটিনের অনুরোধ এলে বিনয়ের সাথে না করবে। বলবে তুমি শুধু "${state.shopName}"-এর শপিং ও অর্ডার সহায়তা করো।
- রিপ্লাই যথাসম্ভব ২-৪ বাক্যে সংক্ষিপ্ত ও আন্তরিক রাখবে।
`.trim();
}

export function addLog(entry) {
  state.logs.unshift({
    time: new Date().toLocaleString("en-BD", { timeZone: "Asia/Dhaka" }),
    ...entry,
  });
  if (state.logs.length > 50) state.logs.pop();
}
