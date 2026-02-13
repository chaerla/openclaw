import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk";
import { emailOutbound } from "./outbound.js";

type ResolvedEmailAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
};

const meta = {
  id: "email",
  label: "Email",
  selectionLabel: "Email (Resend)",
  docsPath: "/channels/email",
  docsLabel: "email",
  blurb: "Reply by email via Resend Send API.",
  order: 100,
} as const;

function isConfigured(cfg: OpenClawConfig): boolean {
  const apiKey = (
    cfg.channels as { email?: { resendApiKey?: string } } | undefined
  )?.email?.resendApiKey?.trim();
  return Boolean(apiKey);
}

export const emailPlugin: ChannelPlugin<ResolvedEmailAccount> = {
  id: "email",
  meta: { ...meta },
  capabilities: {
    chatTypes: ["direct"],
    media: true,
  },
  config: {
    listAccountIds: () => ["default"],
    resolveAccount: (cfg, accountId) => ({
      accountId: accountId ?? "default",
      enabled: true,
      configured: isConfigured(cfg),
    }),
    defaultAccountId: () => "default",
    isConfigured: (_, cfg) => isConfigured(cfg),
  },
  outbound: emailOutbound,
};
