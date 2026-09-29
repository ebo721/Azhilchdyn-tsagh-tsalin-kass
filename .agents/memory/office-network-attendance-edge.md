---
name: Office network attendance edge
description: Deployment boundary and identity limits for office-network-restricted attendance.
---

Employee browsers cannot reliably read a Wi-Fi SSID or a phone MAC address. Treat a registered browser key as the employee's device credential, and the office's public IP as a separate network gate; neither proves hardware identity or prevents a VPN onto the office network.

**Why:** The staff frontend proxies `/api` to a separate Vercel API. On that second hop the IP belongs to the frontend edge, not necessarily to the employee. Replit preview does not document a trusted visitor-IP header. Trusting forwarded headers in either setting could accept a remote punch as on-site attendance.

**How to apply:** Network-gated employee actions must call the API's Vercel origin directly from the browser and use the IP set by that trusted edge. Keep development/preview fail-closed; production origin selection must exclude preview builds. Configure the real office public IP before enabling staff enrollment, and verify an office and an off-site request against the deployed edge before claiming the feature is live.