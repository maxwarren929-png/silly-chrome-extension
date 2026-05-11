# Page QA Sidebar (Pilot Pro)

An autonomous and assisted web navigation agent powered by Groq.

## Features

- **Pilot Mode**: Fully autonomous agent. Give it a goal (e.g., "Add the cheapest laptop to my cart"), and it will navigate and interact with the page until the task is complete.
- **Auto Mode**: Real-time suggestions. As you browse, the agent suggests the most logical next action based on your general rules.
- **Manual Mode**: Point-and-solve. Highlight an element or describe a specific task for the AI to handle.
- **Persistent State**: Remembers your goal and action history across page reloads.
- **Activity Log**: Real-time feedback on what the agent is thinking and doing.

## Installation

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder.

## Configuration

1. Go to **Extension options** (right-click icon or via `chrome://extensions`).
2. Paste your **Groq API Key**.
3. Select your preferred **Llama 3** or **Mixtral** model.
4. Click **Save Key**.

## Usage

1. Open any webpage.
2. Click the extension icon to toggle the sidebar.
3. Choose a mode:
   - **Manual**: Enter a specific instruction and click "Scan & Solve".
   - **Auto**: Enter general rules, set an interval, and click "Start Auto-Assist".
   - **Pilot**: Enter a high-level goal and click "Activate Pilot".
4. Monitor the **Activity Log** at the bottom for progress and errors.

## Technical Details

- **Manifest V3**: Uses modern Chrome extension standards.
- **Background Service Worker**: Handles all API communication with Groq.
- **Content Script**: Manages UI, scans for interactable elements (inputs, buttons, links), and simulates user events for high compatibility.
- **Safety**: Uses a `WeakMap` for stable element identification and includes safety guards to prevent infinite loops.
