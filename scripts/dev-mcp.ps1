# Launches the app with the WebView2 remote-debugging port open so the
# Playwright MCP configured in .mcp.json can attach to the RUNNING app
# (real Tauri IPC + SQLite underneath) to inspect, click, and screenshot.
#
# Port 9223 must match the --cdp-endpoint in .mcp.json.
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9223 --remote-allow-origins=*"
$env:Path += ";$env:USERPROFILE\.cargo\bin"
pnpm tauri dev
