/**
 * Page QA Sidebar - Content Script
 * Manages the sidebar UI, element scanning, and action execution.
 */
(function init() {
  if (window.__pageQaLoaded) return;
  window.__pageQaLoaded = true;

  // --- State Management ---
  const state = {
    root: null,
    mode: null, // 'manual' | 'auto' | 'pilot'
    autoPrompt: "",
    isScanning: false,
    isPaused: false,
    isWorking: false,
    scanInterval: 3000,
    actionHistory: [],
    elementIdsMap: new WeakMap(),
    idCounter: 0,
    interactablesMap: new Map() // id -> HTMLElement
  };

  /**
   * Loads persisted state from chrome.storage.local.
   */
  function loadState() {
    chrome.storage.local.get(["pilotState"], (res) => {
      if (res.pilotState && res.pilotState.url === window.location.href) {
        state.actionHistory = res.pilotState.history || [];
        state.autoPrompt = res.pilotState.autoPrompt || "";
        state.mode = res.pilotState.mode;
        state.scanInterval = res.pilotState.scanInterval || 3000;

        // If it was scanning, we might want to resume, but for safety
        // we'll wait for the user to toggle it again if they just reloaded.
      }
    });
  }

  /**
   * Persists current state to chrome.storage.local.
   */
  function saveState() {
    try {
      chrome.storage.local.set({
        pilotState: {
          url: window.location.href,
          history: state.actionHistory,
          autoPrompt: state.autoPrompt,
          mode: state.mode,
          isScanning: state.isScanning,
          isPaused: state.isPaused,
          scanInterval: state.scanInterval
        }
      });
    } catch (e) {
      console.error("Page QA Sidebar: Failed to save state", e);
    }
  }

  // --- UI Components ---

  /**
   * Toggles the sidebar visibility.
   */
  function toggleSidebar() {
    if (!state.root) createSidebar();

    const isHidden = state.root.style.display === "none";
    state.root.style.display = isHidden ? "block" : "none";

    if (isHidden) {
      renderCurrentMode();
    }
  }

  /**
   * Creates the base sidebar structure.
   */
  function createSidebar() {
    state.root = document.createElement("div");
    state.root.id = "page-qa-root";
    state.root.innerHTML = `
      <div class="qa-card">
        <div class="qa-header">
          <div class="qa-title-row">
            <div class="qa-title">Pilot Pro</div>
            <div id="qa-badge" class="qa-badge">Idle</div>
          </div>
          <button class="qa-close" title="Close Sidebar">×</button>
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
    document.body.appendChild(state.root);

    state.root.querySelector(".qa-close").addEventListener("click", () => {
      state.root.style.display = "none";
    });

    state.root.querySelector("#qa-clear-log").addEventListener("click", () => {
      const logEl = state.root.querySelector("#qa-log");
      if (logEl) logEl.innerHTML = "";
      state.actionHistory = [];
      saveState();
    });
  }

  /**
   * Renders the UI based on the current active mode.
   */
  function renderCurrentMode() {
    if (!state.mode) {
      showModePicker();
    } else {
      switch (state.mode) {
        case "manual": showManualUI(); break;
        case "auto": showAutoUI(); break;
        case "pilot": showPilotUI(); break;
        default: showModePicker();
      }
    }
  }

  /**
   * Shows the mode selection screen.
   */
  function showModePicker() {
    state.mode = null;
    stopScanning();
    const content = state.root.querySelector("#qa-content");
    state.root.querySelector("#qa-log-container").style.display = "none";

    content.innerHTML = `
      <div class="qa-mode-picker">
        <button class="qa-mode-btn" data-mode="manual">
          <span class="qa-mode-name">Manual</span>
          <span class="qa-mode-desc">Point at an element and ask for a solution.</span>
        </button>
        <button class="qa-mode-btn" data-mode="auto">
          <span class="qa-mode-name">Auto</span>
          <span class="qa-mode-desc">Get suggestions for interactions as you browse.</span>
        </button>
        <button class="qa-mode-btn" data-mode="pilot">
          <span class="qa-mode-name">Pilot</span>
          <span class="qa-mode-desc">Autonomous agent that completes goals for you.</span>
        </button>
      </div>
    `;

    content.querySelectorAll(".qa-mode-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        state.mode = btn.dataset.mode;
        renderCurrentMode();
      });
    });
    setBadge("Idle", "idle");
  }

  /**
   * Template for Mode UIs with common elements.
   */
  function getModeTemplate(title, desc, btnId, btnText) {
    return `
      <div class="qa-mode-ui">
        <button class="qa-back-btn">← Back to Modes</button>
        <div class="qa-mode-info">
          <strong>${title}</strong>: ${desc}
        </div>
        <textarea class="qa-textarea" placeholder="${title === 'Pilot' ? 'Goal (e.g. Find and add a laptop under $1000 to cart)' : 'Instructions or rules...'}"></textarea>
        ${title !== 'Manual' ? `
        <div class="qa-settings-row">
          <label>Scan Interval: <span id="interval-val">${state.scanInterval/1000}</span>s</label>
          <input type="range" id="scan-interval" min="1000" max="10000" step="500" value="${state.scanInterval}">
        </div>` : ''}
        <div class="qa-controls">
          <button class="qa-primary-btn" id="${btnId}">${btnText}</button>
          <button class="qa-secondary-btn" id="qa-pause-btn" style="display:none">Pause</button>
          <button class="qa-danger-btn" id="qa-stop-btn" style="display:none">Stop</button>
        </div>
        <div id="qa-response" class="qa-response" style="display:none"></div>
      </div>
    `;
  }

  function setupCommonUIListeners(container) {
    const backBtn = container.querySelector(".qa-back-btn");
    if (backBtn) backBtn.addEventListener("click", showModePicker);

    const textarea = container.querySelector(".qa-textarea");
    if (textarea) {
      textarea.value = state.autoPrompt;
      textarea.addEventListener("input", (e) => {
        state.autoPrompt = e.target.value;
        saveState();
      });
    }

    const slider = container.querySelector("#scan-interval");
    if (slider) {
      slider.addEventListener("input", (e) => {
        state.scanInterval = parseInt(e.target.value);
        container.querySelector("#interval-val").textContent = (state.scanInterval/1000).toFixed(1);
        saveState();
      });
    }

    const stopBtn = container.querySelector("#qa-stop-btn");
    if (stopBtn) stopBtn.addEventListener("click", stopScanning);

    const pauseBtn = container.querySelector("#qa-pause-btn");
    if (pauseBtn) pauseBtn.addEventListener("click", togglePause);
  }

  function showManualUI() {
    const content = state.root.querySelector("#qa-content");
    content.innerHTML = getModeTemplate("Manual", "Analyze page for specific task.", "qa-solve-btn", "Scan & Solve");
    setupCommonUIListeners(content);
    content.querySelector("#qa-solve-btn").addEventListener("click", onManualSolve);
    saveState();
  }

  function showAutoUI() {
    const content = state.root.querySelector("#qa-content");
    content.innerHTML = getModeTemplate("Auto", "Suggestions for your next move.", "qa-start-auto", "Start Auto-Assist");
    setupCommonUIListeners(content);
    content.querySelector("#qa-start-auto").addEventListener("click", () => startScanning("auto"));
    if (state.isScanning) updateUIForScanning();
    saveState();
  }

  function showPilotUI() {
    const content = state.root.querySelector("#qa-content");
    content.innerHTML = getModeTemplate("Pilot", "Autonomous task execution.", "qa-start-pilot", "Activate Pilot");
    setupCommonUIListeners(content);
    content.querySelector("#qa-start-pilot").addEventListener("click", () => startScanning("pilot"));
    if (state.isScanning) updateUIForScanning();
    saveState();
  }

  // --- Control Logic ---

  function startScanning(mode) {
    state.isScanning = true;
    state.isPaused = false;
    updateUIForScanning();
    addToLog(`${mode.toUpperCase()} mode activated.`);
    saveState();
    scanLoop();
  }

  function stopScanning() {
    state.isScanning = false;
    state.isPaused = false;
    updateUIForScanning();
    setBadge("Idle", "idle");
    addToLog("Scanning stopped.");
    saveState();
  }

  function togglePause() {
    state.isPaused = !state.isPaused;
    updateUIForScanning();
    addToLog(state.isPaused ? "Paused." : "Resumed.");
    saveState();
  }

  function updateUIForScanning() {
    if (!state.root) return;
    const startBtn = state.root.querySelector("#qa-start-auto") || state.root.querySelector("#qa-start-pilot") || state.root.querySelector("#qa-solve-btn");
    const stopBtn = state.root.querySelector("#qa-stop-btn");
    const pauseBtn = state.root.querySelector("#qa-pause-btn");
    const textarea = state.root.querySelector(".qa-textarea");

    if (state.isScanning) {
      if (startBtn) startBtn.style.display = "none";
      if (stopBtn) stopBtn.style.display = "block";
      if (pauseBtn) {
        pauseBtn.style.display = "block";
        pauseBtn.textContent = state.isPaused ? "Resume" : "Pause";
      }
      if (textarea) textarea.disabled = true;
      setBadge(state.isPaused ? "Paused" : "Scanning", state.isPaused ? "idle" : "active");
    } else {
      if (startBtn) startBtn.style.display = "block";
      if (stopBtn) stopBtn.style.display = "none";
      if (pauseBtn) pauseBtn.style.display = "none";
      if (textarea) textarea.disabled = false;
      setBadge("Idle", "idle");
    }
  }

  function setBadge(text, type = "idle") {
    const badge = state.root?.querySelector("#qa-badge");
    if (!badge) return;
    badge.textContent = text;
    badge.className = `qa-badge qa-badge-${type}`;
  }

  function addToLog(msg, type = "info") {
    const container = state.root?.querySelector("#qa-log-container");
    const logEl = state.root?.querySelector("#qa-log");
    if (!logEl || !container) return;

    container.style.display = "block";
    const entry = document.createElement("div");
    entry.className = `qa-log-entry qa-log-${type}`;
    entry.textContent = `> ${msg}`;
    logEl.prepend(entry);

    if (logEl.childNodes.length > 50) logEl.lastChild.remove();
  }

  // --- Scanning & Action Execution ---

  async function scanLoop() {
    if (!state.isScanning) return;
    if (state.isPaused || state.isWorking) {
      setTimeout(scanLoop, 1000);
      return;
    }

    state.isWorking = true;
    setBadge("Thinking", "thinking");

    try {
      const interactables = gatherInteractables();
      if (state.mode === "pilot") {
        await executePilotStep(interactables);
      } else if (state.mode === "auto") {
        await offerAutoStep(interactables);
      }
    } catch (e) {
      console.error("Page QA Sidebar: Scan loop error:", e);
      addToLog("Scan error, retrying...", "error");
    } finally {
      state.isWorking = false;
      if (state.isScanning) {
        if (!state.isPaused) setBadge("Scanning", "active");
        setTimeout(scanLoop, state.scanInterval);
      }
    }
  }

  async function executePilotStep(taskData) {
    const result = await askGroqForAction(taskData);
    if (!result.ok) {
      addToLog(`Error: ${result.error}`, "error");
      return;
    }

    const plan = result.plan;
    if (plan.action === "done") {
      addToLog("Goal reached! Pilot deactivated.", "success");
      stopScanning();
      return;
    }

    if (plan.action === "wait") {
      addToLog("Waiting for page change...");
      return;
    }

    if (plan.action === "refuse") {
      addToLog(`Pilot stuck: ${plan.reason}`, "error");
      stopScanning();
      return;
    }

    const success = await applyActionWithRetry(plan);
    if (success) {
      addToLog(`${plan.action.toUpperCase()}: ${plan.reason || "Executed"}`, "success");
      state.actionHistory.push(`${plan.action} on ${plan.targetId}: ${plan.reason}`);
      saveState();
    } else {
      addToLog(`Failed to execute ${plan.action}`, "error");
    }
  }

  async function offerAutoStep(taskData) {
    const responseEl = state.root.querySelector("#qa-response");
    if (!responseEl) return;
    
    responseEl.style.display = "block";
    responseEl.textContent = "Analyzing...";

    const result = await askGroqForAction(taskData);
    if (result.ok) {
      const plan = result.plan;
      responseEl.innerHTML = "";

      const title = document.createElement("div");
      title.style.fontWeight = "600";
      title.style.marginBottom = "4px";
      title.textContent = `Suggestion: ${plan.action.toUpperCase()}`;

      const reason = document.createElement("div");
      reason.style.fontSize = "0.85rem";
      reason.style.marginBottom = "8px";
      reason.textContent = plan.reason;

      const applyBtn = document.createElement("button");
      applyBtn.className = "qa-primary-btn";
      applyBtn.textContent = "Execute Action";
      applyBtn.onclick = () => {
        applyAction(plan);
        responseEl.style.display = "none";
      };

      responseEl.appendChild(title);
      responseEl.appendChild(reason);
      responseEl.appendChild(applyBtn);
    } else {
      responseEl.textContent = "Could not get suggestion.";
    }
  }

  async function onManualSolve() {
    const btn = state.root.querySelector("#qa-solve-btn");
    const responseEl = state.root.querySelector("#qa-response");
    if (!btn || !responseEl) return;

    btn.disabled = true;
    btn.textContent = "Thinking...";

    const interactables = gatherInteractables();
    const result = await askGroqForAction(interactables);
    
    btn.disabled = false;
    btn.textContent = "Scan & Solve";

    if (result.ok) {
      const plan = result.plan;
      responseEl.style.display = "block";
      responseEl.innerHTML = "";

      const title = document.createElement("div");
      title.style.fontWeight = "600";
      title.style.marginBottom = "4px";
      title.textContent = `Plan: ${plan.action.toUpperCase()}`;

      const reason = document.createElement("div");
      reason.style.fontSize = "0.85rem";
      reason.style.marginBottom = "8px";
      reason.textContent = plan.reason;

      const applyBtn = document.createElement("button");
      applyBtn.className = "qa-primary-btn";
      applyBtn.textContent = "Apply";
      applyBtn.onclick = () => {
        applyAction(plan);
        responseEl.style.display = "none";
      };

      responseEl.appendChild(title);
      responseEl.appendChild(reason);
      responseEl.appendChild(applyBtn);
    }
  }

  async function applyActionWithRetry(plan, retries = 2) {
    for (let i = 0; i <= retries; i++) {
      if (applyAction(plan)) return true;
      if (i < retries) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    return false;
  }

  function applyAction(plan) {
    try {
      const target = state.interactablesMap.get(plan.targetId);

      if (!target && !["wait", "done", "scroll", "refuse"].includes(plan.action)) {
        return false;
      }

      if (target) {
        highlightElement(target);
        target.scrollIntoView({ block: "center", behavior: "smooth" });
      }

      // Simulation of user events for better compatibility
      const triggerEvents = (el, types) => {
        types.forEach(type => {
          let event;
          if (type.startsWith("mouse") || type === "click") {
            event = new MouseEvent(type, { bubbles: true, cancelable: true, view: window });
          } else if (type.startsWith("key")) {
            event = new KeyboardEvent(type, { bubbles: true, cancelable: true, key: plan.key || "Enter" });
          } else {
            event = new Event(type, { bubbles: true });
          }
          el.dispatchEvent(event);
        });
      };

      switch(plan.action) {
        case "click":
        case "check":
          target.focus();
          triggerEvents(target, ["mousedown", "mouseup", "click"]);
          return true;
        case "type":
          target.focus();
          target.value = plan.text;
          triggerEvents(target, ["input", "change"]);
          return true;
        case "select":
          target.focus();
          const options = Array.from(target.options);
          const val = (plan.optionText || plan.text || "").toLowerCase();
          const best = options.find(o => o.text.toLowerCase().includes(val) || o.value.toLowerCase().includes(val)) || options[0];
          target.value = best.value;
          triggerEvents(target, ["change"]);
          return true;
        case "scroll":
          const amount = plan.direction === "up" ? -window.innerHeight * 0.7 : window.innerHeight * 0.7;
          window.scrollBy({ top: amount, behavior: "smooth" });
          return true;
        case "hover":
          triggerEvents(target, ["mouseover", "mouseenter"]);
          return true;
        case "key":
          target.focus();
          triggerEvents(target, ["keydown", "keypress", "keyup"]);
          return true;
        case "wait":
        case "done":
          return true;
        default:
          return false;
      }
    } catch (e) {
      console.error("Page QA Sidebar: Action execution failed", e);
      return false;
    }
  }

  function highlightElement(el) {
    const originalOutline = el.style.outline;
    el.style.outline = "3px solid var(--qa-primary)";
    el.style.outlineOffset = "2px";
    setTimeout(() => {
      if (el && el.isConnected) el.style.outline = originalOutline;
    }, 2000);
  }

  function gatherInteractables() {
    state.interactablesMap.clear();
    const choices = [];
    const elements = document.querySelectorAll("input, textarea, select, button, a, [role='button'], [role='link'], summary");

    Array.from(elements).forEach((el) => {
      if (!isInteractable(el)) return;

      let id = state.elementIdsMap.get(el);
      if (!id) {
        id = `el_${state.idCounter++}`;
        state.elementIdsMap.set(el, id);
      }
      state.interactablesMap.set(id, el);

      let text = "";
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        const label = document.querySelector(`label[for="${el.id}"]`) || el.closest("label");
        text = `[${el.type || 'text'}] ${label?.innerText || el.placeholder || el.name || 'Input'}`;
      } else if (el.tagName === "SELECT") {
        const label = document.querySelector(`label[for="${el.id}"]`) || el.closest("label");
        text = `[select] ${label?.innerText || el.name || 'Dropdown'}`;
      } else {
        text = `[${el.tagName.toLowerCase()}] ${el.innerText || el.value || el.title || el.ariaLabel || 'Interactable'}`;
      }

      choices.push({ choiceId: id, text: text.trim().slice(0, 200) });
    });

    return { 
      choices: choices.slice(0, 100),
      pageTitle: document.title,
      visibleText: document.body.innerText.slice(0, 8000)
    };
  }

  function isInteractable(el) {
    if (el.closest("#page-qa-root")) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    // Check if it's within viewport roughly
    if (rect.bottom < 0 || rect.top > window.innerHeight) return false;

    return true;
  }

  async function askGroqForAction(taskData) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: "ASK_GROQ_ACTION",
        payload: {
          ...taskData,
          userPrompt: state.autoPrompt,
          history: state.actionHistory
        }
      }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(resp || { ok: false, error: "No response from background script" });
        }
      });
    });
  }

  // --- Initializers ---

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "OPEN_UI") {
      toggleSidebar();
    }
  });

  loadState();

})();
