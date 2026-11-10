# Sama (सम · સમ)

A paced breathing rehearsal that reads your **live pulse and breathing rate from a webcam** with the Presage SmartSpectra SDK. UI in Hinglish, Hindi and Gujarati. Built for the DEV Presage SmartSpectra SDK Challenge.

General wellness only. Sama is not a medical device and makes no diagnosis, stress, or treatment claims. It only compares you with your own baseline from the same session.

## How the SmartSpectra SDK is used

SmartSpectra has no in-browser SDK, so Sama uses the **Node.js SDK** (`@smartspectra/node-sdk`) in a small local server:

1. The browser page opens your webcam (with consent) and sends small frames (320x240) over a local WebSocket to `server.js`.
2. `server.js` feeds them into the SDK with `useCustomInput()` + `sendFrame()`, requesting `cardioMetrics` and `breathingMetrics`.
3. The SDK sends back `metrics` (pulse rate, breathing rate, traces) and `validationStatus` events. These drive the signal-quality gate and the result screen.

Per the Presage docs, metric computation runs on-device inside the SDK. The SDK contacts Presage only to authenticate the API key and check the subscription.

## Run it

```bash
git clone <this repo> && cd sama
npm install
cp .env.example .env      # put your free key in SMARTSPECTRA_API_KEY
npm start                 # http://localhost:3000
```

Get a free key at https://physiology.presagetech.com/auth/register (100 free credits; 1 credit = 30 seconds of live measurement, so one full session of about 5.5 minutes uses roughly 11 credits).

Requirements: Node 20+, Linux x64/arm64, macOS arm64, or Windows x64 (the platforms the SDK ships), and a webcam. Open the page on `localhost` so the browser allows camera access.

**Demo mode** works with no key and no camera. It uses a clearly labelled simulated signal (sessions are saved with `source: "demo"`), so you can try the whole flow. Live sessions are saved with `source: "live-presage-sdk"`.

`?fast=1` on the URL shortens the timers (6 s baseline, 20 s rehearsal) for testing.

## Flow

1. **Consent** - explains camera use, data handling and the wellness-only scope. Nothing starts before you agree.
2. **Baseline (30 s)** - the timer only counts while the signal is good (face found, validation OK, enough confidence). If the signal drops, it pauses.
3. **5-minute rehearsal** - animated pacer with three patterns (Sama 5-5, Box 4-4-4-4, Shanti 4-2-6).
4. **Result** - rehearsal vs your own baseline (pulse, breathing rate) as "settled", "steady" or "active". No diagnosis.
5. **History** - saved in your browser, with JSON export (one or all) and delete (one or all).

## Consent and data handling

- **Camera**: used only after you tick the consent box and press Start. It stops when the session ends or you press Stop.
- **Video**: not recorded, stored or uploaded. Frames go from your browser to the Sama server running on your own computer (`127.0.0.1`) and are discarded after processing.
- **SDK network use**: the SDK contacts Presage to validate your API key and subscription. SDK telemetry is **off** (`enableTelemetry: false`) unless you set `SMARTSPECTRA_TELEMETRY=true`.
- **Stored data**: only summary numbers (pulse, breathing rate, label, optional note you type) in your browser's `localStorage`. No account, no server database.
- **Export and delete**: from the History panel at any time.
- **No AI services** are used.
- **API key**: read from `.env` on the server. It is never sent to the browser and never committed (`.gitignore`).

## Tests

```bash
npm test
```

Covers the signal-quality gate, baseline timer pausing, pacer phases, the readiness comparison, history store (add, export, delete), language key parity, and the SDK metrics summarizer.

## License

MIT for this app. The SmartSpectra SDK has its own license.

## Demo video disclosure
The demo video uses licensed stock test footage (Mixkit, "Man talking in a video conference call", Mixkit Stock Video Free License, https://mixkit.co/free-stock-video/man-talking-in-a-video-conference-call-14041/). The author is not on camera. The pulse and breathing values in the video come live from the real Presage SmartSpectra SDK. The video is labelled on screen. The stock clip itself is not in this repo.
