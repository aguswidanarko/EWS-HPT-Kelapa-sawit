// Dashboard Utama KPI summary (SPEC.md section 7).

const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth);

router.get(
  '/kpi',
  asyncHandler(async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);

    const totalDeteksi = db.prepare('SELECT COUNT(*) c FROM detection').get().c;
    const deteksiHariIni = db.prepare('SELECT COUNT(*) c FROM detection WHERE tanggal=?').get(today).c;
    const totalSensus = db.prepare('SELECT COUNT(*) c FROM sensus').get().c;
    const blokTerindikasi = db
      .prepare(
        `SELECT COUNT(DISTINCT blok_id) c FROM (
           SELECT blok_id FROM detection WHERE kategori IS NOT NULL AND kategori != 'NORMAL'
           UNION
           SELECT blok_id FROM sensus WHERE kategori IS NOT NULL AND kategori != 'NORMAL'
         )`
      )
      .get().c;
    const blokMelewatiThreshold = db
      .prepare(`SELECT COUNT(DISTINCT blok_id) c FROM incident WHERE status != 'CLOSED'`)
      .get().c;
    const pengendalianBerjalan = db.prepare(`SELECT COUNT(*) c FROM treatment WHERE status='BERJALAN'`).get().c;
    const mortalitasPending = db
      .prepare(`SELECT COUNT(*) c FROM mortality WHERE service_required=1 AND status != 'SELESAI_SERVICE'`)
      .get().c;
    const kasusPerluService = db.prepare(`SELECT COUNT(*) c FROM mortality WHERE service_required=1`).get().c;
    const alertAktif = db.prepare(`SELECT COUNT(*) c FROM alert WHERE status NOT IN ('CLOSED')`).get().c;
    const incidentByStatus = db.prepare(`SELECT status, COUNT(*) c FROM incident GROUP BY status`).all();
    const incidentBySeverity = db.prepare(`SELECT severity, COUNT(*) c FROM incident WHERE status != 'CLOSED' GROUP BY severity`).all();

    res.json({
      data: {
        total_deteksi: totalDeteksi,
        deteksi_hari_ini: deteksiHariIni,
        total_sensus: totalSensus,
        blok_terindikasi: blokTerindikasi,
        blok_melewati_threshold: blokMelewatiThreshold,
        pengendalian_berjalan: pengendalianBerjalan,
        mortalitas_pending: mortalitasPending,
        kasus_perlu_service: kasusPerluService,
        alert_aktif: alertAktif,
        incident_by_status: incidentByStatus,
        incident_by_severity: incidentBySeverity,
        generated_at: new Date().toISOString(),
      },
    });
  })
);

module.exports = router;
