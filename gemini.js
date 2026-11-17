// ============================================================
// gemini.js - Gemini AI (Text + Image Vision) with Working Models
// ============================================================
import { GoogleGenerativeAI } from "@google/generative-ai";

// Working model list based on API testing
const MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-flash-lite",
  "gemini-3.8-flash"
];

const chatHistories = new Map();

function getClient() {
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

// Retry with fallback models
async function tryWithFallback(fn) {
  let lastErr = null;
  for (const modelName of MODELS) {
    try {
      return await fn(modelName);
    } catch (err) {
      lastErr = err;
      const is503 = err.message?.includes("503") || err.message?.includes("Service Unavailable");
      const is404 = err.message?.includes("404") || err.message?.includes("not found");
      if (is503 || is404) {
        console.warn(`⚠️ Model ${modelName} unavailable (${err.message.slice(0, 80)}...), trying next...`);
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error("সব Gemini model এ সমস্যা হচ্ছে। একটু পরে আবার চেষ্টা করো।");
}

// ---- Text Reply ----
export async function getGeminiReply(contactId, userMessage, systemPrompt) {
  if (!chatHistories.has(contactId)) chatHistories.set(contactId, []);
  const history = chatHistories.get(contactId);

  const reply = await tryWithFallback(async (modelName) => {
    const model = getClient().getGenerativeModel({
      model: modelName,
      systemInstruction: systemPrompt,
    });
    const chat = model.startChat({
      history,
      generationConfig: { maxOutputTokens: 500, temperature: 0.9 },
    });
    const result = await chat.sendMessage(userMessage);
    return result.response.text();
  });

  history.push({ role: "user", parts: [{ text: userMessage }] });
  history.push({ role: "model", parts: [{ text: reply }] });
  if (history.length > 40) chatHistories.set(contactId, history.slice(-20));

  return reply;
}

// ---- Image Analysis ----
export async function getGeminiImageReply(contactId, imageBuffer, mimeType, caption, systemPrompt) {
  const imagePart = {
    inlineData: {
      data: imageBuffer.toString("base64"),
      mimeType: mimeType || "image/jpeg",
    },
  };

  const prompt = caption
    ? `${systemPrompt}\n\nUser sent an image with caption: "${caption}". Describe what you see and respond to the caption.`
    : `${systemPrompt}\n\nUser sent an image. Describe what you see in a helpful way.`;

  return await tryWithFallback(async (modelName) => {
    const model = getClient().getGenerativeModel({ model: modelName });
    const result = await model.generateContent([prompt, imagePart]);
    return result.response.text();
  });
}

export function clearHistory(contactId) { chatHistories.delete(contactId); }
export function clearAllHistory() { chatHistories.clear(); }
