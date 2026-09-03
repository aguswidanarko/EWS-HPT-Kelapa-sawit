import React, { useEffect, useState } from 'react';
import SelectField from './SelectField';
import { useAfdelings, useBisnisUnits, useBloks, useEstates, useRegions } from '../hooks/useMasterData';

export interface LocationValue {
  estate_id: number | null;
  afdeling_id: number | null;
  blok_id: number | null;
}

interface Props {
  value: LocationValue;
  onChange: (v: LocationValue) => void;
}

/** Cascading PT -> Afdeling -> Blok picker backed by the locally cached master data (works fully
 * offline once "Download data offline" has run at least once).
 *
 * V3.2: Region and Bisnis Unit are shown ABOVE the PT picker purely as local narrowing filters --
 * with ~50 PT across 3 Region since Master Blok Terpusat, a flat PT dropdown is unwieldy. They are
 * NOT part of LocationValue/onChange (a submitted record still only ever carries estate_id/
 * afdeling_id/blok_id, exactly as before) so this stays a self-contained change: every one of the
 * ~15 screens that already use LocationCascade needs zero changes. Changing a parent level clears
 * every level below it, same as before. */
export default function LocationCascade({ value, onChange }: Props) {
  const regions = useRegions();
  const [regionId, setRegionId] = useState<number | null>(null);
  const bisnisUnits = useBisnisUnits(regionId);
  const [bisnisUnitId, setBisnisUnitId] = useState<number | null>(null);
  const estates = useEstates(bisnisUnitId);
  const afdelings = useAfdelings(value.estate_id);
  const bloks = useBloks(value.afdeling_id);

  // If the previously selected afdeling/blok no longer belongs under the new parent, drop it.
  useEffect(() => {
    if (value.afdeling_id && !afdelings.some((a) => a.id === value.afdeling_id) && afdelings.length > 0) {
      onChange({ ...value, afdeling_id: null, blok_id: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [afdelings]);

  useEffect(() => {
    if (value.blok_id && !bloks.some((b) => b.id === value.blok_id) && bloks.length > 0) {
      onChange({ ...value, blok_id: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bloks]);

  return (
    <>
      <SelectField
        label="Region"
        value={regionId}
        options={regions.map((r) => ({ label: r.name, value: r.id }))}
        onChange={(v) => {
          setRegionId(v);
          setBisnisUnitId(null);
          onChange({ estate_id: null, afdeling_id: null, blok_id: null });
        }}
      />
      <SelectField
        label="Bisnis Unit"
        value={bisnisUnitId}
        options={bisnisUnits.map((b) => ({ label: b.name, value: b.id }))}
        onChange={(v) => {
          setBisnisUnitId(v);
          onChange({ estate_id: null, afdeling_id: null, blok_id: null });
        }}
        disabled={!regionId}
      />
      <SelectField
        label="PT"
        required
        value={value.estate_id}
        options={estates.map((e) => ({ label: e.name, value: e.id }))}
        onChange={(v) => onChange({ estate_id: v, afdeling_id: null, blok_id: null })}
      />
      <SelectField
        label="Afdeling"
        required
        value={value.afdeling_id}
        options={afdelings.map((a) => ({ label: a.name, value: a.id }))}
        onChange={(v) => onChange({ ...value, afdeling_id: v, blok_id: null })}
        disabled={!value.estate_id}
      />
      <SelectField
        label="Blok"
        required
        value={value.blok_id}
        options={bloks.map((b) => ({ label: `${b.code} - ${b.name} (${b.status_tanaman})`, value: b.id }))}
        onChange={(v) => onChange({ ...value, blok_id: v })}
        disabled={!value.afdeling_id}
      />
    </>
  );
}
