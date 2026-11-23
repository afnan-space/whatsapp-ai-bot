// ============================================================
// state.js - Shared Bot State with Persona, Modes, Subscription & Catalog
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

export function saveCatalog() {
  try {
    fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2), "utf-8");
  } catch (err) {
    console.error("Catalog save error:", err.message);
  }
}

const defaultSettings = {
  isOn: true,
  mode: "business", // "business" | "personal" | "support"
  ownerName: "Mamun",
  shopName: "Urban Style BD",
  ownerBio: "ব্যস্ত মানুষ, প্রযুক্তি ও বিজনেস প্রিয়।",
  speakingTone: "friendly, professional, natural and concise in Bengali/Banglish",
  customInstruction: "কাস্টমারদের সাথে অত্যন্ত আন্তরিকভাবে কথা বলবে। অপ্রয়োজনীয় বড় টেক্সট লিখবে না।",
  replyInGroups: false,
  whitelist: [],
  groupWhitelist: [],
  mutedContacts: [], // Contacts where AI is paused by admin
  maxDailyRepliesPerUser: 15,
  subscription: {
    plan: "Free Trial",
    usedMessages: 0,
    totalMessages: 500,
    expiresAt: "2027-12-31",
  },
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
      return { 
        ...defaultSettings, 
        ...data,
        subscription: { ...defaultSettings.subscription, ...(data.subscription || {}) }
      };
    }
  } catch (e) {
    console.error("Config load error:", e.message);
  }
  return { ...defaultSettings };
}

const saved = loadConfig();

export const state = {
  isOn: saved.isOn,
  mode: saved.mode || "business",
  ownerName: saved.ownerName,
  shopName: saved.shopName,
  ownerBio: saved.ownerBio,
  speakingTone: saved.speakingTone,
  customInstruction: saved.customInstruction,
  whitelist: new Set(saved.whitelist || []),
  groupWhitelist: new Set(saved.groupWhitelist || []),
  mutedContacts: new Set(saved.mutedContacts || []),
  maxDailyRepliesPerUser: saved.maxDailyRepliesPerUser || 15,
  replyInGroups: saved.replyInGroups,
  subscription: saved.subscription,
  dailyReplyCounts: new Map(), // contactId -> { count, date }
  logs: [],
  sock: null,
  isWhatsAppConnected: false,
  latestQR: null,
  activeAdminPrompts: new Map(), // adminId -> { step, data }
};

export function saveConfig() {
  try {
    const data = {
      isOn: state.isOn,
      mode: state.mode,
      ownerName: state.ownerName,
      shopName: state.shopName,
      ownerBio: state.ownerBio,
      speakingTone: state.speakingTone,
      customInstruction: state.customInstruction,
      whitelist: [...state.whitelist],
      groupWhitelist: [...state.groupWhitelist],
      mutedContacts: [...state.mutedContacts],
      maxDailyRepliesPerUser: state.maxDailyRepliesPerUser,
      replyInGroups: state.replyInGroups,
      subscription: state.subscription,
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

  // Subscription check
  if (state.subscription.usedMessages >= state.subscription.totalMessages) {
    return { allowed: false, reason: "subscription_limit_exceeded" };
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

  // Increment subscription counter
  state.subscription.usedMessages++;
  saveConfig();

  return { allowed: true, count: userStats.count };
}

export function getFullSystemPrompt() {
  const productsSummary = (catalog.products || [])
    .map(
      (p) =>
        `- ID: ${p.id} | ${p.name} | দাম: ৳${p.price} | সাইজ: ${(p.sizes || []).join(", ")} | কালার: ${(p.colors || []).join(", ")} | বিবরণ: ${p.description || "প্রিমিয়াম কোয়ালিটি"}`
    )
    .join("\n");

  if (state.mode === "personal") {
    return `
[ROLE & PERSONA]
তুমি ${state.ownerName}-এর অত্যন্ত বিশ্বস্ত ও বুদ্ধিমান ব্যক্তিগত সহকারী (Personal AI Secretary)।
মালিক: ${state.ownerName}
মালিক সম্পর্কে তথ্য: ${state.ownerBio}
টোন: ${state.speakingTone}
বিশেষ নির্দেশাবলী: ${state.customInstruction}

[CORE RESPONSIBILITIES]
১. কেউ মেসেজ দিলে বিনীতভাবে শুভেচ্ছা জানিয়ে জানাও যে মামুন ভাই এখন একটু ব্যস্ত আছেন।
২. কোনো দরকারি কথা থাকলে বা কোনো তথ্য রেখে যেতে চাইলে তার কাছ থেকে সংক্ষেপে নোট বা মেসেজ চেয়ে নাও।
৩. কোনো জটিল কাজ, কোডিং, বড় রচনা, নিউজ বা অনুবাদ করতে বলবে না। বিনয়ের সাথে হাসিমুখে এড়িয়ে যাবে।
৪. সবসময় ২-৩ বাক্যে স্বাভাবিক বাংলিশ বা বাংলায় উত্তর দেবে।
`.trim();
  }

  if (state.mode === "support") {
    return `
[ROLE & PERSONA]
তুমি "${state.shopName}"-এর নিবেদিত কাস্টমার সাপোর্ট ও হেল্পডেস্ক অ্যাসিস্ট্যান্ট।
টোন: ${state.speakingTone}
বিশেষ নির্দেশাবলী: ${state.customInstruction}

[CUSTOMER SUPPORT GUIDELINES]
১. কাস্টমারের যেকোনো অভিযোগ বা সাধারণ জিজ্ঞাসার (ডেলিভারি কবে হবে, রিফান্ড পলিসি, ঠিকানা ইত্যাদি) অত্যন্ত ধৈর্য ও বিনয়ের সাথে উত্তর দেবে।
২. ডেলিভারি চার্জ: ঢাকার ভেতরে ৳${catalog.deliveryCharges?.insideDhaka || 80}, ঢাকার বাইরে ৳${catalog.deliveryCharges?.outsideDhaka || 130}।
৩. যদি কোনো জরুরি সমস্যা থাকে, কাস্টমারকে আশ্বস্ত করো এবং বলো ম্যানেজার বা সাপোর্ট টিম শীঘ্রই যোগাযোগ করবে।
`.trim();
  }

  // Default: Business Mode
  return `
[ROLE & PERSONA]
তুমি "${state.shopName}"-এর অভিজ্ঞ, স্মার্ট ও উদ্যমী সেলস অ্যাসিস্ট্যান্ট (Virtual AI Sales Rep)।
মালিক: ${state.ownerName}
টোন: ${state.speakingTone}
কাস্টম নির্দেশ: ${state.customInstruction}

[PRODUCT CATALOG & PRICING]
আমাদের দোকানে নিচের প্রোডাক্টগুলো পাওয়া যায়:
${productsSummary || "বর্তমানে ক্যাটালগ আপডেট হচ্ছে।"}

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
