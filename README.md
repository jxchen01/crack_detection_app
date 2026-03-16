# Circle + Texture Inspector (OpenRouter)

A mobile-first static web app that:
1. Opens the phone camera.
2. Waits for user action and captures only when **Take Photo** is pressed.
3. Sends the photo to an OpenRouter vision model.
4. Shows either:
   - **Pass** (green check) when shape is circular and texture is homogeneous.
   - **Warning** with likely issue types (`shape`, `crack`, `texture`, `stain`, `other`).

## Vercel Setup

Set this environment variable in Vercel project settings:

- `OPENROUTER_API_KEY=your_key_here`

The browser calls `/api/analyze`, and the serverless function reads the key from `OPENROUTER_API_KEY`.

## Run Local (with Vercel Dev)

Because camera access usually requires HTTPS or localhost, run a local web server:

```bash
cd crack_detection_app
OPENROUTER_API_KEY=your_key_here npx vercel dev --listen 8080
```

Then open:
- `http://localhost:8080` on desktop browser, or
- `http://<your-local-ip>:8080` on your phone (same Wi-Fi network).

## Use

1. Confirm or change model (`openai/gpt-4o-mini` by default).
2. Tap **Start Camera**.
3. Tap **Take Photo**.
4. Tap **Analyze**.

## Notes

- API key is not exposed in client-side JavaScript.
- Choose an image-capable model in OpenRouter.
- The camera never auto-captures; capture is always button-triggered.
