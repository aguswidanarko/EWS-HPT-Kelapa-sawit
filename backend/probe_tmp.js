const XLSX = require('xlsx');
const path = require('path');
const wb = XLSX.readFile('/home/claude/ews-hpt/backend/seed_data/defisiensi_hara_lsu_2026.xlsx', { cellDates: true });
const ws = wb.Sheets['FR Kalbar Leaf Analysis (New)'];
const range = XLSX.utils.decode_range(ws['!ref']);

function cell(r,c){ const cc = ws[XLSX.utils.encode_cell({r,c})]; return cc ? cc.v : null; }
function normLabel(v){ return String(v==null?'':v).trim().toLowerCase(); }

// find label row within first 10 rows containing kebun & blok
let labelRow = null;
for (let r=0;r<10;r++){
  let hasKebun=false, hasBlok=false;
  for (let c=range.s.c;c<=range.e.c;c++){
    const v = normLabel(cell(r,c));
    if (v==='kebun') hasKebun=true;
    if (v==='blok') hasBlok=true;
  }
  if (hasKebun && hasBlok) { labelRow = r; break; }
}
console.log('labelRow', labelRow);

let kebunCol=null, afdCol=null, blokCol=null;
for (let c=range.s.c;c<=range.e.c;c++){
  const v = normLabel(cell(labelRow,c));
  if (v==='kebun') kebunCol=c;
  else if (v==='afd') afdCol=c;
  else if (v==='blok') blokCol=c;
}
console.log('kebunCol',kebunCol,'afdCol',afdCol,'blokCol',blokCol);

const merges = ws['!merges']||[];
const groupRow = labelRow - 1;
const ELEMENTS = ['N','P','K','Mg','Cu','B'];
const candidates = []; // {year, element, col}
for (const m of merges) {
  if (m.s.r !== groupRow) continue;
  const label = String(cell(groupRow, m.s.c) || '');
  const match = label.match(/status hara\s*(\d{4})/i);
  if (!match) continue;
  const year = parseInt(match[1],10);
  for (let c=m.s.c; c<=m.e.c; c++){
    const elLabel = String(cell(labelRow,c)||'').trim();
    const found = ELEMENTS.find(e=>e.toLowerCase()===elLabel.toLowerCase());
    if (found) candidates.push({year, element: found, col: c});
  }
}
console.log('candidates count', candidates.length);

// classify each candidate col by sampling data rows
const dataStart = labelRow+1;
function classify(col){
  let numCount=0, codeCount=0, sampled=0;
  for (let r=dataStart; r<Math.min(dataStart+200, range.e.r+1) && sampled<80; r++){
    const v = cell(r,col);
    if (v===null || v==='') continue;
    sampled++;
    if (typeof v === 'number') numCount++;
    else {
      const s = String(v).trim().toUpperCase();
      if (/^[DLOHE]$/.test(s)) codeCount++;
    }
  }
  if (numCount>codeCount) return 'VALUE';
  if (codeCount>numCount) return 'CODE';
  return 'UNKNOWN';
}

const map = {}; // year|element -> {valueCol, codeCol}
const conflicts = [];
for (const cand of candidates) {
  const kind = classify(cand.col);
  const key = `${cand.year}|${cand.element}`;
  map[key] = map[key] || {};
  if (kind === 'VALUE') {
    if (map[key].valueCol !== undefined) conflicts.push({key, kind, old: map[key].valueCol, new: cand.col});
    else map[key].valueCol = cand.col;
  } else if (kind === 'CODE') {
    if (map[key].codeCol !== undefined) conflicts.push({key, kind, old: map[key].codeCol, new: cand.col});
    else map[key].codeCol = cand.col;
  } else {
    conflicts.push({key, kind:'UNKNOWN', col: cand.col});
  }
}
console.log('map keys', Object.keys(map).length);
console.log(JSON.stringify(map, null, 2));
console.log('conflicts', conflicts);

// count rows and unpivoted leaf_analysis candidate rows
let dataRows=0, skippedNoLoc=0, unpivoted=0, hasilNull=0;
for (let r=dataStart; r<=range.e.r; r++){
  const kebun = cell(r,kebunCol), afd = cell(r,afdCol), blok = cell(r,blokCol);
  const kebunEmpty = kebun===null || String(kebun).trim()==='';
  const afdEmpty = afd===null || String(afd).trim()==='';
  const blokEmpty = blok===null || String(blok).trim()==='';
  if (kebunEmpty && afdEmpty && blokEmpty) continue; // fully blank row, not counted at all
  dataRows++;
  if (kebunEmpty || afdEmpty || blokEmpty) { skippedNoLoc++; continue; }
  for (const key of Object.keys(map)) {
    const {valueCol} = map[key];
    const v = cell(r, valueCol);
    if (v===null || v==='' ) { hasilNull++; continue; }
    const n = Number(v);
    if (Number.isNaN(n)) { hasilNull++; continue; }
    unpivoted++;
  }
}
console.log({dataRows, skippedNoLoc, unpivoted, hasilNull});

// print sample record for row 3 (0-indexed, first data row) for year 2022 element N
const sampleRow = dataStart;
console.log('kebun', cell(sampleRow,kebunCol), 'afd', cell(sampleRow,afdCol), 'blok', cell(sampleRow,blokCol));
for (const key of ['2022|N','2023|P','2026|B']) {
  const {valueCol, codeCol} = map[key];
  console.log(key, 'value=', cell(sampleRow,valueCol), 'code=', cell(sampleRow,codeCol));
}
