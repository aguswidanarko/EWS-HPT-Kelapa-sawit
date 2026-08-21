// Reporting (SPEC.md section 7): daily/monthly EWS report + per-blok/afdeling/estate/HPT/trend
// reports, exportable as Excel/CSV. PDF export is out of scope for v1 (documented, not blocking).

const express = require('express');
const XLSX = require('xlsx');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth);

function exportRows(res, rows, filename, format) {
  if (format === 'csv') {
    const ws = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(ws);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    res.setHeader('Content-Type', 'text/csv');
    return res.send(csv);
  }
  if (format === 'xlsx') {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buf);
  }
  res.json({ data: rows });
}

// GET /api/reports/daily?date=YYYY-MM-DD&format=json|csv|xlsx
router.get(
  '/daily',
  asyncHandler(async (req, res) => {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const deteksi = db.prepare('SELECT COUNT(*) c FROM detection WHERE tanggal=?').get(date).c;
    const sensus = db.prepare('SELECT COUNT(*) c FROM sensus WHERE tanggal=?').get(date).c;
    const alert = db.prepare(`SELECT COUNT(*) c FROM alert WHERE date(created_at)=?`).get(date).c;
    const critical = db.prepare(`SELECT COUNT(*) c FROM alert WHERE date(created_at)=? AND kategori='CRITICAL'`).get(date).c;
    const treatment = db.prepare('SELECT COUNT(*) c FROM treatment WHERE tanggal_mulai=?').get(date).c;
    const service = db.prepare(`SELECT COUNT(*) c FROM mortality WHERE tanggal=? AND service_required=1`).get(date).c;
    const rows = [{ tanggal: date, deteksi, sensus, alert, critical, treatment, service_required: service }];
    exportRows(res, rows, `ews_daily_${date}`, req.query.format);
  })
);

// GET /api/reports/monthly?year=&month=&format=
router.get(
  '/monthly',
  asyncHandler(async (req, res) => {
    const year = req.query.year || new Date().getFullYear();
    const month = String(req.query.month || new Date().getMonth() + 1).padStart(2, '0');
    const prefix = `${year}-${month}`;
    const totalDeteksi = db.prepare(`SELECT COUNT(*) c FROM detection WHERE tanggal LIKE ?`).get(`${prefix}%`).c;
    const totalSensus = db.prepare(`SELECT COUNT(*) c FROM sensus WHERE tanggal LIKE ?`).get(`${prefix}%`).c;
    const distribusiHpt = db
      .prepare(`SELECT h.name AS hpt, COUNT(*) c FROM detection d JOIN hpt h ON h.id=d.hpt_id WHERE d.tanggal LIKE ? GROUP BY h.id`)
      .all(`${prefix}%`);
    const blokKritis = db
      .prepare(`SELECT b.code AS blok, COUNT(*) c FROM incident i JOIN blok b ON b.id=i.blok_id WHERE i.severity IN ('BERAT','CRITICAL') AND i.opened_at LIKE ? GROUP BY b.id ORDER BY c DESC LIMIT 20`)
      .all(`${prefix}%`);
    const treatmentCount = db.prepare(`SELECT COUNT(*) c FROM treatment WHERE tanggal_mulai LIKE ?`).get(`${prefix}%`).c;
    const mortalitasCount = db.prepare(`SELECT COUNT(*) c FROM mortality WHERE tanggal LIKE ?`).get(`${prefix}%`).c;
    const serviceCount = db.prepare(`SELECT COUNT(*) c FROM mortality WHERE tanggal LIKE ? AND service_required=1`).get(`${prefix}%`).c;
    const efektif = db.prepare(`SELECT COUNT(*) c FROM mortality WHERE tanggal LIKE ? AND hasil_efektivitas='EFEKTIF'`).get(`${prefix}%`).c;

    if ((req.query.format || 'json') === 'json') {
      return res.json({
        data: {
          periode: `${year}-${month}`,
          total_deteksi: totalDeteksi,
          total_sensus: totalSensus,
          distribusi_hpt: distribusiHpt,
          blok_kritis: blokKritis,
          treatment: treatmentCount,
          mortalitas: mortalitasCount,
          service_required: serviceCount,
          efektivitas_pengendalian: mortalitasCount ? `${((efektif / mortalitasCount) * 100).toFixed(1)}%` : 'n/a',
        },
      });
    }
    exportRows(res, distribusiHpt, `ews_monthly_${year}_${month}`, req.query.format);
  })
);

// GET /api/reports/by-blok?blok_id=&format=
router.get(
  '/by-blok',
  asyncHandler(async (req, res) => {
    const params = {};
    let where = '';
    if (req.query.blok_id) { where = 'WHERE b.id=@blok_id'; params.blok_id = req.query.blok_id; }
    const rows = db
      .prepare(
        `SELECT b.code AS blok, af.name AS afdeling, e.name AS estate,
                COUNT(DISTINCT d.id) AS jumlah_deteksi, COUNT(DISTINCT s.id) AS jumlah_sensus,
                COUNT(DISTINCT i.id) AS jumlah_incident
         FROM blok b
         JOIN afdeling af ON af.id=b.afdeling_id JOIN estate e ON e.id=af.estate_id
         LEFT JOIN detection d ON d.blok_id=b.id
         LEFT JOIN sensus s ON s.blok_id=b.id
         LEFT JOIN incident i ON i.blok_id=b.id
         ${where}
         GROUP BY b.id`
      )
      .all(params);
    exportRows(res, rows, 'ews_report_per_blok', req.query.format);
  })
);

router.get(
  '/by-afdeling',
  asyncHandler(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT af.name AS afdeling, e.name AS estate,
                COUNT(DISTINCT d.id) AS jumlah_deteksi, COUNT(DISTINCT s.id) AS jumlah_sensus,
                COUNT(DISTINCT i.id) AS jumlah_incident
         FROM afdeling af JOIN estate e ON e.id=af.estate_id
         LEFT JOIN detection d ON d.afdeling_id=af.id
         LEFT JOIN sensus s ON s.afdeling_id=af.id
         LEFT JOIN incident i ON i.afdeling_id=af.id
         GROUP BY af.id`
      )
      .all();
    exportRows(res, rows, 'ews_report_per_afdeling', req.query.format);
  })
);

router.get(
  '/by-estate',
  asyncHandler(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT e.name AS estate,
                COUNT(DISTINCT d.id) AS jumlah_deteksi, COUNT(DISTINCT s.id) AS jumlah_sensus,
                COUNT(DISTINCT i.id) AS jumlah_incident
         FROM estate e
         LEFT JOIN detection d ON d.estate_id=e.id
         LEFT JOIN sensus s ON s.estate_id=e.id
         LEFT JOIN incident i ON i.estate_id=e.id
         GROUP BY e.id`
      )
      .all();
    exportRows(res, rows, 'ews_report_per_estate', req.query.format);
  })
);

router.get(
  '/by-hpt',
  asyncHandler(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT h.name AS hpt, COUNT(DISTINCT d.id) AS jumlah_deteksi, COUNT(DISTINCT s.id) AS jumlah_sensus,
                COUNT(DISTINCT i.id) AS jumlah_incident
         FROM hpt h
         LEFT JOIN detection d ON d.hpt_id=h.id
         LEFT JOIN sensus s ON s.jenis_sensus=h.code
         LEFT JOIN incident i ON i.hpt_id=h.id
         GROUP BY h.id`
      )
      .all();
    exportRows(res, rows, 'ews_report_per_hpt', req.query.format);
  })
);

// GET /api/reports/trend?from=&to=&interval=day|month
router.get(
  '/trend',
  asyncHandler(async (req, res) => {
    const bucket = req.query.interval === 'month' ? `substr(tanggal,1,7)` : 'tanggal';
    const rows = db
      .prepare(`SELECT ${bucket} AS periode, COUNT(*) AS jumlah_deteksi FROM detection GROUP BY ${bucket} ORDER BY periode`)
      .all();
    exportRows(res, rows, 'ews_trend', req.query.format);
  })
);

// GET /api/reports/treatment-service?format=
router.get(
  '/treatment-service',
  asyncHandler(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT t.id AS treatment_id, b.code AS blok, h.name AS hpt, t.metode_pengendalian, t.status,
                m.hasil_efektivitas, m.service_required
         FROM treatment t
         LEFT JOIN blok b ON b.id=t.blok_id
         LEFT JOIN hpt h ON h.id=t.hpt_id
         LEFT JOIN mortality m ON m.treatment_id=t.id`
      )
      .all();
    exportRows(res, rows, 'ews_treatment_service', req.query.format);
  })
);

module.exports = router;
