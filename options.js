const apiKeyInput = document.getElementById("apiKey");
const modelSelect = document.getElementById("selectedModel");
const saveBtn = document.getElementById("saveBtn");
const status = document.getElementById("status");

init();

async function init() {
  const { apiKey, selectedModel } = await chrome.storage.sync.get(["apiKey", "selectedModel"]);
  if (apiKey) {
    apiKeyInput.value = apiKey;
  }
  if (selectedModel) {
    modelSelect.value = selectedModel;
  }
}

saveBtn.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  const selectedModel = modelSelect.value;
  await chrome.storage.sync.set({ apiKey, selectedModel });
  status.textContent = "Settings saved!";
  status.style.color = "#10b981";
  setTimeout(() => {
    status.textContent = "";
  }, 2000);
});
