import React, { useEffect } from 'react';
import SelectField from './SelectField';
import { useAfdelings, useBloks, useEstates } from '../hooks/useMasterData';

export interface LocationValue {
  estate_id: number | null;
  afdeling_id: number | null;
  blok_id: number | null;
}

interface Props {
  value: LocationValue;
  onChange: (v: LocationValue) => void;
}

/** Cascading Estate -> Afdeling -> Blok picker backed by the locally cached master data (works
 * fully offline once "Download data offline" has run at least once). Changing a parent level
 * clears the levels below it. */
export default function LocationCascade({ value, onChange }: Props) {
  const estates = useEstates();
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
        label="Estate"
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
