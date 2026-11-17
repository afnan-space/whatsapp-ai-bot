// ============================================================
// state.js - Shared Bot State with Persona & Rules Persistence
// ============================================================
import fs from "fs";
import path from "path";

const CONFIG_FILE = "./bot_config.json";

const defaultSettings = {
  isOn: true,
  ownerName: "Mamun",
  ownerBio: "ব্যস্ত মানুষ, প্রযুক্তিপ্রেমী। প্রয়োজন হলে হোয়াটসঅ্যাপে সংক্ষেপে মেসেজ রেখে দিতে পারেন।",
  speakingTone: "friendly, natural, short and humble conversational Bengali/Banglish",
  replyInGroups: false,
  whitelist: [],
  groupWhitelist: [],
  customRules: `
- তুমি WhatsApp ব্যবহারকারী মালিকের ব্যক্তিগত ভার্চুয়াল অ্যাসিস্ট্যান্ট (সে নিজে নও, তার সহকারী বা বন্ধুসুলভ বট)।
- সবসময় সংক্ষিপ্ত, স্বাভাবিক এবং আন্তরিক ভাষায় উত্তর দেবে (বাংলা/বাংলিশ মিলিয়ে যেভাবে ইউজার কথা বলে)।
- গুরুত্বপূর্ণ নিয়ম: তুমি কোনো ভারী বা বড় টাস্ক সম্পাদন করতে পারবে না (যেমন: কোডিং করা, লম্বা প্রবন্ধ/নিবন্ধ লেখা, নিউজ বুলেটিন বা কারেন্ট নিউজ দেওয়া, জটিল রিসার্চ ইত্যাদি)।
- ইউজার যদি এমন কোনো বড় টাস্ক বা কাজের নির্দেশ দেয় (যেমন: "আজকের নিউজ দাও", "আমাকে একটা ওয়েবসাইট বানিয়ে দাও", "একটা রচনা লিখে দাও"), তুমি বিনয়ের সাথে হাসিমুখে এবং বন্ধুত্বপূর্ণভাবে না করবে।
  যেমন: "আরে ভাই, আমি তো এত বড় কাজ বা লাইভ নিউজ দিতে পারি না! 😅 মামুন ভাইয়ের হয়ে টুকটাক চ্যাট আর মেসেজ নেওয়া-দেওয়া করি। দরকারি কিছু থাকলে মেসেজ দিয়ে রাখুন, উনি ফ্রি হয়ে দেখে নেবেন।"
`.trim(),
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
  ownerBio: saved.ownerBio,
  speakingTone: saved.speakingTone,
  customRules: saved.customRules,
  whitelist: new Set(saved.whitelist || []),
  groupWhitelist: new Set(saved.groupWhitelist || []),
  replyInGroups: saved.replyInGroups,
  logs: [],
  sock: null,
};

export function saveConfig() {
  try {
    const data = {
      isOn: state.isOn,
      ownerName: state.ownerName,
      ownerBio: state.ownerBio,
      speakingTone: state.speakingTone,
      customRules: state.customRules,
      whitelist: [...state.whitelist],
      groupWhitelist: [...state.groupWhitelist],
      replyInGroups: state.replyInGroups,
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.error("Config save error:", e.message);
  }
}

export function getFullSystemPrompt() {
  return `
[ROLE & PERSONA]
তুমি ${state.ownerName}-এর ব্যক্তিগত WhatsApp অ্যাসিস্ট্যান্ট।
${state.ownerName} সম্পর্কে তথ্য: ${state.ownerBio}
কথোপকথনের ধরণ (Tone): ${state.speakingTone}

[CORE RULES & RESTRICTIONS]
${state.customRules}

[SAFETY & LIMITS]
- মেসেজ খুব বড় করে লিখবে না (সর্বোচ্চ ২-৩ লাইনে শেষ করবে)।
- সবসময় মনে রাখবে তুমি সাধারণ WhatsApp চ্যাটে আছো।
`.trim();
}

export function addLog(entry) {
  state.logs.unshift({
    time: new Date().toLocaleString("en-BD", { timeZone: "Asia/Dhaka" }),
    ...entry,
  });
  if (state.logs.length > 50) state.logs.pop();
}
