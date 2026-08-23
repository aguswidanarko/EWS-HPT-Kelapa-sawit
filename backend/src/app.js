// Express app wiring. CommonJS throughout (see README "Module system").

const express = require('express');
const cors = require('cors');
const path = require('path');
const { errorHandler } = require('./middleware/errorHandler');
const { UPLOAD_ROOT } = require('./middleware/upload');

const app = express();

app.use(cors()); // internal dev build: all origins allowed (dashboard + mobile call this API)
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Static file serving for uploaded photos / knowledge base docs / GeoJSON layers.
app.use('/uploads', express.static(UPLOAD_ROOT));

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'ews-hpt-backend', time: new Date().toISOString() }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/master', require('./routes/masterData'));
app.use('/api/knowledge-base', require('./routes/knowledgeBase'));
app.use('/api/users', require('./routes/users'));
app.use('/api/schedule', require('./routes/schedule'));
app.use('/api/detections', require('./routes/detection'));
app.use('/api/sensus', require('./routes/sensus'));
app.use('/api/treatment', require('./routes/treatment'));
app.use('/api/mortality', require('./routes/mortality'));
app.use('/api/photos', require('./routes/photos'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/incidents', require('./routes/incidents'));
app.use('/api/gis', require('./routes/gis'));
app.use('/api/import/pisp1', require('./routes/importPisp1'));
app.use('/api/import', require('./routes/importExcel'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/data-quality', require('./routes/dataQuality'));
app.use('/api/sync-monitoring', require('./routes/syncMonitoring'));
app.use('/api/notification-rules', require('./routes/notificationRules'));
app.use('/api/audit-log', require('./routes/auditLog'));

// ===================== V2 routes (SPEC_V2.md section 4 Backend) =====================
app.use('/api/action-plans', require('./routes/actionPlans'));
app.use('/api/yield-making', require('./routes/yieldMaking'));
app.use('/api/leaf-analysis', require('./routes/leafAnalysis'));
app.use('/api/defisiensi-hara', require('./routes/defisiensiHara'));
app.use('/api/scoring', require('./routes/scoring'));
app.use('/api/scheduling-rules', require('./routes/schedulingRules'));
app.use('/api/formulas', require('./routes/formulas'));

app.use((req, res) => res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` }));
app.use(errorHandler);

module.exports = app;
