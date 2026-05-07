# Page QA Sidebar Chrome Extension

This extension adds a right sidebar that answers questions about the text currently visible in the browser viewport, using Groq.

## Features

- Sidebar UI toggled by clicking the extension icon
- Reads visible page text only
- Stateless Q&A (no chat memory between questions)
- Groq API key saved in extension settings
- Minimalist mode: auto-answer card in bottom-right corner

## Install

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder.

## Configure API Key

1. In `chrome://extensions`, find **Page QA Sidebar**.
2. Click **Details** then **Extension options**.
3. Paste your Groq API key and click **Save Key**.
4. Optional: switch **Interface Mode** to **Minimalist**.

## Use

1. Open any page.
2. Click the extension icon.
3. In **Sidebar** mode: type a question and click **Ask**.
4. In **Minimalist** mode: an automatic answer appears bottom-right.
