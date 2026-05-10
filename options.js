const apiKey1Input = document.getElementById("apiKey1");
const apiKey2Input = document.getElementById("apiKey2");
const apiKey3Input = document.getElementById("apiKey3");
const modelSelect = document.getElementById("selectedModel");
const interfaceModeSelect = document.getElementById("interfaceMode");
const saveBtn = document.getElementById("saveBtn");
const status = document.getElementById("status");

init();

async function init() {
  const { apiKey1, apiKey2, apiKey3, apiKey, selectedModel, interfaceMode } = await chrome.storage.sync.get(["apiKey1", "apiKey2", "apiKey3", "apiKey", "selectedModel", "interfaceMode"]);
  if (apiKey1) apiKey1Input.value = apiKey1;
  else if (apiKey) apiKey1Input.value = apiKey; // Migration from old single key

  if (apiKey2) apiKey2Input.value = apiKey2;
  if (apiKey3) apiKey3Input.value = apiKey3;

  if (selectedModel) {
    modelSelect.value = selectedModel;
  }
  if (interfaceMode) {
    interfaceModeSelect.value = interfaceMode;
  }
}

saveBtn.addEventListener("click", async () => {
  const apiKey1 = apiKey1Input.value.trim();
  const apiKey2 = apiKey2Input.value.trim();
  const apiKey3 = apiKey3Input.value.trim();
  const selectedModel = modelSelect.value;
  const interfaceMode = interfaceModeSelect.value;
  await chrome.storage.sync.set({ apiKey1, apiKey2, apiKey3, selectedModel, interfaceMode });
  status.textContent = "Settings saved!";
  status.style.color = "#10b981";
  setTimeout(() => {
    status.textContent = "";
  }, 2000);
});
