import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { emailPlugin } from "./src/channel.js";
import { handleResendInboundRequest } from "./src/inbound.js";

const plugin = {
  id: "email",
  name: "Email",
  description: "Email channel (Resend inbound/outbound via Resend)",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.registerChannel({ plugin: emailPlugin });

    // Register inbound webhook route via API (not the standalone function)
    api.registerHttpRoute({
      path: "/inbound/email",
      handler: handleResendInboundRequest,
    });
  },
};

export default plugin;
