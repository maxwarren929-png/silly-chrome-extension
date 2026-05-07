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
  const { apiKey } = await chrome.storage.sync.get(["apiKey"]);
  if (!apiKey) throw new Error("API Key missing. Set it in options.");

  const {
    task,
    questionText,
    choices = [],
    visibleText,
    pageTitle,
    userPrompt,
    history = []
  } = payload;

  const systemPrompt = `
    You are an expert Web Pilot Agent. Your goal is to navigate and complete tasks on a webpage.
    User Goal: ${userPrompt || "Complete all questions and tasks on this page."}
    
    CRITICAL RULES:
    1. Output ONLY valid JSON.
    2. Choose the most logical next action to move towards the goal.
    3. If multiple actions are possible, pick the one that progresses the task furthest.
    4. If the goal is reached or no more actions are needed, return action: "done".
    5. Be precise with "targetId" from the provided INTERACTABLE OPTIONS.
    
    ACTION TYPES:
    - "click": For buttons, links, or radio buttons.
    - "type": For text inputs or textareas. Requires "text".
    - "check": For checkboxes.
    - "select": For dropdowns. Requires "optionText" (the text of the option to select).
    - "wait": If you expect the page to load or change after an action.
    - "refuse": If you are stuck or cannot proceed. Provide a reason.
    - "done": Goal reached.

    RESPONSE FORMAT:
    {
      "action": "click" | "type" | "check" | "select" | "wait" | "refuse" | "done",
      "targetId": "el_...",
      "text": "...", 
      "optionText": "...",
      "confidence": 0.0 to 1.0,
      "reason": "Briefly explain why this action moves towards the goal"
    }
  `;

  const userContent = `
    PAGE TITLE: ${pageTitle}
    TASK CONTEXT: ${questionText}
    
    INTERACTABLE OPTIONS (Visible Elements):
    ${choices.length > 0 ? choices.map(c => `- ${c.choiceId}: ${c.text}`).join("\n") : "None visible."}

    ACTION HISTORY (Previous Steps):
    ${history.length > 0 ? history.slice(-5).join("\n") : "None yet."}

    PAGE TEXT CONTENT (Truncated):
    ${visibleText.slice(0, 5000)}
  `;

  const resp = await fetch(GROQ_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
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
  try {
    return JSON.parse(data.choices[0].message.content);
  } catch (e) {
    console.error("Failed to parse AI response:", data.choices[0].message.content);
    throw new Error("Invalid AI response format.");
  }
}
