const XLSX = require('xlsx');
const wb = XLSX.readFile('seed_data/defisiensi_hara_lsu_2026.xlsx', { cellDates: true });
const ws = wb.Sheets['FR Kalbar Leaf Analysis (New)'];
const range = XLSX.utils.decode_range(ws['!ref']);
function cell(r,c){ const cc = ws[XLSX.utils.encode_cell({r,c})]; return cc ? cc.v : null; }

const labelRow = 2, kebunCol=0, afdCol=1, blokCol=3;
const map = require('./_map_tmp.json');
