# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AesyClaw is a lightweight AI Agent framework written in TypeScript. It connects to messaging platforms (OneBot/QQ) and provides an AI assistant through LLM providers. Features include a plugin system, session management, MCP support, and cron jobs.

## Common Commands

```bash
# Development
npm run dev              # Run in watch mode
npm run dev:webui       # Run Vue frontend in dev mode
npm run build           # Build TypeScript
npm run build:webui     # Build Vue frontend

# Running
npm start               # Start production server
npm run start:all      # Start all services (gateway + API + WebUI)
npm run start:gateway  # Start gateway service only
npm run start:api      # Start API server only
npm run start:webui    # Start WebUI only

# Management
npm run stop           # Stop services
npm run restart        # Restart services
npm run status         # Check service status

# Testing
npm test               # Run all tests
npm run test:watch    # Run tests in watch mode
npm run test:coverage # Run tests with coverage
```

## Architecture

### Core Flow

```
OneBot Channel → EventBus → AgentLoop → LLM Provider
                    ↓              ↓
              SessionManager   ToolRegistry
                    ↓
               SQLite DB
```

1. **OneBotChannel** receives messages via WebSocket, parses them, and publishes to EventBus
2. **AgentLoop** consumes messages, builds context, calls LLM, executes tools
3. **ToolRegistry** manages tools (built-in + plugins + MCP)
4. **SessionManager** persists conversation history in SQLite
5. **PluginManager** hooks into message flow at multiple points

### Key Modules

| Module | Purpose |
|--------|---------|
| `src/agent/AgentLoop.ts` | Main agent loop, LLM calls, tool execution |
| `src/channels/OneBotChannel.ts` | WebSocket connection to OneBot, message parsing |
| `src/plugins/PluginManager.ts` | Plugin lifecycle, command matching, hooks |
| `src/session/SessionManager.ts` | SQLite-backed session storage |
| `src/tools/ToolRegistry.ts` | Tool registration and execution |
| `src/mcp/MCPClient.ts` | MCP protocol client for external tools |
| `src/api/server.ts` | REST API for WebUI |
| `src/bootstrap/` | Service initialization and lifecycle |

### Plugin System

Plugins can hook into the message pipeline:

- `onMessage(msg)` - Transform incoming message
- `onResponse(msg)` - Transform outgoing message
- `onAgentBefore/After` - Modify LLM context
- `onBeforeToolCall/onToolCall` - Modify tool params/result
- Commands with matchers (regex, prefix, exact, contains)

### Configuration

All config is in `config.yaml`:
- Server ports (main, API, WebUI)
- Agent defaults (model, provider, max iterations, memory window)
- Channel settings (OneBot WebSocket URL, token)
- LLM providers (API keys, base URLs)
- MCP servers
- Plugin enablement and options

## Development Notes

- Project uses ES modules (`"type": "module"`)
- Plugins are loaded from `plugins/` directory as separate modules with `main.js`
- Agent supports three context modes: `session` (new per chat), `channel` (shared per channel:chat), `global` (single global session)
- Tool names with `:` are converted to `_mcp_` for execution (e.g., `mcp:tool` → `mcp_tool`)
- WebUI communicates with backend via REST API on configured port
