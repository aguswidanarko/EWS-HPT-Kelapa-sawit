// Data Quality Dashboard (SPEC.md section 7).

const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const incompleteDetection = db
      .prepare(`SELECT COUNT(*) c FROM detection WHERE gejala IS NULL OR kondisi_indikator IS NULL OR hpt_id IS NULL`)
      .get().c;
    const gpsMissing = db.prepare(`SELECT COUNT(*) c FROM detection WHERE gps_lat IS NULL OR gps_lng IS NULL`).get().c;
    const gpsOutOfBlok = db.prepare(`SELECT COUNT(*) c FROM detection WHERE location_warning=1`).get().c;
    const unknownHptCount = db.prepare(`SELECT COUNT(*) c FROM detection WHERE hpt_id IS NULL`).get().c;
    const unknownBlokCount = db.prepare(`SELECT COUNT(*) c FROM detection WHERE blok_id IS NULL`).get().c;
    const duplicateDetections = db.prepare(`SELECT COUNT(*) c FROM detection WHERE is_duplicate_suspect=1`).get().c;
    const duplicateSensus = db.prepare(`SELECT COUNT(*) c FROM sensus WHERE is_duplicate_suspect=1`).get().c;
    const importErrors = db.prepare(`SELECT COALESCE(SUM(error_rows),0) c FROM import_log`).get().c;
    const unsyncedDetection = db.prepare(`SELECT COUNT(*) c FROM detection WHERE sync_status != 'SYNCED'`).get().c;
    const unsyncedSensus = db.prepare(`SELECT COUNT(*) c FROM sensus WHERE sync_status != 'SYNCED'`).get().c;
    const unsyncedTreatment = db.prepare(`SELECT COUNT(*) c FROM treatment WHERE sync_status != 'SYNCED'`).get().c;
    const unsyncedMortality = db.prepare(`SELECT COUNT(*) c FROM mortality WHERE sync_status != 'SYNCED'`).get().c;

    res.json({
      data: {
        data_belum_lengkap: incompleteDetection,
        gps_tidak_tersedia: gpsMissing,
        gps_di_luar_blok: gpsOutOfBlok,
        hpt_tidak_dikenal: unknownHptCount,
        blok_tidak_dikenal: unknownBlokCount,
        duplicate_suspect: { deteksi: duplicateDetections, sensus: duplicateSensus },
        import_errors: importErrors,
        data_belum_tersinkron: {
          deteksi: unsyncedDetection,
          sensus: unsyncedSensus,
          treatment: unsyncedTreatment,
          mortalitas: unsyncedMortality,
          total: unsyncedDetection + unsyncedSensus + unsyncedTreatment + unsyncedMortality,
        },
      },
    });
  })
);

module.exports = router;
