const apiKeyInput = document.getElementById("apiKey");
const modelSelect = document.getElementById("selectedModel");
const interfaceModeSelect = document.getElementById("interfaceMode");
const saveBtn = document.getElementById("saveBtn");
const status = document.getElementById("status");

init();

async function init() {
  const { apiKey, selectedModel, interfaceMode } = await chrome.storage.sync.get(["apiKey", "selectedModel", "interfaceMode"]);
  if (apiKey) {
    apiKeyInput.value = apiKey;
  }
  if (selectedModel) {
    modelSelect.value = selectedModel;
  }
  if (interfaceMode) {
    interfaceModeSelect.value = interfaceMode;
  }
}

saveBtn.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  const selectedModel = modelSelect.value;
  const interfaceMode = interfaceModeSelect.value;
  await chrome.storage.sync.set({ apiKey, selectedModel, interfaceMode });
  status.textContent = "Settings saved!";
  status.style.color = "#10b981";
  setTimeout(() => {
    status.textContent = "";
  }, 2000);
});
