const apiKeyInput = document.getElementById("apiKey");
const saveBtn = document.getElementById("saveBtn");
const status = document.getElementById("status");

init();

async function init() {
  const { apiKey } = await chrome.storage.sync.get(["apiKey"]);
  if (apiKey) {
    apiKeyInput.value = apiKey;
  }
}

saveBtn.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  await chrome.storage.sync.set({ apiKey });
  status.textContent = "Settings saved!";
  status.style.color = "#10b981";
  setTimeout(() => {
    status.textContent = "";
  }, 2000);
});
