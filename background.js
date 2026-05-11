/**
 * Page QA Sidebar - Background Service Worker
 * Handles Groq API interactions and extension action clicks.
 */

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

/**
 * Handle extension icon clicks.
 * Attempts to toggle the UI in the current tab, injecting scripts if necessary.
 */
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
    console.error("Page QA Sidebar: Failed to inject script:", err);
  }
});

/**
 * Sends an OPEN_UI message to the content script.
 * @param {number} tabId
 * @returns {Promise<boolean>} True if message was delivered.
 */
function sendOpenMessage(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "OPEN_UI" }, () => {
      if (chrome.runtime.lastError) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

/**
 * Listen for messages from content scripts or options page.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ASK_GROQ_ACTION") {
    askGroqForAction(message.payload)
      .then((plan) => sendResponse({ ok: true, plan }))
      .catch((error) => {
        console.error("Page QA Sidebar: Groq Request Failed", error);
        sendResponse({ ok: false, error: error.message });
      });
    return true; // Keep message channel open for async response
  }
  return false;
});

/**
 * Communicates with Groq API to determine the next action.
 * @param {Object} payload Data from the content script.
 * @returns {Promise<Object>} The AI-generated plan.
 */
async function askGroqForAction(payload) {
  const { apiKey, selectedModel } = await chrome.storage.sync.get(["apiKey", "selectedModel"]);
  if (!apiKey) {
    throw new Error("API Key missing. Please set it in the extension options.");
  }

  const model = selectedModel || DEFAULT_MODEL;

  const {
    choices = [],
    visibleText = "",
    pageTitle = "",
    userPrompt = "",
    history = []
  } = payload;

  const systemPrompt = `
    You are an expert Web Pilot Agent. Your goal is to navigate and complete tasks on a webpage.
    User Goal: ${userPrompt || "Explore the page and identify any tasks to complete."}
    
    CRITICAL RULES:
    1. Output ONLY valid JSON.
    2. Choose the most logical next action to move towards the goal.
    3. If multiple actions are possible, pick the one that progresses the task furthest.
    4. If the goal is reached or no more actions are needed, return action: "done".
    5. Be precise with "targetId" from the provided INTERACTABLE OPTIONS.
    6. If you've tried an action and it didn't seem to work (check history), try a different approach or element.
    
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
    - "done": Goal reached.

    RESPONSE FORMAT:
    {
      "action": "click" | "type" | "check" | "select" | "scroll" | "hover" | "key" | "wait" | "refuse" | "done",
      "targetId": "el_...",
      "text": "...", 
      "optionText": "...",
      "direction": "down" | "up",
      "key": "...",
      "confidence": 0.0 to 1.0,
      "reason": "Explain why this action moves towards the goal"
    }
  `;

  const userContent = `
    PAGE TITLE: ${pageTitle}

    INTERACTABLE OPTIONS:
    ${choices.length > 0 ? choices.map(c => `- ${c.choiceId}: ${c.text}`).join("\n") : "None visible."}

    ACTION HISTORY (Last 10 steps):
    ${history.length > 0 ? history.slice(-10).join("\n") : "None yet."}

    PAGE TEXT CONTENT (Truncated):
    ${visibleText.slice(0, 6000)}
  `;

  const resp = await fetch(GROQ_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
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
    throw new Error(`Groq error: ${resp.status} - ${errorData.error?.message || "Unknown error"}`);
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Empty response from Groq.");
  }

  try {
    return JSON.parse(content);
  } catch (e) {
    console.error("Page QA Sidebar: Failed to parse AI response:", content);
    throw new Error("Invalid AI response format.");
  }
}
