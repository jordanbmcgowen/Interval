<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/15ORamIm5U6F5r9bk0_iV1kPdWhPz6wnI

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`


## Deploy to Cloudflare Workers

This project builds to a static `dist/` directory, and `wrangler.jsonc` is configured to upload that directory as Worker assets.

1. Build the app:
   `npm run build`
2. Deploy with Wrangler:
   `npx wrangler deploy`

If you deploy from Cloudflare's Git integration, keep your build command as `npm run build` and deploy command as `npx wrangler deploy`.
