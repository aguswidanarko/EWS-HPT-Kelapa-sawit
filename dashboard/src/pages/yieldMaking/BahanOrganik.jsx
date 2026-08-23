import { useAuth, canCreateYieldMaking } from '../../context/AuthContext';
import { yieldMakingApi } from '../../api/resources';
import YieldModulePage from './YieldModulePage';

const FIELDS = [
  { key: 'area_type', label: 'Tipe Area', type: 'select', options: [{ value: 'PASIR', label: 'Area Pasir' }, { value: 'LAINNYA', label: 'Lainnya' }] },
  { key: 'total_sample', label: 'Total Sampel', type: 'number' },
  { key: 'yellowing_count', label: 'Jumlah Daun Menguning', type: 'number' },
  { key: 'yellowing_pct', label: 'Daun Menguning (%)', type: 'number' },
  { key: 'vegetative_condition', label: 'Kondisi Vegetatif', type: 'text' },
  { key: 'baseline_tbm_normal', label: 'Baseline TBM Normal (acuan)', type: 'text', wide: true },
  { key: 'comparison_result', label: 'Hasil Perbandingan thd Baseline', type: 'textarea', wide: true },
];

export default function BahanOrganik() {
  const { user } = useAuth();
  return (
    <YieldModulePage
      title="Bahan Organik"
      description="Sensus daun menguning per blok area pasir, dibandingkan terhadap baseline TBM normal."
      api={yieldMakingApi.bahanOrganik}
      fields={FIELDS}
      listExtraKeys={['area_type', 'yellowing_pct']}
      canCreate={canCreateYieldMaking(user)}
      thresholdNote="Ambang EWS (FR): daun menguning > 5% pada TM (area pasir); TBM dibandingkan terhadap baseline TBM normal."
    />
  );
}
