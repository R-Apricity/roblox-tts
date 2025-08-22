Roblox TTS POC

An Express server that translates text to Japanese, calls a local Gradio TTS service to synthesize audio, then uploads the audio to Roblox as an asset. Optionally grants the uploaded asset permission to a specified Roblox universe and can bypass moderation waiting.

How It Works
- Translate input text to Japanese using `bing-translate-api` (endpoint: MET)
- Call a local Gradio server (`@gradio/client`) at `http://127.0.0.1:5555/` on endpoint `/tts_fn` with `{ text, speaker, speed }`
- Download resulting audio and upload to Roblox via authenticated APIs
- Poll asset operation until an assetId is produced; optionally wait for moderation

Prerequisites
- Node.js 18+
- Local Gradio TTS service running at `http://127.0.0.1:5555/` exposing `/tts_fn`
- Roblox cookie in `cookies.txt` at repo root (a single line like `.ROBLOSECURITY=...`) — keep this private
- Roblox account permissions to upload audio assets

Configuration
- Server port: `SERVER_PORT` or `PORT` (default `7621`)
- Main universe ID and toggles are hard-coded at top of `index.js`:
  - `const MAIN_GAME_UNIVERSE_ID = "7677908852";`
  - `const GRANT_ASSET_PERMISSIONS = true;`
  - `const BYPASS_MODERATION_WAIT = true;`
  Update these constants as needed.

Install
- `npm install`

Run
- `node index.js`
- Server logs will indicate whether the Roblox cookie and user ID were successfully read and fetched.

API
- `GET /tts?text=Hello%20world&char=JP_Shiroko`
  - `text`: source text (required; translated to Japanese internally)
  - `char`: TTS speaker/voice id for the Gradio app (optional; default `JP_Shiroko`)
  - Returns JSON with Roblox asset info when successful, e.g. `{ assetId, operationId, robloxAssetUrl, statusNote }`

Example
```
curl --get "http://localhost:7621/tts" \
  --data-urlencode "text=Good morning" \
  --data-urlencode "char=JP_Shiroko"
```

Security Notes
- Do NOT commit `cookies.txt` or any secrets. This repo includes a `.gitignore` to keep `node_modules/` and `cookies.txt` out of git.
- Use of Roblox APIs must follow Roblox Terms of Use and rate limits.

Repository
- Target (requested): https://github.com/R-Apricity/roblox-tts

