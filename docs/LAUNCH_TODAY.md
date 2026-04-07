# Launch today checklist

1. Create a new GitHub repo named something like `scamly-beta`.
2. Upload the full contents of this launch bundle to the repo root exactly as-is.
3. In Render, create a new Web Service from that repo.
4. In Render, set the **Root Directory** to `backend`.
5. Build command: `npm install` is not required for this version. You can leave Render on the default or set it to `echo ready`.
6. Start command: `node server.js`
7. Add env vars: `OPENAI_API_KEY`, `OPENAI_MODEL=gpt-5.4-mini`, and optionally the Supabase vars if you want durable feedback storage.
8. After deploy, open `https://your-service.onrender.com/api/health` and confirm `status: ok`.
9. Load the `extension/` folder in Chrome as an unpacked extension.
10. Open Scamly settings and paste the same Render URL into Backend URL and Public Site URL.
11. Turn on Deep AI Check, grant the backend permission, and keep the consent toggle on.
12. Test on a few real emails.
13. Zip the contents of `extension/` and upload to the Chrome Web Store.
