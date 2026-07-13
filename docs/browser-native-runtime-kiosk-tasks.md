# Browser Native Runtime Adapter and Kiosk Bridge Tasks

Kiosk plus a localhost bridge is the sensible next route, especially since it preserves the existing browser workflow and avoids committing to Electron or Tauri before benchmarking the CM5.

The target shape:

```text
Browser / Chromium kiosk
        ↓ WebSocket
BrowserSocketNativeRuntimeTransport
        ↓
native-runtime-server
        ↓
NodeNativeRuntimeTransport
        ↓
engine-host
        ↓
native audio engine
```

Below is the implementation order.

# Milestone: browser-native runtime adapter

## Task 1 - Define the socket protocol

Create a browser-safe request/response envelope shared by the client and local server.

Suggested location:

```text
packages/playback/src/native/NativeRuntimeSocketProtocol.ts
```

Start with:

```ts
export interface NativeRuntimeSocketRequest {
  requestId: number;
  method:
    | "runtime:start"
    | "plan:prepare"
    | "plan:activate"
    | "engine:commands"
    | "engine:snapshot"
    | "audio:stop"
    | "runtime:dispose";
  params?: unknown;
}

export interface NativeRuntimeSocketSuccess {
  requestId: number;
  ok: true;
  result: unknown;
}

export interface NativeRuntimeSocketFailure {
  requestId: number;
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
```

Unsolicited events should remain separate:

```ts
export interface NativeRuntimeSocketEvent {
  type:
    | "runtime:event"
    | "audio:event"
    | "engine:event"
    | "runtime:status";
  payload: unknown;
}
```

Acceptance criteria:

- requests are correlated by `requestId`
- failures are structured
- unsolicited events cannot be mistaken for responses
- protocol version is included in the initial handshake
- browser package contains no Node imports

---

## Task 2 - Add `BrowserSocketNativeRuntimeTransport`

Create:

```text
packages/playback/src/native/BrowserSocketNativeRuntimeTransport.ts
```

It should implement the existing `NativeRuntimeTransport`.

Responsibilities:

```text
WebSocket lifecycle
request ID allocation
pending promise map
JSON parsing
structured error conversion
unexpected disconnect handling
connection timeout
dispose cleanup
```

Suggested usage:

```ts
const transport = new BrowserSocketNativeRuntimeTransport({
  url: "ws://127.0.0.1:43127/native-runtime",
  token,
});
```

Important behaviors:

- reject all pending requests if the socket closes
- ignore or report unknown response IDs
- fail clearly if the bridge is unavailable
- never silently fall back to WebAudio
- make `dispose()` idempotent
- prevent commands before handshake completion

Tests:

- successful handshake
- request/response correlation
- out-of-order responses
- structured failure
- unsolicited event delivery
- unexpected disconnect
- duplicate start
- idempotent disposal

---

## Task 3 - Create the localhost runtime server package

Add a host-only workspace:

```text
packages/native-runtime-server/
  src/
    server.ts
    NativeRuntimeSocketSession.ts
    protocolValidation.ts
    index.ts
  tests/
```

This package may use:

```text
node:http
WebSocket server library
@sequencer/native-runtime-node
```

Its ownership should be:

```text
WebSocket session
→ NativeRuntimeManager
→ NodeNativeRuntimeTransport
→ engine-host
```

Expose only the typed runtime operations:

```text
start
preparePlan
activatePlan
sendCommands
getSnapshot
stopAudio
dispose
```

Do not expose:

```text
process spawning
filesystem paths
raw stdio
arbitrary host commands
generic method invocation
```

---

## Task 4 - Add one runtime manager per socket owner

Initially, allow one connected controlling client.

Suggested rules:

```text
first authenticated client
    becomes runtime owner

second client
    receives RuntimeAlreadyOwned

owner disconnects
    engine is disposed after a short grace period
```

A simple server state:

```ts
interface RuntimeServerState {
  ownerConnectionId?: string;
  manager?: NativeRuntimeManager;
}
```

Avoid allowing multiple browser tabs to independently start audio engines.

Later you could support:

```text
one controlling client
multiple read-only monitoring clients
```

but that is unnecessary now.

---

## Task 5 - Add protocol validation

Validate every message at the server boundary.

At minimum:

```text
known method
valid requestId
valid start options
valid plan shape
valid activation handle
bounded command batch size
bounded message size
```

Limits should be explicit:

```ts
const MAX_SOCKET_MESSAGE_BYTES = 2 * 1024 * 1024;
const MAX_COMMANDS_PER_BATCH = 4096;
const MAX_PENDING_REQUESTS = 256;
```

Rust remains the final authority for execution-plan correctness, but the socket server should reject obviously malformed or abusive messages before forwarding them.

---

## Task 6 - Secure the localhost bridge

Bind only to loopback:

```text
127.0.0.1
```

Do not use:

```text
0.0.0.0
```

Add a random startup token.

For example, the server prints or writes:

```text
http://127.0.0.1:43127/?nativeToken=<random>
```

The socket handshake includes:

```json
{
  "protocolVersion": 1,
  "token": "..."
}
```

Also validate browser origin:

```text
http://127.0.0.1:<ui-port>
http://localhost:<ui-port>
```

For kiosk deployment, ideally serve the UI and WebSocket from the same local server. That removes most origin complexity.

---

## Task 7 - Serve the built UI from the same process

Extend `native-runtime-server` to serve:

```text
apps/ui/dist/
```

Recommended production shape:

```text
GET /
    Svelte application

GET /assets/*
    static UI assets

WS /native-runtime
    native runtime protocol
```

Then Chromium only needs:

```text
http://127.0.0.1:43127
```

Benefits:

- one local port
- same-origin WebSocket
- simpler token handling
- no separate static server
- easier kiosk startup

For development, keep Vite separate and connect to the local WebSocket service.

---

## Task 8 - Update runtime transport selection

Extend application transport selection:

```ts
function createNativeRuntimeTransport(): NativeRuntimeTransport {
  if (globalThis.nativeRuntime) {
    return new RendererNativeRuntimeTransport();
  }

  const socketUrl = import.meta.env.VITE_NATIVE_RUNTIME_WS;

  if (socketUrl) {
    return new BrowserSocketNativeRuntimeTransport({
      url: socketUrl,
    });
  }

  throw new NativeRuntimeUnavailableError(
    "Native playback requires the desktop bridge or local runtime server.",
  );
}
```

For development:

```text
VITE_PLAYBACK_BACKEND=native
VITE_NATIVE_RUNTIME_WS=ws://127.0.0.1:43127/native-runtime
npm run dev -w apps/ui
```

For kiosk production, detect same-origin automatically:

```ts
const socketUrl =
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/native-runtime`;
```

In Vite development, do not use the same-origin default because that points at
the Vite dev server, not `native-runtime-server`. Use the explicit socket URL
instead:

```text
npm run dev:native-runtime
```

Then start the UI and open the exact Vite URL printed by the runtime server,
for example:

```text
http://localhost:5173/?nativeToken=<actual printed token>
```

Do not use the literal `<token>` placeholder. The server also prints an
environment-variable form:

```text
VITE_NATIVE_RUNTIME_WS=ws://127.0.0.1:43127/native-runtime \
VITE_NATIVE_RUNTIME_TOKEN=<actual printed token> \
npm run dev -w apps/ui
```

If same-origin discovery is needed during development, opt in with
`VITE_NATIVE_RUNTIME_SAME_ORIGIN=true`.

---

## Task 9 - Add runtime server commands

Suggested scripts:

```json
{
  "scripts": {
    "dev": "node --experimental-transform-types src/index.ts",
    "start": "node dist/index.js",
    "test": "node --test tests/*.test.ts"
  }
}
```

Root workspace scripts:

```json
{
  "scripts": {
    "dev:native-runtime": "npm run dev -w packages/native-runtime-server",
    "dev:ui-native": "VITE_PLAYBACK_BACKEND=native VITE_NATIVE_RUNTIME_WS=ws://127.0.0.1:43127/native-runtime npm run dev -w apps/ui"
  }
}
```

Eventually add a combined development command, but keep services individually runnable first.

---

## Task 10 - Add a deterministic null-driver browser smoke test

The first end-to-end browser smoke should use the null driver:

```text
browser transport
→ WebSocket server
→ NativeRuntimeManager
→ Node transport
→ engine-host
→ null driver
```

Test sequence:

```text
connect
start runtime
compile real minimal plan
activate plan
submit tempo/loop/clip schedule
start transport
request snapshot
verify sample position advances
stop
dispose
```

This should run without audio hardware.

Acceptance checks:

- active plan ID/revision matches
- transport becomes playing
- sample position advances
- clip schedule batch is accepted
- stop clears transport
- dispose shuts down `engine-host`

---

## Task 11 - Add a CPAL development smoke

Status: complete.

Make it opt-in:

```text
NATIVE_BROWSER_SMOKE=1 \
NATIVE_BROWSER_SMOKE_DRIVER=cpal \
npm run smoke:browser-native
```

It should:

- start CPAL
- activate the real minimal plan
- schedule a short clip or tone
- run for a bounded duration
- stop and dispose
- skip cleanly when no device is available

Do not make CPAL hardware availability mandatory for the normal test suite.

Implemented as `npm run smoke:browser-native`, which delegates to the
native-runtime-server smoke. The normal server test suite includes the file but
skips CPAL unless `NATIVE_BROWSER_SMOKE=1` is set. `NATIVE_BROWSER_SMOKE_DRIVER`
can be set to `cpal` for hardware validation or `null` for deterministic
verification of the same browser/socket/native-host path.

---

## Task 12 - Add reconnect and crash behavior

Status: complete for the initial browser bridge policy.

Define these policies explicitly.

### Bridge unavailable at startup

UI status:

```text
Native runtime server unavailable
```

### Engine child crashes

Server:

```text
reject pending requests
publish runtime:status failed
dispose manager state
```

Browser:

```text
controller enters failed state
playback controls disabled
diagnostic message displayed
```

### Browser reload

Recommended first policy:

```text
socket disconnect
→ short grace period, perhaps 2 seconds
→ dispose native engine if no reconnect
```

A grace period avoids restarting the audio engine on every Vite hot reload.

The server now keeps the owner-disconnect grace policy and publishes a
`runtime:status` failed event before the correlated request failure when an
owned runtime request fails unexpectedly. Expected control-plane rejections,
such as protocol validation, not-started, or already-owned errors, remain
structured request failures without marking the runtime failed.

---

## Task 13 - Add service-level health endpoint

Status: complete.

Expose:

```text
GET /health
```

Response:

```json
{
  "ok": true,
  "protocolVersion": 1,
  "runtimeOwned": true,
  "engineRunning": true
}
```

This will be useful later for:

```text
systemd health checks
startup scripts
kiosk launch ordering
diagnostics
```

`GET /health` is served independently from the static UI directory, so startup
checks can run before the browser bundle is present.

---

# CM5 deployment tasks

These can follow after the browser adapter works on macOS.

## Task 14 - Build the UI for production

```text
npm run build -w apps/ui
```

Package output with the runtime server.

Expected installation layout:

```text
/opt/sequencer/
  bin/
    engine-host
    native-runtime-server
  ui/
    index.html
    assets/
  config/
    runtime.json
```

---

## Task 15 - Add runtime configuration

Example:

```json
{
  "host": "127.0.0.1",
  "port": 43127,
  "audio": {
    "driver": "cpal",
    "sampleRate": 48000,
    "bufferFrames": 128,
    "channels": 2
  },
  "uiDirectory": "/opt/sequencer/ui"
}
```

Avoid relying on environment variables alone for the appliance.

---

## Task 16 - Add systemd service

Example responsibilities:

```text
start after sound and graphics availability
restart on failure
set working directory
set engine-host path
apply real-time scheduling permissions later
capture logs in journal
```

Conceptually:

```ini
[Unit]
Description=Sequencer Native Runtime
After=sound.target network.target

[Service]
ExecStart=/opt/sequencer/bin/native-runtime-server
WorkingDirectory=/opt/sequencer
Restart=on-failure
RestartSec=2

[Install]
WantedBy=multi-user.target
```

Do not tune real-time priorities until the core deployment works reliably.

---

## Task 17 - Add Chromium kiosk launch

Start Chromium after the health endpoint succeeds:

```text
wait for http://127.0.0.1:43127/health
launch Chromium kiosk
```

Typical shape:

```text
chromium \
  --kiosk \
  --app=http://127.0.0.1:43127 \
  --no-first-run \
  --disable-session-crashed-bubble
```

The exact flags should be tested on the target OS image.

---

## Task 18 - Add appliance recovery behavior

Define:

```text
runtime server restarts
    browser reconnects

browser crashes
    kiosk launcher restarts it

engine crashes
    server reports failure and restarts engine on explicit UI action initially

device missing
    UI shows audio startup diagnostics
```

Avoid an infinite rapid restart loop around a failing audio device.

---

# Recommended implementation sequence

Execute work in this order:

```text
1. Socket protocol types
2. BrowserSocketNativeRuntimeTransport
3. Local native runtime WebSocket server
4. NativeRuntimeManager integration
5. Null-driver Node integration test
6. Browser transport selection
7. Browser null-driver smoke test
8. Static UI serving
9. CPAL browser smoke
10. Disconnect/reconnect handling
11. Health endpoint
12. CM5 systemd packaging
13. Chromium kiosk startup
14. CM5 performance testing
```

## First commit boundary

A good first slice:

```text
BrowserSocketNativeRuntimeTransport
+ socket protocol
+ fake WebSocket server tests
```

Suggested commit:

```text
Add browser native runtime WebSocket transport
```

## Second commit boundary

```text
native-runtime-server
+ NativeRuntimeManager ownership
+ null-driver integration test
```

Suggested commit:

```text
Add localhost native runtime bridge server
```

## Third commit boundary

```text
UI transport selection
+ Vite-native development mode
+ end-to-end browser smoke
```

Suggested commit:

```text
Enable native runtime from browser development
```

## Definition of done

The adapter is genuinely running when:

```text
Vite UI opens in a normal browser.
Native backend is explicitly selected.
Browser connects to localhost runtime server.
Runtime server launches engine-host.
A real PlaybackModel plan compiles and activates.
A MIDI clip schedule is submitted.
Native transport starts.
Runtime snapshots drive the browser playhead.
Stop and live schedule replacement work.
Browser reload does not leave orphan processes.
No Node APIs enter the browser bundle.
The same transport works from Chromium kiosk later.
```

This route gives you the development convenience of a browser today and the same fundamental deployment shape likely needed on the CM5.
