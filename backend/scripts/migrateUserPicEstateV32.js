// V3.2 Master Blok Terpusat: reassigns user/PIC scoping from old (pre-V3.2) PT records to their
// confirmed new PT records, per docs/MIGRASI_MASTER_BLOK_V32.md section 3.
//
// IMPORTANT -- what this script does NOT touch: historical field data (detection/sensus/
// treatment/mortality/yield_making/defisiensi_hara/agro_observation/assessment/...) is never
// modified here. Those rows stay pointed at their original (old) blok/afdeling/estate forever --
// that is intentional and safe (see docs/MIGRASI_MASTER_BLOK_V32.md section 2). This script only
// updates the FORWARD-looking scoping columns `user.estate_id` and `pic.estate_id`, so that after
// the V3.2 Master Blok upload, staff who were assigned to an old PT keep seeing the right PT in
// the app going forward.
//
// Only estate_id (PT-level) is reassigned. user.afdeling_id/pic.afdeling_id/pic.blok_id are left
// untouched deliberately: old afdeling codes (free text, e.g. "AFDKCK") and new afdeling codes
// (standardized "AFD 1".."AFD 7") use completely unrelated naming schemes, so there is no reliable
// automatic way to map one to the other (confirmed while building this mapping -- see the
// analysis in Usulan_Pemetaan_PT_Lama_ke_Baru_V32.xlsx). Those old afdeling/blok rows remain valid
// (never deleted while referenced) so nothing breaks; an admin can manually tighten a user's
// afdeling/blok scope to the new hierarchy via the dashboard's PIC/User page at their own pace.
//
// Usage:
//   node scripts/migrateUserPicEstateV32.js            (dry-run: prints what WOULD change)
//   node scripts/migrateUserPicEstateV32.js --apply     (actually applies the changes)
//
// Run this AFTER the Master Blok (Upload) commit has been applied (so the new PT codes below
// already exist), and ideally right before going live with the V3.2 mobile app build.

const db = require('../src/db/db');

// Confirmed by the plantation admin (Usulan_Pemetaan_PT_Lama_ke_Baru_V32.xlsx, column "Kode PT
// Baru DIKONFIRMASI"), 2026-09-03. kode_lama must match estate.code as it exists TODAY (before
// this script runs); kode_baru must match a PT already created by the Master Blok upload.
const MAPPING = [
  { kode_lama: 'KALE', kode_baru: 'KALE' },
  { kode_lama: 'LS 1', kode_baru: 'LS-1' },
  { kode_lama: 'USP', kode_baru: 'USP' },
  { kode_lama: 'LS 2', kode_baru: 'LS-2' },
  { kode_lama: 'SMP 1', kode_baru: 'SMP-1' },
  { kode_lama: 'FAPE', kode_baru: 'FAPE' },
  { kode_lama: 'MKSK', kode_baru: 'MKS-2' },
  { kode_lama: 'SMP 2', kode_baru: 'SMP-2' },
  { kode_lama: 'MKSS', kode_baru: 'MKS-1' },
  { kode_lama: 'LS I', kode_baru: 'LS-1' },
  { kode_lama: 'LS II', kode_baru: 'LS-2' },
  { kode_lama: 'KALE II', kode_baru: 'KALE' },
  { kode_lama: 'SMP-1', kode_baru: 'SMP-1' }, // already identical -- no-op, kept for completeness
  { kode_lama: 'KALE I', kode_baru: 'KALE' },
  { kode_lama: 'PTLJ', kode_baru: 'PTLJ' },
  { kode_lama: 'BKP', kode_baru: 'BKP' },
  { kode_lama: 'SMP-2', kode_baru: 'SMP-2' }, // already identical -- no-op, kept for completeness
  { kode_lama: 'PISP1', kode_baru: 'PISP-1' },
  { kode_lama: 'PSA', kode_baru: 'PSA' },
  { kode_lama: 'SIRL1', kode_baru: 'SIR-1' },
  { kode_lama: 'EST1', kode_baru: 'PISP-2' },
  { kode_lama: 'KTBM', kode_baru: 'KTBM-2' },
];

function main() {
  const apply = process.argv.includes('--apply');
  console.log(apply ? '=== APPLYING changes ===' : '=== DRY RUN (pass --apply to actually change data) ===');

  const findEstate = db.prepare('SELECT id, code FROM estate WHERE code = ?');
  const rows = [];

  for (const { kode_lama, kode_baru } of MAPPING) {
    const oldEstate = findEstate.get(kode_lama);
    const newEstate = findEstate.get(kode_baru);

    if (!oldEstate) {
      rows.push({ kode_lama, kode_baru, status: 'SKIP (PT lama tidak ditemukan -- mungkin sudah tidak ada/sudah dimigrasikan sebelumnya)', users: 0, pics: 0 });
      continue;
    }
    if (!newEstate) {
      rows.push({ kode_lama, kode_baru, status: 'ERROR (PT baru tidak ditemukan -- pastikan Master Blok sudah diupload/diterapkan dulu)', users: 0, pics: 0 });
      continue;
    }
    if (oldEstate.id === newEstate.id) {
      rows.push({ kode_lama, kode_baru, status: 'NO-OP (kode lama = kode baru, sudah PT yang sama)', users: 0, pics: 0 });
      continue;
    }

    const userCount = db.prepare('SELECT COUNT(*) c FROM user WHERE estate_id = ?').get(oldEstate.id).c;
    const picCount = db.prepare('SELECT COUNT(*) c FROM pic WHERE estate_id = ?').get(oldEstate.id).c;

    if (apply && (userCount > 0 || picCount > 0)) {
      const run = db.transaction(() => {
        db.prepare('UPDATE user SET estate_id = ?, updated_at = datetime(\'now\') WHERE estate_id = ?').run(newEstate.id, oldEstate.id);
        db.prepare('UPDATE pic SET estate_id = ? WHERE estate_id = ?').run(newEstate.id, oldEstate.id);
      });
      run();
    }

    rows.push({
      kode_lama,
      kode_baru,
      status: userCount === 0 && picCount === 0 ? 'NO-OP (tidak ada user/PIC di PT lama ini)' : (apply ? 'APPLIED' : 'WOULD APPLY'),
      users: userCount,
      pics: picCount,
    });
  }

  console.table(rows);
  const totalUsers = rows.reduce((s, r) => s + r.users, 0);
  const totalPics = rows.reduce((s, r) => s + r.pics, 0);
  console.log(`Total: ${totalUsers} user, ${totalPics} PIC assignment ${apply ? 'dipindahkan' : 'akan dipindahkan (jalankan ulang dengan --apply)'}.`);
}

main();
