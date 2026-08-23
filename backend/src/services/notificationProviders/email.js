// Email NotificationProvider -- created alongside whatsapp.js for interface parity (SPEC_V2.md
// section 4 Backend: "interface sama seperti email.js V1"). V1 did not actually ship a
// per-channel email.js file (it used one shared MockLogProvider for every channel, see
// services/notificationProvider.js), so this file is the first one; whatsapp.js in this same
// directory mirrors it exactly. Same swappable `send()` contract as whatsapp.js.

class MockEmailProvider {
  async send({ recipient, subject, message, meta }) {
    // eslint-disable-next-line no-console
    console.log(`[NotificationProvider:EMAIL:MOCK] to=${recipient || '(unset)'} subject="${subject || ''}"`);
    // eslint-disable-next-line no-console
    console.log(`  message: ${message}`);
    if (meta) console.log(`  meta: ${JSON.stringify(meta)}`);
    return {
      status: 'SENT',
      response_provider: 'mock-email-provider-v1',
      error: null,
    };
  }
}

const provider = new MockEmailProvider();

module.exports = { provider, MockEmailProvider };
