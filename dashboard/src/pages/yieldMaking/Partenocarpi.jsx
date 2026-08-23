import { useAuth, canCreateYieldMaking } from '../../context/AuthContext';
import { yieldMakingApi } from '../../api/resources';
import YieldModulePage from './YieldModulePage';

const FIELDS = [
  { key: 'periode', label: 'Periode', type: 'text' },
  { key: 'rainfall_mm', label: 'Curah Hujan (mm/bulan)', type: 'number' },
  { key: 'indikator_hujan_pagi', label: 'Hujan Pagi–Siang (mm/periode)', type: 'number' },
  { key: 'total_bunch', label: 'Bunga Jantan Antesis (tandan/ha)', type: 'number' },
  { key: 'abnormal_bunch', label: 'Jumlah Abnormal Bunch', type: 'number' },
  { key: 'abnormal_bunch_pct', label: 'Abnormal Bunch (%)', type: 'number' },
  { key: 'populasi_ek', label: 'Populasi Elaeidobius (ekor/ha)', type: 'number' },
];

export default function Partenocarpi() {
  const { user } = useAuth();
  return (
    <YieldModulePage
      title="Partenocarpi / Elaeidobius"
      description="Sensus bunga jantan antesis, populasi Elaeidobius kamerunicus, dan abnormal bunch — minimal 6 baris sensus/blok, bulanan."
      api={yieldMakingApi.partenocarpi}
      fields={FIELDS}
      listExtraKeys={['total_bunch', 'abnormal_bunch_pct', 'populasi_ek']}
      canCreate={canCreateYieldMaking(user)}
      thresholdNote="Ambang EWS (FR, dapat diubah di Rule & Parameter Management): bunga jantan antesis < 4 tandan/ha DAN populasi EK < 20.000 ekor/ha DAN curah hujan > 270 mm/bulan DAN > 20 mm/periode pagi–siang; abnormal bunch harian > 1%."
    />
  );
}
