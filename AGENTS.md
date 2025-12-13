# AGENTS.md - Development Guide for OCPP CSMS Simulator

## Build/Run Commands
- **Start server**: `npm start` or `node server.js`
- **Install dependencies**: `npm install`
- **No tests configured**: This project currently has no automated test suite
- **Database**: Requires MySQL server running on localhost with `ocpp_csms` database

## Mobile App Build
- **Location**: `mobile-app/` directory
- **Build Android**: See `mobile-app/ANDROID_BUILD_NOTES.md` for manual steps
- **Version Management**: To prepare for a new Android build, update version in these files:
  1. `mobile-app/tauri.conf.json` - Update `version` field (line 4) - e.g., "0.1.17"
  2. `mobile-app/Cargo.toml` - Update `version` field (line 3) - should match tauri.conf.json
  3. Commit the version changes
  4. Create and push git tag: `git tag v0.1.17 && git push --tags`
  5. **IMPORTANT**: Push the commits too: `git push origin main` (tags don't push the code!)
  6. Android build automatically uses version from tauri.conf.json for versionName
  7. versionCode in Android is auto-incremented via `tauri.properties` file

## Project Structure
- **Backend**: Node.js (server.js) spawns Python handlers (OCPP_handler.py) for each charge point
- **Frontend**: Vanilla JavaScript in `public/` directory (dashboard, SCADA, customer views)
- **Mobile App**: Tauri-based mobile app in `mobile-app/` directory with QR scanning and OCPP client
- **Database**: MySQL with connection pooling (database.js)
- **OPC UA Server**: Runs on port 4840 for industrial automation integration

## Code Style
- **Language**: Mixed Node.js/JavaScript and Python
- **Naming**: camelCase for JS variables/functions; snake_case for Python; SCREAMING_SNAKE_CASE for constants
- **Comments**: Vietnamese comments throughout codebase (maintain this convention)
- **Error handling**: Use try-catch blocks; log errors to console with descriptive prefixes like `[Master]`, `[OPC UA]`, `[Database]`, `[Python]`
- **No linter/formatter**: No ESLint, Prettier, or Python linters configured
- **Types**: Plain JavaScript (no TypeScript); no JSDoc or type annotations

## Key Patterns
- WebSocket communication between charge points, dashboards, and server
- Python child processes handle OCPP message logic; Node.js handles routing and state management
- OPC UA nodes created dynamically per charge point with bindVariable for remote control
- Broadcast pattern: `broadcastToDashboards()` sends updates to all connected dashboard clients
- State management: In-memory Maps (`clients.chargePoints`, `clients.dashboards`)
