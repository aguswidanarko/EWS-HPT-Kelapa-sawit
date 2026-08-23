// WhatsApp NotificationProvider (SPEC_V2.md section 1 item 8/4 Backend module list: "provider
// abstraction, mock/log-only dulu, pola sama seperti Email V1").
//
// V1's services/notificationProvider.js already ships ONE generic MockLogProvider whose
// send({channel,...}) handles DASHBOARD/EMAIL/WHATSAPP identically, and every existing V1 call
// site (thresholdEngine.js, ingestion.js) is wired to that shared provider -- changing that
// dispatch pipeline is out of scope for a "must not break V1" task. This module instead gives V2
// code (and a future real WhatsApp integration) a DEDICATED, swappable per-channel provider with
// the exact same `send({channel, recipient, subject, message, meta}) -> {status,
// response_provider, error}` contract, so routes that want WhatsApp-specific behavior (e.g. a
// future real WhatsApp Business API client) can require this file directly instead of routing
// through the generic provider.
//
// To plug in a real WhatsApp Business API / Twilio / vendor SDK in production: implement the same
// `send()` contract in a new class and swap the `provider` export below (see backend/README.md
// "Swapping the NotificationProvider" for the equivalent V1 pattern -- this follows it exactly).

class MockWhatsAppProvider {
  async send({ recipient, subject, message, meta }) {
    // eslint-disable-next-line no-console
    console.log(`[NotificationProvider:WHATSAPP:MOCK] to=${recipient || '(unset)'} subject="${subject || ''}"`);
    // eslint-disable-next-line no-console
    console.log(`  message: ${message}`);
    if (meta) console.log(`  meta: ${JSON.stringify(meta)}`);
    return {
      status: 'SENT',
      response_provider: 'mock-whatsapp-provider-v1',
      error: null,
    };
  }
}

const provider = new MockWhatsAppProvider();

module.exports = { provider, MockWhatsAppProvider };
