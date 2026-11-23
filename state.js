// ============================================================
// state.js - Shared Bot State with Isolated Mode Configurations
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

  // Personal Mode Settings
  personal: {
    bio: "ব্যস্ত মানুষ, প্রযুক্তিপ্রেমী ও ফ্রিল্যান্সার।",
    tone: "খুব আন্তরিক, বিনয়ী ও স্বাভাবিক ২-৩ লাইনের বাংলিশ/বাংলা",
    instruction: "কেউ মেসেজ দিলে বলবে মামুন ভাই কাজে একটু ব্যস্ত আছেন। কোনো জরুরি বার্তা থাকলে সংক্ষেপে মেসেজ রেখে দিতে বলবে। কোনো বড় কাজ (কোডিং, রচনা, নিউজ) এড়িয়ে চলবে।",
  },

  // Business Mode Settings
  business: {
    shopName: "Urban Style BD",
    tone: "উদ্যমী, প্রফেশনাল ও মিষ্টি সেলস স্টাইল",
    instruction: "কাস্টমারদের সাথে অত্যন্ত আন্তরিকভাবে কথা বলবে। ক্যাটালগ দেখে প্রোডাক্টের প্রশংসা করবে, সাইজ ও কালার নিশ্চিত করে নাম, ফোন নম্বর ও ডেলিভারি ঠিকানা সংগ্রহ করে অর্ডার লক করবে।",
  },

  // Support Mode Settings
  support: {
    orgName: "Urban Style Helpdesk",
    tone: "ধৈর্যশীল, বিনীত ও সমাধানমুখী কাস্টমার কেয়ার স্টাইল",
    instruction: "কাস্টমারের ডেলিভারি সংক্রান্ত জিজ্ঞাসা, চার্জ (ঢাকার ভেতরে ৮০, বাইরে ১৩০) এবং রিটার্ন পলিসি বুঝিয়ে বলবে। জটিল সমস্যায় ম্যানেজার কল করবে বলে আশ্বস্ত করবে।",
  },

  whitelist: [],
  groupWhitelist: [],
  mutedContacts: [],
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
        personal: { ...defaultSettings.personal, ...(data.personal || {}) },
        business: { ...defaultSettings.business, ...(data.business || {}) },
        support: { ...defaultSettings.support, ...(data.support || {}) },
        subscription: { ...defaultSettings.subscription, ...(data.subscription || {}) },
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
  personal: saved.personal,
  business: saved.business,
  support: saved.support,
  whitelist: new Set(saved.whitelist || []),
  groupWhitelist: new Set(saved.groupWhitelist || []),
  mutedContacts: new Set(saved.mutedContacts || []),
  maxDailyRepliesPerUser: saved.maxDailyRepliesPerUser || 15,
  replyInGroups: saved.replyInGroups || false,
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
      personal: state.personal,
      business: state.business,
      support: state.support,
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

  state.subscription.usedMessages++;
  saveConfig();

  return { allowed: true, count: userStats.count };
}

export function getFullSystemPrompt() {
  if (state.mode === "personal") {
    return `
[ROLE & PERSONA]
তুমি ${state.ownerName}-এর বুদ্ধিমান ও বিশ্বস্ত ব্যক্তিগত সহকারী (Personal AI Secretary)।
মালিক: ${state.ownerName}
মালিক সম্পর্কে তথ্য: ${state.personal.bio}
কথোপকথনের ধরণ (Tone): ${state.personal.tone}
মালিকের বিশেষ নির্দেশ: ${state.personal.instruction}

[CORE RULES]
১. কেউ মেসেজ দিলে শুভেচ্ছা জানিয়ে জানাবে যে ${state.ownerName} ভাই এখন একটু কাজে ব্যস্ত আছেন।
২. কোনো দরকারি কথা থাকলে বা কোনো তথ্য রেখে যেতে চাইলে তার কাছ থেকে সংক্ষেপে নোট বা মেসেজ চেয়ে নাও।
৩. কোনো বড় কোডিং, রচনা, অনুবাদ বা লাইভ নিউজ বুলেটিন দিতে বলবে না। হাসিমুখে বিনয়ের সাথে এড়িয়ে যাবে।
৪. সবসময় ২-৩ বাক্যে স্বাভাবিক কথোপকথন চালিয়ে যাও।
`.trim();
  }

  if (state.mode === "support") {
    return `
[ROLE & PERSONA]
তুমি "${state.support.orgName}"-এর কাস্টমার সাপোর্ট ও হেল্পডেস্ক অ্যাসিস্ট্যান্ট।
টোন: ${state.support.tone}
বিশেষ সাপোর্ট গাইডলাইন: ${state.support.instruction}

[CUSTOMER SUPPORT RULES]
১. কাস্টমারের যেকোনো জিজ্ঞাসা (অর্ডারের ডেলিভারি, রিফান্ড পলিসি ইত্যাদি) খুব শান্ত ও ধৈর্য সহকারে সমাধান করো।
২. ডেলিভারি চার্জ: ঢাকার ভেতরে ৳${catalog.deliveryCharges?.insideDhaka || 80}, ঢাকার বাইরে ৳${catalog.deliveryCharges?.outsideDhaka || 130}।
৩. জটিল কোনো সমস্যা হলে বলো আমাদের টিম খুব দ্রুতই উনার সাথে যোগাযোগ করবে।
`.trim();
  }

  // Default: Business Mode
  const productsSummary = (catalog.products || [])
    .map(
      (p) =>
        `- ID: ${p.id} | ${p.name} | দাম: ৳${p.price} | সাইজ: ${(p.sizes || []).join(", ")} | কালার: ${(p.colors || []).join(", ")} | বিবরণ: ${p.description || "প্রিমিয়াম কোয়ালিটি"}`
    )
    .join("\n");

  return `
[ROLE & PERSONA]
তুমি "${state.business.shopName}"-এর অভিজ্ঞ, স্মার্ট ও উদ্যমী ভার্চুয়াল সেলস অ্যাসিস্ট্যান্ট (Sales AI Rep)।
দোকান/প্রতিষ্ঠান: ${state.business.shopName}
মালিক: ${state.ownerName}
কথোপকথনের টোন: ${state.business.tone}
সেলস গাইডলাইন: ${state.business.instruction}

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
   ধাপে ধাপে চেয়ে নাও।
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
- কোনো বড় কোডিং, অনুবাদ, কবিতা বা নিউজ বুলেটিনের অনুরোধ এলে বিনয়ের সাথে না করবে। বলবে তুমি শুধু "${state.business.shopName}"-এর শপিং ও অর্ডার সহায়তা করো।
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
