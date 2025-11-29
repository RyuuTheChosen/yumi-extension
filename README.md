# Yumi Chrome Extension

> **Status**: Deployed - requires activation via Discord invite code

Chrome Extension (MV3) for the Yumi AI Web Companion.

**Links**: [Discord](https://discord.gg/QPmrJS8baz) | [Website](https://yumi-pals.com)

---

## Security & Transparency

This source code is published for transparency so users and security researchers can audit what runs in their browser.

### What We Collect
- **Nothing sent without auth**: Extension requires Discord activation
- **No telemetry**: We don't track usage or collect analytics
- **Local-first**: Messages and memories stay in your browser (IndexedDB)

### Permissions Explained

| Permission | Why |
|------------|-----|
| `storage` | Save settings, auth tokens, installed companions |
| `contextMenus` | Right-click menu for vision features |
| `activeTab` | Access current page for context extraction |
| `host_permissions` | Communicate with AI provider APIs through Hub |

### Reporting Security Issues
If you find a security vulnerability, please email security@yumi-pals.com or open a GitHub issue.

---

## Quick Start

```bash
npm install
npm run build
```

Load `dist/` as unpacked extension in `chrome://extensions` (Developer mode).

## Development

```bash
npm run dev      # Development build with watch
npm run build    # Production build
npx tsc --noEmit # Type checking
```

## Build Targets

The extension uses 4 separate Vite builds:

| Target | Output | Purpose |
|--------|--------|---------|
| Prelude | IIFE | Sets up `Module.locateFile` for Cubism WASM |
| Content | IIFE | Main overlay with React, Live2D, chat UI |
| Popup | ES modules | Settings panel with code splitting |
| Background | ES modules | Service worker for AI streaming |

## Structure

```
src/
├── background/
│   ├── index.ts              # AI streaming, memory extraction
│   └── externalMessaging.ts  # Website-extension communication
├── content/
│   ├── index.ts              # Bootstrap, Hub auth gating
│   ├── ChatOverlay.tsx       # Main chat UI
│   ├── overlayAvatar.ts      # Live2D avatar + lip sync
│   ├── LipSyncController.ts  # Audio analysis for mouth movement
│   └── components/           # React UI components
├── lib/
│   ├── companions/           # Companion install/load system
│   ├── memory/               # Memory extraction and retrieval
│   ├── tts/                  # ElevenLabs TTS integration
│   ├── stores/               # Zustand stores (settings, chat, personality)
│   ├── bus.ts                # Event bus for streaming/avatar events
│   └── errors.ts             # Error taxonomy
├── popup/
│   └── components/           # Settings panel UI
└── styles/
    └── tailwind.css
```

## Features

### Hub Connection
- Requires Yumi Hub activation (Discord invite code)
- Avatar only displays when authenticated
- All AI requests route through Hub API (https://historic-tessy-yumi-labs-d3fc2b1c.koyeb.app)

### Live2D Avatar
- Cubism 4 SDK integration via WASM
- Expression system (happy, sad, thinking, etc.)
- Lip sync via Web Audio API analysis
- Eye tracking and idle animations

### Memory System
- AI-powered extraction from conversations (5 min interval)
- TF-IDF weighted retrieval
- Jaccard similarity deduplication
- Decay-based importance scoring

### Page Context
- Extracts current page content before each message
- 4-level extraction (URL/title → full content → site-specific)
- Privacy blacklist (banking, health, email sites)
- Enables Yumi to see and discuss the current page

### TTS (Text-to-Speech)
- ElevenLabs WebSocket streaming (~300ms latency)
- Integrated lip sync with avatar
- User provides own API key (encrypted storage)

### Companion System
- Install companions from marketplace
- Bundled 'yumi' as default fallback
- IndexedDB storage for installed companions
- SHA256 checksum verification

## Storage

| Storage | Data |
|---------|------|
| Chrome Storage | Settings, auth tokens, personality |
| IndexedDB | Messages, memories, installed companions |
| Session Storage | Active scope, cleared flags |

## Messaging

Port-based streaming for persistent connections:

```typescript
const port = chrome.runtime.connect({ name: 'yumi-chat' })
port.postMessage({ type: 'SEND_MESSAGE', payload: { text, scope } })
// Response types: STREAM_CHUNK, STREAM_END, STREAM_ERROR
```

## Environment

No `.env` file needed. All configuration is done through:
- Extension popup settings (Hub activation, TTS keys)
- Chrome Storage (persisted automatically)
