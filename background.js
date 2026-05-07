const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.3-70b-versatile"; // Updated to supported model

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
    pageText,
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
    3. If multiple tasks are visible, pick the most immediate one.
    4. If the task is finished, return action: "done".
    
    ACTION TYPES:
    - "click": For buttons, radios, or links. Requires "targetId" (from choices).
    - "type": For text inputs. Requires "text" and "targetId".
    - "check": For checkboxes. Requires "targetId".
    - "select": For dropdowns. Requires "optionText" and "targetId".
    - "wait": If you expect the page to change or load.
    - "refuse": If you cannot proceed.
    - "done": Goal reached.

    RESPONSE FORMAT:
    {
      "action": "click" | "type" | "check" | "select" | "wait" | "refuse" | "done",
      "targetId": "...", 
      "text": "...", 
      "optionText": "...",
      "confidence": 0.0 to 1.0,
      "reason": "Explain your logic briefly"
    }
  `;

  const userContent = `
    PAGE: ${pageTitle}
    CURRENT TASK DATA:
    Type: ${task}
    Description: ${questionText}
    Target ID: ${payload.targetId || "multiple choices below"}
    ${choices.length > 0 ? "INTERACTABLE OPTIONS:\n" + choices.map(c => `- ${c.choiceId}: ${c.text}`).join("\n") : ""}
    
    ACTION HISTORY:
    ${history.length > 0 ? history.join("\n") : "None yet."}

    VISIBLE PAGE CONTEXT:
    ${visibleText.slice(0, 8000)}
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
