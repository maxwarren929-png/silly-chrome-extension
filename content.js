(function init() {
  if (window.__pageQaLoaded) return;
  window.__pageQaLoaded = true;

  let root = null;
  let currentMode = null;
  let autoPrompt = "";
  let isScanning = false;
  let isPaused = false;
  let scanInterval = 3000;
  let actionHistory = [];
  const elementIdsMap = new WeakMap();
  let idCounter = 0;
  let interactablesMap = new Map(); // id -> element

  // Load state on init
  chrome.storage.local.get(["pilotState"], (res) => {
    if (res.pilotState) {
      const state = res.pilotState;
      if (state.url === window.location.href) {
        actionHistory = state.history || [];
        autoPrompt = state.autoPrompt || "";
        currentMode = state.mode;
        scanInterval = state.scanInterval || 3000;
      }
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "OPEN_UI") {
      toggleSidebar();
    }
  });

  function saveState() {
    try {
      chrome.storage.local.set({
        pilotState: {
          url: window.location.href,
          history: actionHistory,
          autoPrompt: autoPrompt,
          mode: currentMode,
          isScanning: isScanning,
          isPaused: isPaused,
          scanInterval: scanInterval
        }
      });
    } catch (e) {
      console.error("Failed to save state", e);
    }
  }

  function toggleSidebar() {
    if (!root) createSidebar();
    root.style.display = root.style.display === "none" ? "block" : "none";
    if (root.style.display === "block") {
      if (currentMode === "pilot") showPilotUI();
      else if (currentMode === "auto") showAutoUI();
      else if (currentMode === "manual") showManualUI();
      else showModePicker();
    }
  }

  function createSidebar() {
    root = document.createElement("div");
    root.id = "page-qa-root";
    root.innerHTML = `
      <div class="qa-card">
        <div class="qa-header">
          <div class="qa-title-row">
            <div class="qa-title">Pilot Pro</div>
            <div id="qa-badge" class="qa-badge">Idle</div>
          </div>
          <button class="qa-close">×</button>
        </div>
        <div id="qa-content" class="qa-content"></div>
        <div id="qa-log-container" style="display:none">
          <div class="qa-log-header">
            <span>Activity Log</span>
            <button id="qa-clear-log" class="qa-text-btn">Clear</button>
          </div>
          <div id="qa-log" class="qa-log"></div>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    root.querySelector(".qa-close").addEventListener("click", () => {
      root.style.display = "none";
    });
    root.querySelector("#qa-clear-log").addEventListener("click", () => {
      const logEl = root.querySelector("#qa-log");
      if (logEl) logEl.innerHTML = "";
      actionHistory = [];
      saveState();
    });
  }

  function setBadge(text, type = "idle") {
    if (!root) return;
    const badge = root.querySelector("#qa-badge");
    if (!badge) return;
    badge.textContent = text;
    badge.className = `qa-badge qa-badge-${type}`;
  }

  function addToLog(msg, type = "info") {
    if (!root) return;
    const container = root.querySelector("#qa-log-container");
    const logEl = root.querySelector("#qa-log");
    if (!logEl || !container) return;
    container.style.display = "block";
    const entry = document.createElement("div");
    entry.className = `qa-log-entry qa-log-${type}`;
    entry.textContent = `> ${msg}`;
    logEl.prepend(entry);
    if (logEl.childNodes.length > 50) logEl.lastChild.remove();
  }

  function showModePicker() {
    currentMode = null;
    stopScanning();
    const content = root.querySelector("#qa-content");
    root.querySelector("#qa-log-container").style.display = "none";
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
    setBadge("Idle", "idle");
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
    const textarea = content.querySelector(".qa-textarea");
    if (autoPrompt && currentMode === "manual") textarea.value = autoPrompt;
    saveState();
  }

  function showAutoUI() {
    currentMode = "auto";
    const content = root.querySelector("#qa-content");
    content.innerHTML = `
      <div class="qa-auto-ui">
        <button class="qa-back-btn">← Modes</button>
        <textarea class="qa-textarea" placeholder="General rules (e.g. Always choose the cheapest option)"></textarea>
        <div class="qa-settings-row">
          <label>Interval: <span id="interval-val">${scanInterval/1000}</span>s</label>
          <input type="range" id="scan-interval" min="1000" max="10000" step="500" value="${scanInterval}">
        </div>
        <div class="qa-controls">
          <button class="qa-primary-btn" id="qa-start-auto">Start Auto-Assist</button>
          <button class="qa-secondary-btn" id="qa-pause-btn" style="display:none">Pause</button>
          <button class="qa-danger-btn" id="qa-stop-btn" style="display:none">Stop</button>
        </div>
        <div id="qa-response" class="qa-response" style="display:none"></div>
      </div>
    `;
    content.querySelector(".qa-back-btn").addEventListener("click", showModePicker);
    content.querySelector("#qa-start-auto").addEventListener("click", () => startScanning("auto"));
    content.querySelector("#qa-stop-btn").addEventListener("click", stopScanning);
    content.querySelector("#qa-pause-btn").addEventListener("click", togglePause);

    const slider = content.querySelector("#scan-interval");
    slider.addEventListener("input", (e) => {
      scanInterval = parseInt(e.target.value);
      content.querySelector("#interval-val").textContent = (scanInterval/1000).toFixed(1);
      saveState();
    });

    const textarea = content.querySelector(".qa-textarea");
    if (autoPrompt) textarea.value = autoPrompt;

    if (isScanning) updateUIForScanning();
    saveState();
  }

  function showPilotUI() {
    currentMode = "pilot";
    const content = root.querySelector("#qa-content");
    content.innerHTML = `
      <div class="qa-pilot-ui">
        <button class="qa-back-btn">← Modes</button>
        <textarea class="qa-textarea" placeholder="Goal (e.g. Complete the enrollment form, buy the product, solve the quiz)"></textarea>
        <div class="qa-settings-row">
          <label>Interval: <span id="interval-val">${scanInterval/1000}</span>s</label>
          <input type="range" id="scan-interval" min="1000" max="10000" step="500" value="${scanInterval}">
        </div>
        <div class="qa-controls">
          <button class="qa-primary-btn" id="qa-start-pilot">Activate Pilot</button>
          <button class="qa-secondary-btn" id="qa-pause-btn" style="display:none">Pause</button>
          <button class="qa-danger-btn" id="qa-stop-btn" style="display:none">Stop</button>
        </div>
      </div>
    `;
    content.querySelector(".qa-back-btn").addEventListener("click", showModePicker);
    content.querySelector("#qa-start-pilot").addEventListener("click", () => startScanning("pilot"));
    content.querySelector("#qa-stop-btn").addEventListener("click", stopScanning);
    content.querySelector("#qa-pause-btn").addEventListener("click", togglePause);

    const slider = content.querySelector("#scan-interval");
    slider.addEventListener("input", (e) => {
      scanInterval = parseInt(e.target.value);
      content.querySelector("#interval-val").textContent = (scanInterval/1000).toFixed(1);
      saveState();
    });

    const textarea = content.querySelector(".qa-textarea");
    if (autoPrompt) textarea.value = autoPrompt;

    if (isScanning) updateUIForScanning();
    saveState();
  }

  function startScanning(mode) {
    const textarea = root.querySelector(".qa-textarea");
    autoPrompt = textarea ? textarea.value.trim() : "";
    isScanning = true;
    isPaused = false;

    updateUIForScanning();
    
    addToLog(`Pilot activated: ${autoPrompt || "Full Auto"}`);
    saveState();
    scanLoop();
  }

  function updateUIForScanning() {
    if (!root) return;
    const startBtn = root.querySelector("#qa-start-auto") || root.querySelector("#qa-start-pilot");
    const stopBtn = root.querySelector("#qa-stop-btn");
    const pauseBtn = root.querySelector("#qa-pause-btn");
    const textarea = root.querySelector(".qa-textarea");

    if (startBtn) startBtn.style.display = "none";
    if (stopBtn) stopBtn.style.display = "block";
    if (pauseBtn) {
      pauseBtn.style.display = "block";
      pauseBtn.textContent = isPaused ? "Resume" : "Pause";
    }
    if (textarea) textarea.disabled = true;

    setBadge(isPaused ? "Paused" : "Scanning", isPaused ? "idle" : "active");
  }

  function togglePause() {
    isPaused = !isPaused;
    const pauseBtn = root.querySelector("#qa-pause-btn");
    if (pauseBtn) pauseBtn.textContent = isPaused ? "Resume" : "Pause";
    setBadge(isPaused ? "Paused" : "Scanning", isPaused ? "idle" : "active");
    addToLog(isPaused ? "Pilot paused." : "Pilot resumed.");
    saveState();
  }

  function stopScanning() {
    isScanning = false;
    isPaused = false;

    const startBtn = root.querySelector("#qa-start-auto") || root.querySelector("#qa-start-pilot");
    const stopBtn = root.querySelector("#qa-stop-btn");
    const pauseBtn = root.querySelector("#qa-pause-btn");
    const textarea = root.querySelector(".qa-textarea");

    if (startBtn) startBtn.style.display = "block";
    if (stopBtn) stopBtn.style.display = "none";
    if (pauseBtn) pauseBtn.style.display = "none";
    if (textarea) textarea.disabled = false;

    setBadge("Idle", "idle");
    addToLog("Pilot stopped.");
    saveState();
  }

  let isWorking = false;
  async function scanLoop() {
    if (!isScanning) return;
    if (isPaused || isWorking) {
      setTimeout(scanLoop, 1000);
      return;
    }

    isWorking = true;
    setBadge("Thinking", "thinking");

    try {
      const task = gatherInteractables();
      if (task.choices.length > 0 || currentMode === "pilot") {
        if (currentMode === "pilot") {
          await executePilotStep(task);
        } else if (currentMode === "auto") {
          await offerAutoStep(task);
        }
      }
    } catch (e) {
      console.error("Scan loop error:", e);
      addToLog("Scan loop error, retrying...", "error");
    } finally {
      isWorking = false;
      if (isScanning) {
        if (!isPaused) setBadge("Scanning", "active");
        setTimeout(scanLoop, scanInterval);
      }
    }
  }

  async function executePilotStep(taskData) {
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

      const success = await applyActionWithRetry(plan);
      if (success) {
        addToLog(`${plan.action.toUpperCase()}: ${plan.reason || "Executed"}`, "success");
        actionHistory.push(`${plan.action} on ${plan.targetId || "page"}: ${plan.reason}`);
        saveState();
      } else {
        addToLog(`Failed to execute ${plan.action}`, "error");
      }
    } else {
      addToLog(`Error: ${result.error}`, "error");
    }
  }

  async function applyActionWithRetry(plan, retries = 2) {
    for (let i = 0; i <= retries; i++) {
      const success = applyAction(plan);
      if (success) return true;
      if (i < retries) {
        addToLog(`Retrying ${plan.action}... (${i+1}/${retries})`, "info");
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    return false;
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
    if (!btn || !responseEl) return;
    const prompt = root.querySelector(".qa-textarea").value.trim();

    btn.disabled = true;
    btn.textContent = "Analyzing...";
    
    const task = gatherInteractables();
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

      if (!target && !["wait", "done", "scroll", "refuse"].includes(plan.action)) {
        console.error("Target not found for ID:", plan.targetId);
        return false;
      }

      if (target) {
        highlightElement(target);
        target.scrollIntoView({ block: "center", behavior: "smooth" });
      }

      switch(plan.action) {
        case "click":
        case "check":
          target.focus();
          target.click();
          target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
          target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          return true;
        case "type":
          target.focus();
          target.value = plan.text;
          target.dispatchEvent(new Event("input", { bubbles: true }));
          target.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        case "select":
          target.focus();
          const options = Array.from(target.options);
          const val = plan.optionText || plan.text;
          const best = options.find(o => o.text.toLowerCase().includes(val.toLowerCase()) || o.value.toLowerCase().includes(val.toLowerCase())) || options[0];
          target.value = best.value;
          target.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        case "scroll":
          const amount = plan.direction === "up" ? -window.innerHeight * 0.7 : window.innerHeight * 0.7;
          window.scrollBy({ top: amount, behavior: "smooth" });
          return true;
        case "hover":
          target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          target.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
          return true;
        case "key":
          target.focus();
          const key = plan.key || "Enter";
          target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: key }));
          target.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: key }));
          return true;
        case "wait":
          return true;
        case "done":
          return true;
        default:
          return false;
      }
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
      if (el && el.isConnected) el.style.outline = originalOutline;
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
    const elements = document.querySelectorAll("input, textarea, select, button, a, [role='button'], summary");

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
    if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    return true;
  }

  function extractVisibleText() {
    return document.body.innerText.slice(0, 8000);
  }

})();
