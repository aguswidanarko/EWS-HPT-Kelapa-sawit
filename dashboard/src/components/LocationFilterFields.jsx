import { useState } from 'react';
import { Field } from './Common';

// V3.2: a "Bisnis Unit" narrowing dropdown is offered purely as a local UI convenience (there are
// now ~50 PT across 3 Region, so jumping straight to a flat PT list is unwieldy) -- it is NOT
// added to `filters`/onChange, so none of this component's callers (Deteksi/Sensus/Pengendalian/
// DefisiensiHara/YieldModulePage) need any changes to their own filter state shape.
export default function LocationFilterFields({ filters, setFilters, md, includeBlok = true }) {
  const [businessUnitId, setBusinessUnitId] = useState('');
  const estateOptions = businessUnitId ? md.estatesByBusinessUnit(businessUnitId) : md.estates;
  const afdelingOptions = filters.estate_id ? md.afdelingsByEstate(filters.estate_id) : md.afdelings;
  const blokOptions = filters.afdeling_id ? md.bloksByAfdeling(filters.afdeling_id) : md.bloks;

  return (
    <>
      <Field label="Bisnis Unit">
        <select
          value={businessUnitId}
          onChange={(e) => {
            setBusinessUnitId(e.target.value);
            setFilters((f) => ({ ...f, estate_id: '', afdeling_id: '', blok_id: '' }));
          }}
        >
          <option value="">Semua</option>
          {md.businessUnits.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </Field>
      <Field label="PT">
        <select
          value={filters.estate_id}
          onChange={(e) => setFilters((f) => ({ ...f, estate_id: e.target.value, afdeling_id: '', blok_id: '' }))}
        >
          <option value="">Semua</option>
          {estateOptions.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </Field>
      <Field label="Afdeling">
        <select
          value={filters.afdeling_id}
          onChange={(e) => setFilters((f) => ({ ...f, afdeling_id: e.target.value, blok_id: '' }))}
        >
          <option value="">Semua</option>
          {afdelingOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>
      {includeBlok && (
        <Field label="Blok">
          <select
            value={filters.blok_id}
            onChange={(e) => setFilters((f) => ({ ...f, blok_id: e.target.value }))}
          >
            <option value="">Semua</option>
            {blokOptions.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
          </select>
        </Field>
      )}
    </>
  );
}
