// Multer configs for file uploads: photos (mobile field evidence), knowledge base documents,
// GeoJSON map layers, Excel import files. Restricted by mime type + size per BRD 02 section 54.

const path = require('path');
const fs = require('fs');
const multer = require('multer');

const UPLOAD_ROOT = process.env.EWS_UPLOAD_ROOT || path.join(__dirname, '..', '..', 'uploads');
const PHOTOS_DIR = path.join(UPLOAD_ROOT, 'photos');
const KB_DIR = path.join(UPLOAD_ROOT, 'knowledge-base');
const MAPS_DIR = path.join(UPLOAD_ROOT, 'maps');
const IMPORTS_DIR = path.join(UPLOAD_ROOT, 'imports');

for (const dir of [PHOTOS_DIR, KB_DIR, MAPS_DIR, IMPORTS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

function makeStorage(dir) {
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '';
      const stamp = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, `${stamp}${ext}`);
    },
  });
}

const PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const KB_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/webp',
];
const GEOJSON_MIME = ['application/json', 'application/geo+json', 'text/plain'];
const EXCEL_MIME = [
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
];

function fileFilterFor(allowedMimes, allowedExts) {
  return (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedMimes.includes(file.mimetype) || (allowedExts && allowedExts.includes(ext))) {
      return cb(null, true);
    }
    cb(new Error(`Tipe file tidak diizinkan: ${file.mimetype || ext}`));
  };
}

const uploadPhoto = multer({
  storage: makeStorage(PHOTOS_DIR),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB (mobile compresses before upload per BRD 01 §15)
  fileFilter: fileFilterFor(PHOTO_MIME, ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']),
});

const uploadKnowledgeBase = multer({
  storage: makeStorage(KB_DIR),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: fileFilterFor(KB_MIME, ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.jpg', '.jpeg', '.png']),
});

const uploadGeoJSON = multer({
  storage: makeStorage(MAPS_DIR),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: fileFilterFor(GEOJSON_MIME, ['.json', '.geojson']),
});

const uploadExcel = multer({
  storage: makeStorage(IMPORTS_DIR),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: fileFilterFor(EXCEL_MIME, ['.xls', '.xlsx', '.csv']),
});

module.exports = {
  UPLOAD_ROOT,
  PHOTOS_DIR,
  KB_DIR,
  MAPS_DIR,
  IMPORTS_DIR,
  uploadPhoto,
  uploadKnowledgeBase,
  uploadGeoJSON,
  uploadExcel,
};
