(function init() {
  if (window.__pageQaLoaded) return;
  window.__pageQaLoaded = true;

  let root = null;
  let currentMode = null;
  let autoPrompt = "";
  let isScanning = false;
  let actionHistory = [];
  const processedElements = new Set();
  const groupIds = new WeakMap();
  let groupIdCounter = 0;

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "OPEN_UI") {
      toggleSidebar();
    }
  });

  function toggleSidebar() {
    if (!root) createSidebar();
    root.style.display = root.style.display === "none" ? "block" : "none";
    if (root.style.display === "block") showModePicker();
  }

  function createSidebar() {
    root = document.createElement("div");
    root.id = "page-qa-root";
    root.innerHTML = `
      <div class="qa-card">
        <div class="qa-header">
          <div class="qa-title">Pilot Pro</div>
          <button class="qa-close">×</button>
        </div>
        <div id="qa-content" class="qa-content"></div>
        <div id="qa-log" class="qa-log" style="display:none"></div>
      </div>
    `;
    document.body.appendChild(root);
    root.querySelector(".qa-close").addEventListener("click", () => {
      root.style.display = "none";
      stopScanning();
    });
  }

  function addToLog(msg, type = "info") {
    const logEl = root.querySelector("#qa-log");
    logEl.style.display = "block";
    const entry = document.createElement("div");
    entry.className = `qa-log-entry qa-log-${type}`;
    entry.textContent = `> ${msg}`;
    logEl.prepend(entry);
    if (logEl.childNodes.length > 20) logEl.lastChild.remove();
  }

  function showModePicker() {
    currentMode = null;
    stopScanning();
    const content = root.querySelector("#qa-content");
    root.querySelector("#qa-log").style.display = "none";
    content.innerHTML = `
      <div class="qa-mode-picker">
        <button class="qa-mode-btn" data-mode="manual">
          <span class="qa-mode-name">Manual</span>
          <span class="qa-mode-desc">Point and solve.</span>
        </button>
        <button class="qa-mode-btn" data-mode="auto">
          <span class="qa-mode-name">Auto</span>
          <span class="qa-mode-desc">Assisted solving.</span>
        </button>
        <button class="qa-mode-btn" data-mode="pilot">
          <span class="qa-mode-name">Pilot</span>
          <span class="qa-mode-desc">Full autonomous agent.</span>
        </button>
      </div>
    `;
    content.querySelectorAll(".qa-mode-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.mode;
        if (mode === "manual") showManualUI();
        else if (mode === "auto") showAutoUI();
        else if (mode === "pilot") showPilotUI();
      });
    });
  }

  function showManualUI() {
    currentMode = "manual";
    const content = root.querySelector("#qa-content");
    content.innerHTML = `
      <div class="qa-manual-ui">
        <button class="qa-back-btn">← Modes</button>
        <textarea class="qa-textarea" placeholder="Specific instruction for this element..."></textarea>
        <button class="qa-primary-btn" id="qa-solve-btn">Scan & Solve</button>
        <div id="qa-response" class="qa-response" style="display:none"></div>
      </div>
    `;
    content.querySelector(".qa-back-btn").addEventListener("click", showModePicker);
    content.querySelector("#qa-solve-btn").addEventListener("click", onManualSolve);
  }

  function showAutoUI() {
    currentMode = "auto";
    const content = root.querySelector("#qa-content");
    content.innerHTML = `
      <div class="qa-auto-ui">
        <button class="qa-back-btn">← Modes</button>
        <textarea class="qa-textarea" placeholder="General rules (e.g. Always choose the cheapest option)"></textarea>
        <button class="qa-primary-btn" id="qa-start-auto">Start Auto-Assist</button>
        <div id="qa-auto-status" class="qa-status-box" style="display:none">
          <span class="qa-status-dot active"></span> Monitoring page...
        </div>
        <div id="qa-response" class="qa-response" style="display:none"></div>
      </div>
    `;
    content.querySelector(".qa-back-btn").addEventListener("click", showModePicker);
    content.querySelector("#qa-start-auto").addEventListener("click", () => startScanning("auto"));
  }

  function showPilotUI() {
    currentMode = "pilot";
    const content = root.querySelector("#qa-content");
    content.innerHTML = `
      <div class="qa-pilot-ui">
        <button class="qa-back-btn">← Modes</button>
        <textarea class="qa-textarea" placeholder="Goal (e.g. Complete the enrollment form, buy the product, solve the quiz)"></textarea>
        <button class="qa-primary-btn" id="qa-start-pilot">Activate Pilot Agent</button>
        <div id="qa-pilot-status" class="qa-status-box" style="display:none">
          <span class="qa-status-dot active"></span> Agent Active - Thinking...
        </div>
      </div>
    `;
    content.querySelector(".qa-back-btn").addEventListener("click", showModePicker);
    content.querySelector("#qa-start-pilot").addEventListener("click", () => startScanning("pilot"));
  }

  function startScanning(mode) {
    const textarea = root.querySelector(".qa-textarea");
    const btn = mode === "auto" ? root.querySelector("#qa-start-auto") : root.querySelector("#qa-start-pilot");
    const status = mode === "auto" ? root.querySelector("#qa-auto-status") : root.querySelector("#qa-pilot-status");
    
    autoPrompt = textarea.value.trim();
    isScanning = true;
    btn.style.display = "none";
    textarea.disabled = true;
    status.style.display = "flex";
    
    addToLog(`Pilot activated: ${autoPrompt || "Full Auto"}`);
    scanLoop();
  }

  function stopScanning() {
    isScanning = false;
    actionHistory = [];
  }

  async function scanLoop() {
    if (!isScanning) return;

    const task = detectNextTask();
    if (task) {
      if (currentMode === "pilot") {
        await executePilotStep(task);
      } else if (currentMode === "auto") {
        await offerAutoStep(task);
      }
    } else {
      // If no obvious form/task, check for "Done" or general page state
      if (currentMode === "pilot") {
        await executePilotStep({ task: "page", questionText: "Reviewing page for next steps...", choices: [] });
      }
    }

    if (isScanning) {
      setTimeout(scanLoop, 3000); // 3s heartbeat
    }
  }

  async function executePilotStep(taskData) {
    addToLog(`Thinking: ${taskData.questionText.slice(0, 30)}...`);
    const result = await askGroqForAction(taskData, autoPrompt);
    
    if (result.ok) {
      if (!result.plan || !result.plan.action) {
        addToLog("Invalid response from AI", "error");
        return;
      }
      const plan = result.plan;
      if (plan.action === "done") {
        addToLog("Goal reached! Deactivating Pilot.", "success");
        stopScanning();
        showModePicker();
        return;
      }
      
      if (plan.action === "wait") {
        addToLog("Waiting for page update...");
        return;
      }

      if (plan.action === "refuse") {
        addToLog(`Pilot stuck: ${plan.reason}`, "error");
        return;
      }

      const success = applyAction(taskData, plan);
      if (success) {
        addToLog(`${plan.action.toUpperCase()}: ${plan.reason || "Executed"}`, "success");
        actionHistory.push(`${plan.action} on ${plan.targetId || "page"}: ${plan.reason}`);
      } else {
        addToLog(`Failed to execute ${plan.action}`, "error");
      }
    } else {
      addToLog(`Error: ${result.error}`, "error");
    }
  }

  async function offerAutoStep(taskData) {
    const responseEl = root.querySelector("#qa-response");
    responseEl.style.display = "block";
    responseEl.textContent = "Analyzing detected task...";
    
    const result = await askGroqForAction(taskData, autoPrompt);
    if (result.ok) {
      if (!result.plan || !result.plan.action) {
        responseEl.textContent = "Invalid response from AI";
        return;
      }
      const plan = result.plan;
      responseEl.innerHTML = `
        <div style="font-weight:600; margin-bottom:4px">Suggested: ${plan.action.toUpperCase()}</div>
        <div style="font-size:0.85rem">${plan.reason}</div>
        <button class="qa-primary-btn" id="qa-apply-btn" style="margin-top:8px; width:100%">Execute Action</button>
      `;
      responseEl.querySelector("#qa-apply-btn").addEventListener("click", () => {
        applyAction(taskData, plan);
        responseEl.style.display = "none";
      });
    }
  }

  async function onManualSolve() {
    const btn = root.querySelector("#qa-solve-btn");
    const responseEl = root.querySelector("#qa-response");
    const prompt = root.querySelector(".qa-textarea").value.trim();

    btn.disabled = true;
    btn.textContent = "Analyzing...";
    
    const task = detectNextTask();
    if (!task) {
      btn.disabled = false;
      btn.textContent = "Scan & Solve";
      responseEl.textContent = "Nothing to interact with here.";
      responseEl.style.display = "block";
      return;
    }

    const result = await askGroqForAction(task, prompt);
    btn.disabled = false;
    btn.textContent = "Scan & Solve";
    
    if (result.ok) {
      const plan = result.plan;
      responseEl.innerHTML = `
        <div style="font-weight:600">Plan: ${plan.action}</div>
        <div>${plan.reason}</div>
        <button class="qa-primary-btn" id="qa-apply-btn" style="margin-top:8px; width:100%">Apply</button>
      `;
      responseEl.querySelector("#qa-apply-btn").addEventListener("click", () => {
        applyAction(task, plan);
        responseEl.style.display = "none";
      });
    }
    responseEl.style.display = "block";
  }

  function applyAction(taskData, plan) {
    try {
      let target = null;
      if (plan.targetId) {
        target = taskData.elementsById?.[plan.targetId];
      } else if (taskData.inputEl) {
        target = taskData.inputEl;
      }

      if (!target && plan.action !== "wait" && plan.action !== "done") return false;

      if (plan.action === "click" || plan.action === "check") {
        target.scrollIntoView({ block: "center" });
        target.click();
        return true;
      }

      if (plan.action === "type") {
        target.scrollIntoView({ block: "center" });
        target.focus();
        target.value = plan.text;
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }

      if (plan.action === "select") {
        target.scrollIntoView({ block: "center" });
        const options = Array.from(target.options);
        const best = options.find(o => o.text.includes(plan.optionText) || o.value.includes(plan.optionText)) || options[0];
        target.value = best.value;
        target.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }

      return true;
    } catch (e) {
      console.error("Action execution failed", e);
      return false;
    }
  }

  async function askGroqForAction(taskData, userPrompt) {
    const visibleText = extractVisibleText();
    // Strip non-serializable DOM elements before sending to background script
    const { elementsById, primaryElement, inputEl, ...serializableTaskData } = taskData;
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: "ASK_GROQ_ACTION",
        payload: {
          ...serializableTaskData,
          visibleText,
          userPrompt,
          history: actionHistory
        }
      }, (resp) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve(resp);
      });
    });
  }

  // --- Advanced Detection Logic ---

  function detectNextTask() {
    // Priority: 1. Forms/Inputs 2. MCQ 3. Checkboxes 4. Selects 5. Buttons
    const task = detectTextInput() || detectMcq() || detectCheckboxes() || detectSelects() || detectImportantButtons();
    if (task && processedElements.has(task.primaryElement)) return null; // Avoid spamming same element
    if (task) task.primaryElement = task.primaryElement || task.inputEl || task.choices?.[0]?.el;
    return task;
  }

  function detectMcq() {
    const radios = Array.from(document.querySelectorAll('input[type="radio"]')).filter(isInteractable);
    if (radios.length < 2) return null;
    const group = radios[0].closest("fieldset") || radios[0].parentElement;
    const elementsById = {};
    const choices = radios.map((r, i) => {
      const id = `radio_${i}`;
      elementsById[id] = r;
      const label = document.querySelector(`label[for="${r.id}"]`) || r.closest("label");
      return { choiceId: id, text: (label?.innerText || "Option").trim() };
    });
    return { task: "mcq", questionText: group.innerText.slice(0, 300), choices, elementsById, primaryElement: radios[0] };
  }

  function detectTextInput() {
    const input = Array.from(document.querySelectorAll("input:not([type='radio']):not([type='checkbox']), textarea"))
      .find(i => isInteractable(i) && !["submit", "button", "hidden"].includes(i.type));
    if (!input) return null;
    const label = document.querySelector(`label[for="${input.id}"]`) || input.closest("label");
    return { 
      task: "text", 
      questionText: (label?.innerText || input.placeholder || "Enter text").trim(), 
      inputEl: input, 
      primaryElement: input 
    };
  }

  function detectCheckboxes() {
    const boxes = Array.from(document.querySelectorAll('input[type="checkbox"]')).filter(isInteractable);
    if (boxes.length === 0) return null;
    const elementsById = {};
    const choices = boxes.map((b, i) => {
      const id = `check_${i}`;
      elementsById[id] = b;
      const label = document.querySelector(`label[for="${b.id}"]`) || b.closest("label");
      return { choiceId: id, text: (label?.innerText || "Checkbox").trim() };
    });
    return { task: "checkbox", questionText: "Check applicable options", choices, elementsById, primaryElement: boxes[0] };
  }

  function detectSelects() {
    const select = Array.from(document.querySelectorAll("select")).find(isInteractable);
    if (!select) return null;
    const label = document.querySelector(`label[for="${select.id}"]`) || select.closest("label");
    return { 
      task: "select", 
      questionText: (label?.innerText || "Select an option").trim(), 
      elementsById: { select_0: select }, 
      targetId: "select_0",
      primaryElement: select 
    };
  }

  function detectImportantButtons() {
    const buttons = Array.from(document.querySelectorAll("button, input[type='submit'], a.btn, .button"))
      .filter(b => isInteractable(b) && (b.innerText || b.value).length > 2);
    
    // Prioritize buttons like "Next", "Submit", "Continue", "Finish"
    const important = buttons.find(b => {
      const txt = (b.innerText || b.value || "").toLowerCase();
      return txt.includes("next") || txt.includes("submit") || txt.includes("continue") || txt.includes("finish") || txt.includes("apply");
    });

    if (!important) return null;
    return { 
      task: "button", 
      questionText: `Interact with button: ${important.innerText || important.value}`, 
      choices: [{ choiceId: "btn_0", text: important.innerText || important.value }], 
      elementsById: { btn_0: important },
      primaryElement: important
    };
  }

  function isInteractable(el) {
    if (el.closest("#page-qa-root")) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function extractVisibleText() {
    return document.body.innerText.slice(0, 10000);
  }

})();
