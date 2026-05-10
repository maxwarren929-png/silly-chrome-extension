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
      You are a helpful web assistant. Your goal is to answer the user's question or provide information based on the current webpage content.

      User Question: ${userPrompt || "What is this page about?"}

      CRITICAL RULES:
      1. Output ONLY valid JSON.
      2. Provide a direct, concise answer.
      3. Use the provided page content and interactable options to inform your answer.

      RESPONSE FORMAT:
      {
        "answer": "Your detailed answer here",
        "reason": "Brief explanation of how you found the answer"
      }
    `;
  } else {
    systemPrompt = `
      You are an expert Web Pilot Agent. Your goal is to navigate and complete multi-step tasks on a webpage.
      User Goal: ${userPrompt || "Explore the page and identify any tasks to complete."}

      CRITICAL RULES:
      1. Output ONLY valid JSON.
      2. Choose the most logical next action to move towards the goal.
      3. If you just answered a question or filled a form, LOOK FOR "Next", "Submit", "Continue", or "Check" buttons to progress.
      4. DO NOT return action: "done" until the final confirmation page is reached or the multi-step flow is truly finished.
      5. If you provide information in the "answer" field, you MUST still provide a navigation "action" (like "click" on a "Next" button) if the task is not yet complete.
      6. Be precise with "targetId" from the provided INTERACTABLE OPTIONS.
      7. If you've tried an action and it didn't seem to work (check history), try a different approach or element.

      ACTION TYPES:
      - "click": For buttons, links, or radio buttons.
      - "type": For text inputs or textareas. Requires "text".
      - "check": For checkboxes.
      - "select": For dropdowns. Requires "optionText".
      - "scroll": To see more content. Requires "direction" ("down" or "up").
      - "hover": To trigger tooltips or menus. Requires "targetId".
      - "key": Press a specific key (e.g., "Enter", "Escape"). Requires "key" and optional "targetId".
      - "wait": If you expect the page to load or change after an action.
      - "refuse": If you are stuck or cannot proceed. Provide a reason.
      - "done": Goal fully reached (no more steps or navigation possible).

      RESPONSE FORMAT:
      {
        "action": "click" | "type" | "check" | "select" | "scroll" | "hover" | "key" | "wait" | "refuse" | "done",
        "targetId": "el_...",
        "text": "...",
        "optionText": "...",
        "direction": "down" | "up",
        "key": "...",
        "confidence": 0.0 to 1.0,
        "reason": "Explain why this action moves towards the goal",
        "answer": "Any direct communication or answer for the user."
      }
    `;
  }

  const userContent = `
    PAGE TITLE: ${pageTitle}
    ${userPrompt ? `USER PROMPT: ${userPrompt}` : `TASK CONTEXT: ${questionText}`}

    INTERACTABLE OPTIONS:
    ${choices.length > 0 ? choices.map(c => `- ${c.choiceId}: ${c.text}`).join("\n") : "None visible."}

    ACTION HISTORY (Last 10 steps):
    ${history.length > 0 ? history.slice(-10).join("\n") : "None yet."}

    PAGE TEXT CONTENT (Truncated):
    ${visibleText.slice(0, 6000)}
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
      temperature: 0.1,
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
