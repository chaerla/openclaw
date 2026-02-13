/**
 * Resend inbound webhook: receive email.received events, verify signature,
 * fetch body via API, build MsgContext, and dispatch to the agent.
 * Replies go back via email (OriginatingChannel/OriginatingTo).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { Webhook } from "svix";
import {
  createReplyDispatcher,
  dispatchInboundMessage,
  loadConfig,
  resolveAgentRoute,
  routeReply,
  type MsgContext,
  type OpenClawConfig,
} from "openclaw/plugin-sdk";

const MAX_BODY_BYTES = 256 * 1024;

type EmailChannelConfig = {
  resendApiKey?: string;
  webhookSecret?: string;
  from?: string;
};

function getEmailConfig(cfg: OpenClawConfig): EmailChannelConfig | undefined {
  return (cfg.channels as { email?: EmailChannelConfig } | undefined)?.email;
}

/** Read raw request body (for webhook signature verification). */
async function readRawBody(
  req: IncomingMessage,
  maxBytes: number
): Promise<
  { ok: true; raw: string } | { ok: false; status: number; error: string }
> {
  return new Promise((resolve) => {
    let done = false;
    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      if (done) return;
      total += chunk.length;
      if (total > maxBytes) {
        done = true;
        resolve({ ok: false, status: 413, error: "payload too large" });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      const raw = Buffer.concat(chunks).toString("utf-8");
      resolve({ ok: true, raw });
    });
    req.on("error", (err) => {
      if (!done) {
        done = true;
        resolve({ ok: false, status: 400, error: String(err) });
      }
    });
  });
}

/** Extract email address from "Name <email>" or return trimmed string. */
function parseSenderAddress(from: string | undefined): string {
  const s = (from ?? "").trim();
  const match = s.match(/<([^>]+)>/);
  if (match?.[1]) {
    return match[1].trim().toLowerCase();
  }
  if (s.includes("@")) {
    return s.toLowerCase();
  }
  return s;
}

type ResendEmailReceivedData = {
  email_id?: string;
  from?: string;
  to?: string[];
  subject?: string;
};

type ResendWebhookEvent = {
  type?: string;
  data?: ResendEmailReceivedData;
};

export async function handleResendInboundRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, svix-id, svix-timestamp, svix-signature");
    res.end();
    return;
  }

  // Debug: log the actual method being received
  console.log(`[email-inbound] Received ${req.method} request to ${req.url}`);

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST, OPTIONS");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(`Method Not Allowed: received ${req.method}`);
    return;
  }

  const cfg = loadConfig();
  const emailConfig = getEmailConfig(cfg);
  const webhookSecret = emailConfig?.webhookSecret?.trim() ?? "";
  const apiKey = emailConfig?.resendApiKey?.trim() ?? "";
  const botEmail = emailConfig?.from?.trim() ?? "";

  if (!webhookSecret || !apiKey) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Email inbound not configured");
    return;
  }

  const bodyResult = await readRawBody(req, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    res.statusCode = bodyResult.status;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(bodyResult.error);
    return;
  }

  try {
    const wh = new Webhook(webhookSecret);
    wh.verify(bodyResult.raw, {
      "svix-id": req.headers["svix-id"] as string,
      "svix-timestamp": req.headers["svix-timestamp"] as string,
      "svix-signature": req.headers["svix-signature"] as string,
    });
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Invalid webhook signature");
    return;
  }

  let event: ResendWebhookEvent;
  try {
    event = JSON.parse(bodyResult.raw) as ResendWebhookEvent;
  } catch {
    res.statusCode = 400;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Invalid JSON");
    return;
  }

  if (event.type !== "email.received") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ received: true }));
    return;
  }

  const data = event.data;
  const emailId =
    typeof data?.email_id === "string" ? data.email_id.trim() : "";
  if (!emailId) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Missing email_id");
    return;
  }

  const toList = Array.isArray(data?.to) ? data.to : [];
  if (botEmail && toList.length > 0) {
    const toNormalized = toList.map((t) =>
      (typeof t === "string" ? t : "").trim().toLowerCase()
    );
    if (!toNormalized.includes(botEmail.toLowerCase())) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          received: true,
          skipped: "to_mismatch",
          botEmail: botEmail,
          toNormalized: toNormalized,
        })
      );
      return;
    }
  }

  const senderRaw = typeof data?.from === "string" ? data.from : "";
  const senderEmail = parseSenderAddress(senderRaw);
  if (!senderEmail || !senderEmail.includes("@")) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Missing or invalid from");
    return;
  }

  const receivedEmail = await fetchReceivedEmail(apiKey, emailId);
  if (!receivedEmail) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Failed to fetch email content");
    return;
  }

  const bodyText =
    (typeof receivedEmail.text === "string" && receivedEmail.text.trim()) ||
    (typeof receivedEmail.html === "string" && receivedEmail.html.trim()
      ? stripHtmlToPlain(receivedEmail.html)
      : "") ||
    "";
  const subject =
    typeof receivedEmail.subject === "string" ? receivedEmail.subject : "";

  const route = resolveAgentRoute({
    cfg,
    channel: "email",
    accountId: "default",
    peer: { kind: "dm", id: senderEmail },
  });

  const envelopeLine =
    subject || senderRaw
      ? `[Email from ${senderRaw}${subject ? ` — ${subject}` : ""}]\n\n`
      : "";
  const bodyForAgent = envelopeLine + (bodyText.trim() || "(no body)");

  const ctx: MsgContext = {
    From: senderEmail,
    To: (botEmail || toList[0] || "").trim(),
    Body: bodyForAgent,
    RawBody: bodyForAgent,
    BodyForAgent: bodyForAgent,
    BodyForCommands: bodyText.trim(),
    CommandBody: bodyText.trim(),
    SessionKey: route.sessionKey,
    Provider: "email",
    Surface: "email",
    OriginatingChannel: "email",
    OriginatingTo: senderEmail,
    ChatType: "direct",
    CommandAuthorized: true,
    MessageSid: emailId,
    Timestamp: Date.now(),
  };

  const dispatcher = createReplyDispatcher({
    responsePrefix: undefined,
    deliver: async (payload, info) => {
      if (info.kind !== "final") return;
      await routeReply({
        payload,
        channel: "email",
        to: senderEmail,
        sessionKey: route.sessionKey,
        accountId: route.accountId,
        cfg,
      });
    },
  });

  void dispatchInboundMessage({ ctx, cfg, dispatcher });

  res.statusCode = 202;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ received: true, processing: true }));
}

/** Fetch received email body via Resend REST API (receiving not in SDK). */
async function fetchReceivedEmail(
  apiKey: string,
  emailId: string
): Promise<{
  text?: string | null;
  html?: string | null;
  subject?: string;
} | null> {
  const res = await fetch(
    `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    }
  );
  if (!res.ok) {
    return null;
  }
  const data = (await res.json()) as {
    text?: string | null;
    html?: string | null;
    subject?: string;
  };
  return data;
}

function stripHtmlToPlain(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
