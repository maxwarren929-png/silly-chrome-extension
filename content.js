(function init() {
  if (window.__pageQaLoaded) return;
  window.__pageQaLoaded = true;

  let root = null;
  let currentMode = null;
  let autoPrompt = "";
  let isScanning = false;
  let actionHistory = [];
  const elementIdsMap = new WeakMap();
  let idCounter = 0;
  let interactablesMap = new Map(); // id -> element

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
    if (!logEl) return;
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

  let isWorking = false;
  async function scanLoop() {
    if (!isScanning || isWorking) return;
    isWorking = true;

    try {
      const task = gatherInteractables();
      if (task.choices.length > 0) {
        if (currentMode === "pilot") {
          await executePilotStep(task);
        } else if (currentMode === "auto") {
          await offerAutoStep(task);
        }
      } else {
        if (currentMode === "pilot") {
          await executePilotStep({ task: "page", questionText: "No obvious interactables found. Reviewing page.", choices: [] });
        }
      }
    } catch (e) {
      console.error("Scan loop error:", e);
      addToLog("Scan loop error, retrying...", "error");
    } finally {
      isWorking = false;
      if (isScanning) {
        setTimeout(scanLoop, 3000);
      }
    }
  }

  async function executePilotStep(taskData) {
    addToLog(`Thinking...`);
    const result = await askGroqForAction(taskData, autoPrompt);
    
    if (result.ok) {
      const plan = result.plan;
      if (!plan || !plan.action) {
        addToLog("Invalid response from AI", "error");
        return;
      }
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

      const success = applyAction(plan);
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
    if (!responseEl) return;
    responseEl.style.display = "block";
    responseEl.textContent = "Analyzing detected task...";
    
    const result = await askGroqForAction(taskData, autoPrompt);
    if (result.ok) {
      const plan = result.plan;
      if (!plan || !plan.action) {
        responseEl.textContent = "Invalid response from AI";
        return;
      }

      responseEl.innerHTML = "";
      const header = document.createElement("div");
      header.style.fontWeight = "600";
      header.style.marginBottom = "4px";
      header.textContent = `Suggested: ${plan.action.toUpperCase()}`;

      const reason = document.createElement("div");
      reason.style.fontSize = "0.85rem";
      reason.textContent = plan.reason;

      const btn = document.createElement("button");
      btn.className = "qa-primary-btn";
      btn.style.marginTop = "8px";
      btn.style.width = "100%";
      btn.textContent = "Execute Action";
      btn.onclick = () => {
        applyAction(plan);
        responseEl.style.display = "none";
      };

      responseEl.appendChild(header);
      responseEl.appendChild(reason);
      responseEl.appendChild(btn);
    }
  }

  async function onManualSolve() {
    const btn = root.querySelector("#qa-solve-btn");
    const responseEl = root.querySelector("#qa-response");
    const prompt = root.querySelector(".qa-textarea").value.trim();

    btn.disabled = true;
    btn.textContent = "Analyzing...";
    
    const task = gatherInteractables();
    if (task.choices.length === 0) {
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
      responseEl.innerHTML = "";
      const header = document.createElement("div");
      header.style.fontWeight = "600";
      header.textContent = `Plan: ${plan.action}`;

      const reason = document.createElement("div");
      reason.textContent = plan.reason;

      const applyBtn = document.createElement("button");
      applyBtn.className = "qa-primary-btn";
      applyBtn.style.marginTop = "8px";
      applyBtn.style.width = "100%";
      applyBtn.textContent = "Apply";
      applyBtn.onclick = () => {
        applyAction(plan);
        responseEl.style.display = "none";
      };

      responseEl.appendChild(header);
      responseEl.appendChild(reason);
      responseEl.appendChild(applyBtn);
    }
    responseEl.style.display = "block";
  }

  function applyAction(plan) {
    try {
      const target = interactablesMap.get(plan.targetId);
      if (!target && plan.action !== "wait" && plan.action !== "done") {
        console.error("Target not found for ID:", plan.targetId);
        return false;
      }

      if (target) {
        highlightElement(target);
        target.scrollIntoView({ block: "center", behavior: "smooth" });
      }

      if (plan.action === "click" || plan.action === "check") {
        target.focus();
        target.click();
        // Fire extra events for robustness
        target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return true;
      }

      if (plan.action === "type") {
        target.focus();
        target.value = plan.text;
        target.dispatchEvent(new Event("input", { bubbles: true }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
        target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
        return true;
      }

      if (plan.action === "select") {
        target.focus();
        const options = Array.from(target.options);
        const best = options.find(o => o.text.toLowerCase().includes(plan.optionText.toLowerCase()) || o.value.toLowerCase().includes(plan.optionText.toLowerCase())) || options[0];
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

  function highlightElement(el) {
    const originalOutline = el.style.outline;
    el.style.outline = "3px solid #3b82f6";
    el.style.outlineOffset = "2px";
    setTimeout(() => {
      if (el) el.style.outline = originalOutline;
    }, 2000);
  }

  async function askGroqForAction(taskData, userPrompt) {
    const visibleText = extractVisibleText();
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: "ASK_GROQ_ACTION",
        payload: {
          ...taskData,
          visibleText,
          userPrompt,
          pageTitle: document.title,
          history: actionHistory
        }
      }, (resp) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve(resp || { ok: false, error: "Empty response from background script" });
      });
    });
  }

  function gatherInteractables() {
    interactablesMap.clear();
    const choices = [];
    const elements = document.querySelectorAll("input, textarea, select, button, a, [role='button']");

    Array.from(elements).forEach((el) => {
      if (!isInteractable(el)) return;

      let id = elementIdsMap.get(el);
      if (!id) {
        id = `el_${idCounter++}`;
        elementIdsMap.set(el, id);
      }
      interactablesMap.set(id, el);

      let text = "";
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        const label = document.querySelector(`label[for="${el.id}"]`) || el.closest("label");
        text = `[${el.type || 'text'}] ${label?.innerText || el.placeholder || el.name || 'Input'}`;
      } else if (el.tagName === "SELECT") {
        const label = document.querySelector(`label[for="${el.id}"]`) || el.closest("label");
        text = `[select] ${label?.innerText || el.name || 'Dropdown'}`;
      } else {
        text = `[${el.tagName.toLowerCase()}] ${el.innerText || el.value || el.title || 'Clickable'}`;
      }

      choices.push({ choiceId: id, text: text.trim().slice(0, 200) });
    });

    return { 
      task: "page_interaction",
      questionText: "Identify the next logical interaction on this page.",
      choices: choices.slice(0, 100)
    };
  }

  function isInteractable(el) {
    if (el.closest("#page-qa-root")) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    return true;
  }

  function extractVisibleText() {
    return document.body.innerText.slice(0, 8000);
  }

})();
