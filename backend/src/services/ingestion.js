// Shared field-data ingestion logic used by BOTH the direct dashboard-facing routes
// (routes/detection.js etc, single record) AND the mobile batch sync routes (routes/sync.js).
// Centralizing here guarantees the threshold engine, duplicate flagging, and audit trail behave
// identically no matter which door the data came through (SPEC.md "source" tagging).

const { v4: uuidv4 } = require('uuid');
const db = require('../db/db');
const { runThresholdEngine } = require('./thresholdEngine');
const { computeByHptCode } = require('./sensusEngines');
const { checkLocationWarning } = require('./geo');
const { isLikelyDuplicate } = require('./duplicateDetection');
const { logAudit } = require('./audit');
const { computeIndicatorResult } = require('./ruleEngine'); // V3: generic classify path for agro_observation (no circular require -- ruleEngine.js does not require ingestion.js)

const VALID_SOURCES = ['MOBILE', 'EXCEL', 'WEB', 'API'];

function normSource(s) {
  return VALID_SOURCES.includes(s) ? s : 'API';
}

function getHpt(hpt_id) {
  return db.prepare('SELECT * FROM hpt WHERE id=?').get(hpt_id);
}
function getBlok(blok_id) {
  return db.prepare('SELECT * FROM blok WHERE id=?').get(blok_id);
}

// ---------------------------------------------------------------- DETECTION
function ingestDetection(input, ctx = {}) {
  if (!input.blok_id || !input.hpt_id || !input.tanggal) {
    throw Object.assign(new Error('blok_id, hpt_id, tanggal wajib diisi'), { status: 400 });
  }
  const blok = getBlok(input.blok_id);
  if (!blok) throw Object.assign(new Error('Blok tidak ditemukan'), { status: 400 });
  const afdeling_id = input.afdeling_id || blok.afdeling_id;
  const afdeling = db.prepare('SELECT * FROM afdeling WHERE id=?').get(afdeling_id);
  const estate_id = input.estate_id || (afdeling ? afdeling.estate_id : null);

  const location_warning = checkLocationWarning(blok, input.gps_lat, input.gps_lng);
  const dup = isLikelyDuplicate('DETECTION', {
    estate_id, afdeling_id, blok_id: input.blok_id, tanggal: input.tanggal, hpt_id: input.hpt_id, user_id: ctx.user_id || input.user_id,
  });

  let engineResult = { kategori: null, ews_alert: false, incident: null };
  const jumlah = input.jumlah_indikasi;
  if (jumlah !== undefined && jumlah !== null && jumlah !== '') {
    engineResult = runThresholdEngine({
      hpt_id: input.hpt_id,
      species_id: input.species_id || null,
      blok_id: input.blok_id,
      nilai_hasil: Number(jumlah),
      sourceType: 'DETECTION',
    });
  }

  const server_id = input.server_id || uuidv4();
  const activity_id = input.activity_id || uuidv4();
  const now = new Date().toISOString();

  const info = db
    .prepare(
      `INSERT INTO detection (
        local_id, server_id, activity_id, incident_id, user_id, device_id,
        estate_id, afdeling_id, blok_id, baris, posisi, tanggal, waktu, hpt_id, species_id,
        gejala, kondisi_indikator, jumlah_indikasi, catatan, foto_id,
        gps_lat, gps_lng, gps_accuracy, gps_timestamp, location_warning,
        kategori, ews_alert, is_duplicate_suspect, sync_status, sync_attempt, sync_error, source, created_at, updated_at
      ) VALUES (
        @local_id, @server_id, @activity_id, @incident_id, @user_id, @device_id,
        @estate_id, @afdeling_id, @blok_id, @baris, @posisi, @tanggal, @waktu, @hpt_id, @species_id,
        @gejala, @kondisi_indikator, @jumlah_indikasi, @catatan, @foto_id,
        @gps_lat, @gps_lng, @gps_accuracy, @gps_timestamp, @location_warning,
        @kategori, @ews_alert, @is_duplicate_suspect, @sync_status, @sync_attempt, @sync_error, @source, @created_at, @updated_at
      )`
    )
    .run({
      local_id: input.local_id || null,
      server_id,
      activity_id,
      incident_id: engineResult.incident ? engineResult.incident.id : null,
      user_id: ctx.user_id || input.user_id || null,
      device_id: input.device_id || null,
      estate_id,
      afdeling_id,
      blok_id: input.blok_id,
      baris: input.baris ?? null,
      posisi: input.posisi ?? null,
      tanggal: input.tanggal,
      waktu: input.waktu || null,
      hpt_id: input.hpt_id,
      species_id: input.species_id || null,
      gejala: input.gejala || null,
      kondisi_indikator: input.kondisi_indikator || null,
      jumlah_indikasi: jumlah ?? null,
      catatan: input.catatan || null,
      foto_id: input.foto_id || null,
      gps_lat: input.gps_lat ?? null,
      gps_lng: input.gps_lng ?? null,
      gps_accuracy: input.gps_accuracy ?? null,
      gps_timestamp: input.gps_timestamp || null,
      location_warning: location_warning ? 1 : 0,
      kategori: engineResult.kategori,
      ews_alert: engineResult.ews_alert ? 1 : 0,
      is_duplicate_suspect: dup ? 1 : 0,
      sync_status: input.sync_status || 'SYNCED',
      sync_attempt: input.sync_attempt || 0,
      sync_error: input.sync_error || null,
      source: normSource(input.source),
      created_at: input.created_at || now,
      updated_at: now,
    });

  const row = db.prepare('SELECT * FROM detection WHERE id=?').get(info.lastInsertRowid);
  if (engineResult.incident && !engineResult.incident.detection_id) {
    db.prepare('UPDATE incident SET detection_id=? WHERE id=? AND detection_id IS NULL').run(row.id, engineResult.incident.id);
  }
  logAudit({
    user_id: ctx.user_id || input.user_id || null,
    aktivitas: 'CREATE_DETECTION',
    after: row,
    device_source: input.source || ctx.device_source || 'API',
    ip_session: ctx.ip_session || null,
  });
  return { row, engineResult, duplicate: dup, location_warning: !!location_warning };
}

// ---------------------------------------------------------------- SENSUS
function ingestSensus(input, ctx = {}) {
  if (!input.blok_id || !input.jenis_sensus || !input.tanggal) {
    throw Object.assign(new Error('blok_id, jenis_sensus, tanggal wajib diisi'), { status: 400 });
  }
  const blok = getBlok(input.blok_id);
  if (!blok) throw Object.assign(new Error('Blok tidak ditemukan'), { status: 400 });
  const hpt = db.prepare('SELECT * FROM hpt WHERE code=?').get(input.jenis_sensus);
  if (!hpt) throw Object.assign(new Error(`HPT code tidak dikenal: ${input.jenis_sensus}`), { status: 400 });
  const afdeling_id = input.afdeling_id || blok.afdeling_id;
  const afdeling = db.prepare('SELECT * FROM afdeling WHERE id=?').get(afdeling_id);
  const estate_id = input.estate_id || (afdeling ? afdeling.estate_id : null);

  const hasil = input.hasil_json && typeof input.hasil_json === 'object' ? input.hasil_json : JSON.parse(input.hasil_json || '{}');
  const computed = computeByHptCode(hpt.code, hasil);

  const engineResult = runThresholdEngine({
    hpt_id: hpt.id,
    species_id: input.species_id || null,
    blok_id: input.blok_id,
    nilai_hasil: computed.hasil_hitung,
    sourceType: 'SENSUS',
    forced_kandidat_pengendalian: !!computed.forced_kandidat_pengendalian,
  });

  const dup = isLikelyDuplicate('SENSUS', {
    estate_id, afdeling_id, blok_id: input.blok_id, tanggal: input.tanggal, jenis_sensus: input.jenis_sensus, user_id: ctx.user_id || input.user_id,
  });

  const server_id = input.server_id || uuidv4();
  const activity_id = input.activity_id || uuidv4();
  const now = new Date().toISOString();

  const info = db
    .prepare(
      `INSERT INTO sensus (
        local_id, server_id, activity_id, incident_id, jenis_sensus, user_id, device_id,
        estate_id, afdeling_id, blok_id, species_id, jalur_baris, hasil_json, hasil_hitung, kategori,
        saran_pengendalian, gps_lat, gps_lng, gps_accuracy, foto_id, catatan, tanggal,
        ews_alert, is_duplicate_suspect, sync_status, sync_attempt, sync_error, source, created_at, updated_at
      ) VALUES (
        @local_id, @server_id, @activity_id, @incident_id, @jenis_sensus, @user_id, @device_id,
        @estate_id, @afdeling_id, @blok_id, @species_id, @jalur_baris, @hasil_json, @hasil_hitung, @kategori,
        @saran_pengendalian, @gps_lat, @gps_lng, @gps_accuracy, @foto_id, @catatan, @tanggal,
        @ews_alert, @is_duplicate_suspect, @sync_status, @sync_attempt, @sync_error, @source, @created_at, @updated_at
      )`
    )
    .run({
      local_id: input.local_id || null,
      server_id,
      activity_id,
      incident_id: engineResult.incident ? engineResult.incident.id : null,
      jenis_sensus: input.jenis_sensus,
      user_id: ctx.user_id || input.user_id || null,
      device_id: input.device_id || null,
      estate_id,
      afdeling_id,
      blok_id: input.blok_id,
      species_id: input.species_id || null,
      jalur_baris: input.jalur_baris ? JSON.stringify(input.jalur_baris) : null,
      hasil_json: JSON.stringify(hasil),
      hasil_hitung: computed.hasil_hitung,
      kategori: engineResult.kategori,
      saran_pengendalian: engineResult.thresholdRow ? engineResult.thresholdRow.tindakan : null,
      gps_lat: input.gps_lat ?? null,
      gps_lng: input.gps_lng ?? null,
      gps_accuracy: input.gps_accuracy ?? null,
      foto_id: input.foto_id || null,
      catatan: input.catatan || null,
      tanggal: input.tanggal,
      ews_alert: engineResult.ews_alert ? 1 : 0,
      is_duplicate_suspect: dup ? 1 : 0,
      sync_status: input.sync_status || 'SYNCED',
      sync_attempt: input.sync_attempt || 0,
      sync_error: input.sync_error || null,
      source: normSource(input.source),
      created_at: input.created_at || now,
      updated_at: now,
    });

  const row = db.prepare('SELECT * FROM sensus WHERE id=?').get(info.lastInsertRowid);
  if (engineResult.incident && !engineResult.incident.sensus_id) {
    db.prepare('UPDATE incident SET sensus_id=? WHERE id=? AND sensus_id IS NULL').run(row.id, engineResult.incident.id);
  }
  logAudit({
    user_id: ctx.user_id || input.user_id || null,
    aktivitas: 'CREATE_SENSUS',
    after: row,
    device_source: input.source || ctx.device_source || 'API',
    ip_session: ctx.ip_session || null,
  });
  return { row, engineResult, computed, duplicate: dup };
}

// ---------------------------------------------------------------- TREATMENT
function ingestTreatment(input, ctx = {}) {
  if (!input.blok_id || !input.hpt_id) {
    throw Object.assign(new Error('blok_id, hpt_id wajib diisi'), { status: 400 });
  }
  const blok = getBlok(input.blok_id);
  if (!blok) throw Object.assign(new Error('Blok tidak ditemukan'), { status: 400 });
  const afdeling_id = input.afdeling_id || blok.afdeling_id;
  const afdeling = db.prepare('SELECT * FROM afdeling WHERE id=?').get(afdeling_id);
  const estate_id = input.estate_id || (afdeling ? afdeling.estate_id : null);

  let incident = null;
  if (input.incident_id) {
    incident = db.prepare('SELECT * FROM incident WHERE id=?').get(input.incident_id);
  } else {
    incident = db
      .prepare(`SELECT * FROM incident WHERE hpt_id=? AND blok_id=? AND status != 'CLOSED' ORDER BY opened_at DESC LIMIT 1`)
      .get(input.hpt_id, input.blok_id);
  }

  const server_id = input.server_id || uuidv4();
  const activity_id = input.activity_id || uuidv4();
  const now = new Date().toISOString();

  const info = db
    .prepare(
      `INSERT INTO treatment (
        local_id, server_id, activity_id, incident_id, hpt_id, user_id, device_id,
        estate_id, afdeling_id, blok_id, luas_serangan, metode_pengendalian, tanggal_mulai, tanggal_selesai,
        jumlah_pokok, hk, material, jumlah_material, alat, pic, catatan, foto_id, gps_lat, gps_lng, status,
        sync_status, sync_attempt, sync_error, source, created_at, updated_at
      ) VALUES (
        @local_id, @server_id, @activity_id, @incident_id, @hpt_id, @user_id, @device_id,
        @estate_id, @afdeling_id, @blok_id, @luas_serangan, @metode_pengendalian, @tanggal_mulai, @tanggal_selesai,
        @jumlah_pokok, @hk, @material, @jumlah_material, @alat, @pic, @catatan, @foto_id, @gps_lat, @gps_lng, @status,
        @sync_status, @sync_attempt, @sync_error, @source, @created_at, @updated_at
      )`
    )
    .run({
      local_id: input.local_id || null,
      server_id,
      activity_id,
      incident_id: incident ? incident.id : null,
      hpt_id: input.hpt_id,
      user_id: ctx.user_id || input.user_id || null,
      device_id: input.device_id || null,
      estate_id,
      afdeling_id,
      blok_id: input.blok_id,
      luas_serangan: input.luas_serangan ?? null,
      metode_pengendalian: input.metode_pengendalian || null,
      tanggal_mulai: input.tanggal_mulai || null,
      tanggal_selesai: input.tanggal_selesai || null,
      jumlah_pokok: input.jumlah_pokok ?? null,
      hk: input.hk ?? null,
      material: input.material || null,
      jumlah_material: input.jumlah_material ?? null,
      alat: input.alat || null,
      pic: input.pic || null,
      catatan: input.catatan || null,
      foto_id: input.foto_id || null,
      gps_lat: input.gps_lat ?? null,
      gps_lng: input.gps_lng ?? null,
      status: input.status || 'BERJALAN',
      sync_status: input.sync_status || 'SYNCED',
      sync_attempt: input.sync_attempt || 0,
      sync_error: input.sync_error || null,
      source: normSource(input.source),
      created_at: input.created_at || now,
      updated_at: now,
    });

  const row = db.prepare('SELECT * FROM treatment WHERE id=?').get(info.lastInsertRowid);
  if (incident) {
    db.prepare(`UPDATE incident SET treatment_id=?, status = CASE WHEN status IN ('NEW','ACKNOWLEDGED') THEN 'IN_PROGRESS' ELSE status END, updated_at=datetime('now') WHERE id=?`).run(row.id, incident.id);
  }
  logAudit({
    user_id: ctx.user_id || input.user_id || null,
    aktivitas: 'CREATE_TREATMENT',
    after: row,
    device_source: input.source || ctx.device_source || 'API',
    ip_session: ctx.ip_session || null,
  });
  return { row, incident };
}

// ---------------------------------------------------------------- MORTALITY
// "sistem bandingkan dengan threshold efektivitas (contoh: jika ulat hidup masih >2 ekor/pelepah
// -> treatment perlu service)" -- reuses the HPT's own THRESHOLD table (kategori 'EFEKTIF'/
// 'TIDAK_EFEKTIF' style rows keyed by satuan 'ekor/pelepah' or a simple ratio) when available;
// otherwise falls back to a documented default rule so mortality always yields a verdict.
function evaluateEffectiveness({ treatment, jumlah_hidup, sampel }) {
  if (!sampel || sampel <= 0) return { hasil_efektivitas: 'TIDAK_DIKETAHUI', service_required: false };
  const rate = Number(jumlah_hidup) / Number(sampel);
  let hpt_id = treatment ? treatment.hpt_id : null;
  if (hpt_id) {
    const thr = db
      .prepare(
        `SELECT * FROM threshold WHERE hpt_id=? AND kategori='TIDAK_EFEKTIF' AND status='AKTIF' ORDER BY effective_date DESC LIMIT 1`
      )
      .get(hpt_id);
    if (thr && thr.nilai_min !== null && thr.nilai_min !== undefined) {
      const service_required = rate >= thr.nilai_min;
      return { hasil_efektivitas: service_required ? 'TIDAK_EFEKTIF' : 'EFEKTIF', service_required, rate };
    }
  }
  // Documented default fallback (BRD example): masih >2 ekor hidup / sampel -> perlu service.
  const service_required = rate > 2;
  return { hasil_efektivitas: service_required ? 'TIDAK_EFEKTIF' : 'EFEKTIF', service_required, rate };
}

function ingestMortality(input, ctx = {}) {
  if (!input.tanggal) throw Object.assign(new Error('tanggal wajib diisi'), { status: 400 });

  let treatment = null;
  if (input.treatment_id) treatment = db.prepare('SELECT * FROM treatment WHERE id=?').get(input.treatment_id);
  let incident = null;
  if (input.incident_id) incident = db.prepare('SELECT * FROM incident WHERE id=?').get(input.incident_id);
  else if (treatment && treatment.incident_id) incident = db.prepare('SELECT * FROM incident WHERE id=?').get(treatment.incident_id);

  const evalResult = evaluateEffectiveness({ treatment, jumlah_hidup: input.jumlah_hidup, sampel: input.sampel });

  const server_id = input.server_id || uuidv4();
  const activity_id = input.activity_id || uuidv4();
  const now = new Date().toISOString();

  const info = db
    .prepare(
      `INSERT INTO mortality (
        local_id, server_id, activity_id, incident_id, treatment_id, user_id, device_id, tanggal, blok, blok_id,
        sampel, jumlah_hidup, jumlah_mati, kondisi, foto_id, gps_lat, gps_lng, hasil_efektivitas, service_required, status,
        sync_status, sync_attempt, sync_error, source, created_at, updated_at
      ) VALUES (
        @local_id, @server_id, @activity_id, @incident_id, @treatment_id, @user_id, @device_id, @tanggal, @blok, @blok_id,
        @sampel, @jumlah_hidup, @jumlah_mati, @kondisi, @foto_id, @gps_lat, @gps_lng, @hasil_efektivitas, @service_required, @status,
        @sync_status, @sync_attempt, @sync_error, @source, @created_at, @updated_at
      )`
    )
    .run({
      local_id: input.local_id || null,
      server_id,
      activity_id,
      incident_id: incident ? incident.id : null,
      treatment_id: treatment ? treatment.id : null,
      user_id: ctx.user_id || input.user_id || null,
      device_id: input.device_id || null,
      tanggal: input.tanggal,
      blok: input.blok || null,
      blok_id: input.blok_id || (treatment ? treatment.blok_id : null) || null,
      sampel: input.sampel ?? null,
      jumlah_hidup: input.jumlah_hidup ?? null,
      jumlah_mati: input.jumlah_mati ?? null,
      kondisi: input.kondisi || null,
      foto_id: input.foto_id || null,
      gps_lat: input.gps_lat ?? null,
      gps_lng: input.gps_lng ?? null,
      hasil_efektivitas: evalResult.hasil_efektivitas,
      service_required: evalResult.service_required ? 1 : 0,
      status: input.status || 'SELESAI',
      sync_status: input.sync_status || 'SYNCED',
      sync_attempt: input.sync_attempt || 0,
      sync_error: input.sync_error || null,
      source: normSource(input.source),
      created_at: input.created_at || now,
      updated_at: now,
    });

  const row = db.prepare('SELECT * FROM mortality WHERE id=?').get(info.lastInsertRowid);

  if (incident) {
    db.prepare('UPDATE incident SET mortality_id=?, updated_at=datetime(\'now\') WHERE id=?').run(row.id, incident.id);
    if (evalResult.hasil_efektivitas === 'EFEKTIF') {
      // V2 7-state alert/incident flow (SPEC_V2.md section 1 item 6): the old 'CONTROLLED' value
      // is retired, use 'COMPLETED'.
      db.prepare(`UPDATE incident SET status='COMPLETED' WHERE id=? AND status NOT IN ('CLOSED')`).run(incident.id);
    }
  }

  // Notification trigger: mortalitas tidak efektif / service diperlukan (BRD 02 section 20 rule).
  if (evalResult.service_required && incident) {
    const { provider, buildAlertMessage } = require('./notificationProvider');
    const hpt = incident.hpt_id ? db.prepare('SELECT * FROM hpt WHERE id=?').get(incident.hpt_id) : null;
    const blok = row.blok_id ? db.prepare('SELECT * FROM blok WHERE id=?').get(row.blok_id) : null;
    const alertInfo = db
      .prepare(
        `INSERT INTO alert (incident_id, hpt_id, estate_id, afdeling_id, blok_id, hasil, threshold_ref, kategori, status, source_type, source_id)
         VALUES (?, ?, ?, ?, ?, ?, 'Mortalitas: perlu service', 'SERVICE_REQUIRED', 'NEW', 'MORTALITY', ?)`
      )
      .run(incident.id, incident.hpt_id, incident.estate_id, incident.afdeling_id, row.blok_id, evalResult.rate ?? null, row.id);
    const alert = db.prepare('SELECT * FROM alert WHERE id=?').get(alertInfo.lastInsertRowid);
    const { subject, message } = buildAlertMessage({ incident, alert, hptName: hpt ? hpt.name : null, blokLabel: blok ? `Blok ${blok.code}` : '' });
    const notifInfo = db.prepare(`INSERT INTO notification (alert_id, channel, recipient, status) VALUES (?, 'DASHBOARD', 'dashboard', 'PENDING')`).run(alert.id);
    provider.send({ channel: 'DASHBOARD', recipient: 'dashboard', subject, message }).then((res) => {
      db.prepare(`UPDATE notification SET status=?, sent_at=datetime('now'), response_provider=? WHERE id=?`).run(res.status, res.response_provider, notifInfo.lastInsertRowid);
    });
  }

  logAudit({
    user_id: ctx.user_id || input.user_id || null,
    aktivitas: 'CREATE_MORTALITY',
    after: row,
    device_source: input.source || ctx.device_source || 'API',
    ip_session: ctx.ip_session || null,
  });
  return { row, evalResult, incident };
}

// ---------------------------------------------------------------- AGRO OBSERVATION (BRD V3)
// Generic severity-based capture for the 10 new Agro indicators with no dedicated table
// (AGR-005..014, see db/seedEwsDictionaryV3.js). Same shape as ingestDetection/ingestSensus, but
// classification goes through the V2/V3-native services/ruleEngine.js computeIndicatorResult()
// (context='AGRO_OBSERVATION') rather than the V1 sensusEngines.js path, since these indicators
// have no legacy V1 formula to preserve -- same idiom as routes/yieldMaking.js's tryClassify().
// Soft-fails (kategori=null) if no formula/threshold is configured for the indicator yet, so field
// data can still be captured before Rule & Parameter Management setup is complete -- matching
// yieldMaking.js's tryClassify() exactly, not a new convention.
function tryClassifyAgro(hptCode, payload, blok, ctx) {
  try {
    const result = computeIndicatorResult(hptCode, payload, blok, { context: 'AGRO_OBSERVATION', sourceType: 'AGRO_OBSERVATION', user_id: ctx.user_id });
    return { kategori: result.kategori, ews_alert: result.alert_required ? 1 : 0, incident: result.engineResult.incident, alert: result.engineResult.alert, rule_version_id: result.rule_version_id };
  } catch (e) {
    return { kategori: payload.kategori || null, ews_alert: 0, incident: null, alert: null, rule_version_id: null, classify_error: e.message };
  }
}

function ingestAgroObservation(input, ctx = {}) {
  if (!input.blok_id || !input.hpt_id || !input.ews_id || !input.tanggal) {
    throw Object.assign(new Error('blok_id, hpt_id, ews_id, tanggal wajib diisi'), { status: 400 });
  }
  const blok = getBlok(input.blok_id);
  if (!blok) throw Object.assign(new Error('Blok tidak ditemukan'), { status: 400 });
  const hpt = getHpt(input.hpt_id);
  if (!hpt) throw Object.assign(new Error('Indikator (hpt_id) tidak ditemukan'), { status: 400 });
  const afdeling_id = input.afdeling_id || blok.afdeling_id;
  const afdeling = db.prepare('SELECT * FROM afdeling WHERE id=?').get(afdeling_id);
  const estate_id = input.estate_id || (afdeling ? afdeling.estate_id : null);

  const location_warning = checkLocationWarning(blok, input.gps_lat, input.gps_lng);
  const classified = tryClassifyAgro(hpt.code, input, blok, { user_id: ctx.user_id || input.user_id });

  const server_id = input.server_id || uuidv4();
  const now = new Date().toISOString();

  const info = db
    .prepare(
      `INSERT INTO agro_observation (
        local_id, server_id, incident_id, user_id, device_id,
        estate_id, afdeling_id, blok_id, hpt_id, ews_id, tanggal,
        nilai_ukur, kategori, ews_alert, catatan,
        gps_lat, gps_lng, gps_accuracy, location_warning, foto_id, petugas,
        sync_status, sync_attempt, sync_error, source, created_at, updated_at
      ) VALUES (
        @local_id, @server_id, @incident_id, @user_id, @device_id,
        @estate_id, @afdeling_id, @blok_id, @hpt_id, @ews_id, @tanggal,
        @nilai_ukur, @kategori, @ews_alert, @catatan,
        @gps_lat, @gps_lng, @gps_accuracy, @location_warning, @foto_id, @petugas,
        @sync_status, @sync_attempt, @sync_error, @source, @created_at, @updated_at
      )`
    )
    .run({
      local_id: input.local_id || null,
      server_id,
      incident_id: classified.incident ? classified.incident.id : null,
      user_id: ctx.user_id || input.user_id || null,
      device_id: input.device_id || null,
      estate_id,
      afdeling_id,
      blok_id: input.blok_id,
      hpt_id: input.hpt_id,
      ews_id: input.ews_id,
      tanggal: input.tanggal,
      nilai_ukur: input.nilai_ukur ?? null,
      kategori: classified.kategori,
      ews_alert: classified.ews_alert,
      catatan: input.catatan || null,
      gps_lat: input.gps_lat ?? null,
      gps_lng: input.gps_lng ?? null,
      gps_accuracy: input.gps_accuracy ?? null,
      location_warning: location_warning ? 1 : 0,
      foto_id: input.foto_id || null,
      petugas: input.petugas || null,
      sync_status: input.sync_status || 'SYNCED',
      sync_attempt: input.sync_attempt || 0,
      sync_error: input.sync_error || null,
      source: normSource(input.source),
      created_at: input.created_at || now,
      updated_at: now,
    });

  const row = db.prepare('SELECT * FROM agro_observation WHERE id=?').get(info.lastInsertRowid);
  if (classified.incident && !classified.incident.detection_id) {
    // agro_observation has no dedicated incident.*_id column (unlike detection/sensus/treatment/
    // mortality) -- the link back is via incident_id on this row only, which is sufficient for
    // Export/Alert Center traceability without an idempotent schema migration to incident.
  }
  logAudit({
    user_id: ctx.user_id || input.user_id || null,
    aktivitas: 'CREATE_AGRO_OBSERVATION',
    after: row,
    device_source: input.source || ctx.device_source || 'API',
    ip_session: ctx.ip_session || null,
  });
  return { row, classified, location_warning: !!location_warning };
}

module.exports = { ingestDetection, ingestSensus, ingestTreatment, ingestMortality, ingestAgroObservation, evaluateEffectiveness };
