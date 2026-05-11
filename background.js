const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url || !/^https?:\/\//.test(tab.url)) return;

  const delivered = await sendOpenMessage(tab.id);
  if (delivered) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["styles.css"]
    });
    await sendOpenMessage(tab.id);
  } catch (err) {
    console.error("Failed to inject script:", err);
  }
});

function sendOpenMessage(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "OPEN_UI" }, () => {
      if (chrome.runtime.lastError) resolve(false);
      else resolve(true);
    });
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ASK_GROQ_ACTION") {
    askGroqForAction(message.payload)
      .then((plan) => sendResponse({ ok: true, plan }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return true;
});

async function askGroqForAction(payload) {
  let { apiKey1, apiKey2, apiKey3, apiKey, selectedModel, currentApiKeyIndex } = await chrome.storage.sync.get([
    "apiKey1", "apiKey2", "apiKey3", "apiKey", "selectedModel", "currentApiKeyIndex"
  ]);

  const keys = [apiKey1, apiKey2, apiKey3].filter(k => !!k);
  if (keys.length === 0 && apiKey) keys.push(apiKey);
  if (keys.length === 0) throw new Error("API Key missing. Set it in options.");

  if (currentApiKeyIndex === undefined) currentApiKeyIndex = 0;
  if (currentApiKeyIndex >= keys.length) currentApiKeyIndex = 0;

  const model = selectedModel || DEFAULT_MODEL;

  const {
    task,
    questionText,
    choices = [],
    visibleText,
    pageTitle,
    userPrompt,
    history = [],
    answerOnly = false
  } = payload;

  let systemPrompt = "";
  if (answerOnly) {
    systemPrompt = `
      You are a concise Web Assistant.
      User Goal: ${userPrompt || "Explain this page."}

      RULES:
      1. Output ONLY valid JSON.
      2. Be direct and fact-based.
      3. Use provided page content.

      FORMAT:
      {
        "answer": "...",
        "reason": "..."
      }
    `;
  } else {
    systemPrompt = `
      You are a Web Pilot. Goal: ${userPrompt || "Complete tasks."}

      RULES:
      1. JSON output ONLY.
      2. Prioritize "NAV" tagged elements to progress (Next, Submit, etc.).
      3. "done" ONLY when goal is fully complete and no more navigation is possible.
      4. If stuck, try different elements or "scroll".
      5. "answer" field for user updates.

      ACTIONS: click, type(text), check, select(optionText), scroll(direction:up/down), hover, key(key), wait, refuse, done.

      FORMAT:
      {
        "action": "...",
        "targetId": "el_...",
        "text": "...",
        "reason": "...",
        "answer": "..."
      }
    `;
  }

  const userContent = `
    TITLE: ${pageTitle}
    PROMPT: ${userPrompt || questionText}

    OPTIONS:
    ${choices.length > 0 ? choices.map(c => `${c.choiceId}: ${c.text}`).join("\n") : "None."}

    HISTORY (last 5):
    ${history.length > 0 ? history.slice(-5).join("\n") : "None."}

    CONTENT:
    ${visibleText.slice(0, 15000)}
  `;

  let lastError = null;
  // Try available keys starting from current index
  for (let i = 0; i < keys.length; i++) {
    const attemptIndex = (currentApiKeyIndex + i) % keys.length;
    const currentKey = keys[attemptIndex];

    try {
      const resp = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${currentKey}`
      },
      body: JSON.stringify({
        model: model,
        temperature: 0,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent }
        ],
        response_format: { type: "json_object" }
      })
    });

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        const msg = errorData.error?.message || "Unknown error";
        // If rate limit or other temporary error, try next key
        if (resp.status === 429 || resp.status === 401 || resp.status === 402) {
          console.warn(`Key ${attemptIndex + 1} failed (${resp.status}): ${msg}. Trying next...`);
          lastError = new Error(`Groq error: ${resp.status} - ${msg}`);
          continue;
        }
        throw new Error(`Groq error: ${resp.status} - ${msg}`);
      }

      const data = await resp.json();
      try {
        const result = JSON.parse(data.choices[0].message.content);
        // Success! Save this index as the current one
        if (attemptIndex !== currentApiKeyIndex) {
          await chrome.storage.sync.set({ currentApiKeyIndex: attemptIndex });
        }
        return result;
      } catch (e) {
        console.error("Failed to parse AI response:", data.choices[0].message.content);
        throw new Error("Invalid AI response format.");
      }
    } catch (err) {
      lastError = err;
      if (err.message.includes("fetch")) continue; // Network error, try next key
      throw err;
    }
  }

  throw lastError || new Error("All API keys failed.");
}
