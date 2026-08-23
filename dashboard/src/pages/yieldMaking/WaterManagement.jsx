import { useAuth, canCreateYieldMaking } from '../../context/AuthContext';
import { yieldMakingApi } from '../../api/resources';
import YieldModulePage from './YieldModulePage';

const FIELDS = [
  { key: 'titik_parit', label: 'Titik Parit', type: 'text' },
  { key: 'water_level_cm', label: 'Level Air (cm di bawah permukaan tanah)', type: 'number' },
  { key: 'flooding', label: 'Genangan?', type: 'checkbox' },
  { key: 'flooding_duration_hari', label: 'Durasi Genangan (hari)', type: 'number' },
];

export default function WaterManagement() {
  const { user } = useAuth();
  return (
    <YieldModulePage
      title="Water Management"
      description="Sensus level air parit per titik parit — dilakukan paling lambat tanggal 25 setiap bulan."
      api={yieldMakingApi.waterManagement}
      fields={FIELDS}
      listExtraKeys={['titik_parit', 'water_level_cm', 'flooding']}
      canCreate={canCreateYieldMaking(user)}
      thresholdNote="Ambang EWS (FR): level air parit < 40 cm selama 1 bulan; genangan > 20 hari; target normal 40–60 cm di bawah permukaan tanah."
    />
  );
}
