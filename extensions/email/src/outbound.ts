import fs from "node:fs/promises";
import path from "node:path";
import { Resend } from "resend";
import type {
  ChannelOutboundAdapter,
  OpenClawConfig,
  OutboundDeliveryResult,
} from "openclaw/plugin-sdk";

const DEFAULT_SUBJECT = "Re: Clawdify";
const DEFAULT_FROM = "Clawdify <noreply@example.com>";

type EmailChannelConfig = {
  resendApiKey?: string;
  from?: string;
};

function getResendConfig(cfg: OpenClawConfig): {
  apiKey: string;
  from: string;
} {
  const email = (cfg.channels as { email?: EmailChannelConfig } | undefined)
    ?.email;
  const apiKey = email?.resendApiKey?.trim() ?? "";
  const from = email?.from?.trim() ?? DEFAULT_FROM;
  return { apiKey, from };
}

/** Resolve mediaUrl to a buffer; returns null if not a local path or fetch fails. */
async function resolveMediaToBuffer(
  mediaUrl: string
): Promise<{ buffer: Buffer; filename: string } | null> {
  const trimmed = mediaUrl?.trim();
  if (!trimmed) return null;
  try {
    if (trimmed.startsWith("file://")) {
      const filePath = trimmed.slice(7);
      const buf = await fs.readFile(filePath);
      const filename = path.basename(filePath) || "attachment";
      return { buffer: buf, filename };
    }
    if (path.isAbsolute(trimmed) || trimmed.startsWith(".")) {
      const buf = await fs.readFile(trimmed);
      const filename = path.basename(trimmed) || "attachment";
      return { buffer: buf, filename };
    }
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      const res = await fetch(trimmed);
      if (!res.ok) return null;
      const ab = await res.arrayBuffer();
      const buffer = Buffer.from(ab);
      const contentDisposition = res.headers.get("content-disposition");
      const filenameMatch = contentDisposition?.match(/filename="?([^";]+)"?/);
      const filename =
        filenameMatch?.[1]?.trim() ||
        path.basename(new URL(trimmed).pathname) ||
        "attachment";
      return { buffer, filename };
    }
  } catch {
    // Ignore; fall back to link in body.
  }
  return null;
}

async function sendResendEmail(params: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{ content: string; filename: string }>;
}): Promise<{ id: string }> {
  const { apiKey, from, to, subject, text, html, attachments } = params;
  if (!apiKey) {
    throw new Error(
      "Resend API key not configured: set channels.email.resendApiKey in config"
    );
  }
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from,
    to,
    subject,
    ...(html ? { html } : { text }),
    ...(attachments?.length ? { attachments } : undefined),
  });
  if (error) {
    throw new Error(`Resend send failed: ${error.message}`);
  }
  const id = typeof data?.id === "string" ? data.id : "unknown";
  return { id };
}

export const emailOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: null,
  textChunkLimit: 100_000,
  sendText: async ({ cfg, to, text }): Promise<OutboundDeliveryResult> => {
    const { apiKey, from } = getResendConfig(cfg);
    const trimmedTo = to?.trim();
    if (!trimmedTo) {
      throw new Error("Email channel requires a valid 'to' address");
    }
    const { id } = await sendResendEmail({
      apiKey,
      from,
      to: trimmedTo,
      subject: DEFAULT_SUBJECT,
      text: text ?? "",
    });
    return { channel: "email", messageId: id };
  },
  sendMedia: async ({
    cfg,
    to,
    text,
    mediaUrl,
  }): Promise<OutboundDeliveryResult> => {
    const { apiKey, from } = getResendConfig(cfg);
    const trimmedTo = to?.trim();
    if (!trimmedTo) {
      throw new Error("Email channel requires a valid 'to' address");
    }
    let attachments: Array<{ content: string; filename: string }> | undefined;
    const resolved = mediaUrl ? await resolveMediaToBuffer(mediaUrl) : null;
    if (resolved) {
      attachments = [
        {
          content: resolved.buffer.toString("base64"),
          filename: resolved.filename,
        },
      ];
    }
    const body =
      attachments != null
        ? text?.trim() || " "
        : [text?.trim(), mediaUrl ? `Media: ${mediaUrl}` : ""]
            .filter(Boolean)
            .join("\n\n") || " ";
    const { id } = await sendResendEmail({
      apiKey,
      from,
      to: trimmedTo,
      subject: DEFAULT_SUBJECT,
      text: body,
      attachments,
    });
    return { channel: "email", messageId: id };
  },
};
