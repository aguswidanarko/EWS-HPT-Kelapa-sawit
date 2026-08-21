// NotificationProvider adapter (SPEC.md section 9 decision #5).
//
// The rest of the app only ever calls `notificationProvider.send(...)` — it never talks to a
// concrete email/WhatsApp SDK directly. That keeps the vendor swappable: to plug in a real
// provider in production, implement the same `send({ channel, recipient, subject, message, meta })
// -> { status, response_provider, error }` contract and swap the export at the bottom of this
// file (see backend/README.md "Swapping the NotificationProvider").
//
// Default implementation: MockLogProvider. It never calls a real network API — it logs to
// stdout and returns a synthetic SENT status, which is enough to prove the alert/notification
// pipeline end-to-end without needing production SMTP/WhatsApp credentials.

class MockLogProvider {
  async send({ channel, recipient, subject, message, meta }) {
    const line = `[NotificationProvider:MOCK] channel=${channel} to=${recipient || '(unset)'} subject="${subject || ''}"`;
    // eslint-disable-next-line no-console
    console.log(line);
    // eslint-disable-next-line no-console
    console.log(`  message: ${message}`);
    if (meta) console.log(`  meta: ${JSON.stringify(meta)}`);
    return {
      status: 'SENT',
      response_provider: 'mock-log-provider-v1',
      error: null,
    };
  }
}

/**
 * Builds a human readable subject/message pair for an alert notification, per the WhatsApp/Email
 * template shape described in BRD 02 section 20-21 (kept generic/text here since no fixed
 * template content was mandated for v1 wiring).
 */
function buildAlertMessage({ incident, alert, hptName, blokLabel }) {
  const subject = `EWS ALERT ${alert.kategori} - ${hptName || 'HPT'} - ${blokLabel || ''}`;
  const message =
    `Incident ${incident.incident_code}\n` +
    `HPT: ${hptName || '-'}\n` +
    `Lokasi: ${blokLabel || '-'}\n` +
    `Hasil: ${alert.hasil ?? '-'} (${alert.threshold_ref || '-'})\n` +
    `Kategori: ${alert.kategori}\n` +
    `Status: ${alert.status}\n` +
    `Segera tindak lanjuti melalui EWS Alert Center.`;
  return { subject, message };
}

const provider = new MockLogProvider();

module.exports = { provider, buildAlertMessage, MockLogProvider };
