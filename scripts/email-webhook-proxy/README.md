# Email webhook proxy (Resend + ngrok)

Minimal Python proxy to test inbound email with Resend and ngrok. No extra deps (stdlib only).

1. **Start the OpenClaw gateway** (e.g. `pnpm openclaw gateway run` on port 18789).

2. **Start the proxy:**
   ```bash
   cd scripts/email-webhook-proxy
   python3 server.py 8080
   ```
   Optional: `GATEWAY_URL=http://host.docker.internal:18789` if the gateway runs in Docker on the host.

3. **Expose with ngrok:**
   ```bash
   ngrok http 8080
   ```

4. **Configure Resend:** In Resend dashboard, set the inbound webhook URL to your ngrok URL + path, e.g. `https://xxxx.ngrok-free.app/inbound/email`.

5. **Send a test email** to your Resend inbound address; the proxy forwards the webhook to the gateway and the agent can reply.
