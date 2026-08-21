import { Field } from './Common';

export default function LocationFilterFields({ filters, setFilters, md, includeBlok = true }) {
  const afdelingOptions = filters.estate_id ? md.afdelingsByEstate(filters.estate_id) : md.afdelings;
  const blokOptions = filters.afdeling_id ? md.bloksByAfdeling(filters.afdeling_id) : md.bloks;

  return (
    <>
      <Field label="Estate">
        <select
          value={filters.estate_id}
          onChange={(e) => setFilters((f) => ({ ...f, estate_id: e.target.value, afdeling_id: '', blok_id: '' }))}
        >
          <option value="">Semua</option>
          {md.estates.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
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
