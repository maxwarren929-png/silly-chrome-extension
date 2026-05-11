# AGENTS.md - Developer & Agent Guide

This file provides context for developers and AI agents working on the Page QA Sidebar extension.

## Architecture Overview

- `background.js`: The central hub for API requests. It keeps the Groq API key secure and handles the `fetch` calls. It also manages script injection.
- `content.js`: Injected into every page. It maintains the UI state, scans the DOM for interactable elements, and executes actions (click, type, etc.).
- `styles.css`: Scoped CSS for the sidebar UI.

## Key Concepts

### Interactable Scanning
The extension identifies elements that can be interacted with. It looks for:
- Standard form elements (`input`, `textarea`, `select`, `button`).
- Links (`a`).
- ARIA roles (`button`, `link`).
- Summaries.

It filters out invisible elements and those outside the current viewport (mostly) to focus the AI's attention.

### Action Execution
To maximize compatibility with modern web frameworks (React, Vue, etc.), the extension doesn't just call `.click()`. It dispatches a sequence of events:
- `mousedown` -> `mouseup` -> `click`
- `input` -> `change`
- `keydown` -> `keypress` -> `keyup`

### State Persistence
State is saved to `chrome.storage.local` keyed by the current URL. This allows the Pilot to continue working after a page navigation or refresh.

## Coding Standards
- Use JSDoc for all functions.
- Keep the UI responsive; do not block the main thread.
- Use the `state` object in `content.js` rather than global variables for better organization.
- Always verify syntax with `node -c <file>.js` before submitting.

## Planned Improvements
- Support for iframe interaction.
- Better handling of complex dropdowns and custom components.
- Multi-tab task coordination.
