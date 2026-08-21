import { Empty } from './Common';
import { fmtDateTime } from '../utils/format';

const TYPE_LABELS = {
  'WARNING/ALERT': '🔔 Warning / Alert',
  ALERT: '🔔 Warning / Alert',
  DETECTION: '🔍 Deteksi',
  SENSUS: '📋 Sensus',
  TREATMENT: '🧪 Treatment',
  MORTALITY: '☠ Mortalitas',
};

function summarize(type, ref) {
  if (!ref) return '';
  if (type === 'DETECTION') return `${ref.gejala || ref.kondisi_indikator || ''} ${ref.kategori ? `(${ref.kategori})` : ''}`.trim();
  if (type === 'SENSUS') return `${ref.jenis_sensus || ''} — hasil ${ref.hasil_hitung ?? '-'} (${ref.kategori || '-'})`;
  if (type === 'TREATMENT') return `${ref.metode_pengendalian || ''} — status ${ref.status || '-'}`;
  if (type === 'MORTALITY') return `Hidup ${ref.jumlah_hidup ?? '-'} / Mati ${ref.jumlah_mati ?? '-'} — ${ref.hasil_efektivitas || '-'}${ref.service_required ? ' — perlu service' : ''}`;
  if (type === 'WARNING/ALERT' || type === 'ALERT') return `${ref.kategori || ''} — hasil ${ref.hasil ?? '-'} — ${ref.threshold_ref || ''} (status ${ref.status || '-'})`;
  return ref.catatan || '';
}

export default function IncidentTimeline({ incident }) {
  const timeline = incident?.timeline;
  if (!timeline || timeline.length === 0) return <Empty label="Belum ada riwayat pada insiden ini." />;
  const sorted = [...timeline].sort((a, b) => new Date(a.at) - new Date(b.at));
  return (
    <ul className="timeline">
      {sorted.map((ev, idx) => (
        <li key={idx}>
          <div className="tl-type">{TYPE_LABELS[ev.type] || ev.type}</div>
          <div className="tl-time">{fmtDateTime(ev.at)}</div>
          <div className="tl-body">{summarize(ev.type, ev.ref)}</div>
        </li>
      ))}
    </ul>
  );
}
