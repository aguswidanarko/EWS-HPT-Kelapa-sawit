import { useAuth, canCreateYieldMaking } from '../../context/AuthContext';
import { yieldMakingApi } from '../../api/resources';
import YieldModulePage from './YieldModulePage';

const FIELDS = [
  { key: 'umur_bulan', label: 'Umur Tanaman (bulan)', type: 'number' },
  { key: 'panjang_pelepah_cm', label: 'Panjang Pelepah (cm)', type: 'number' },
  { key: 'jumlah_pelepah', label: 'Jumlah Pelepah', type: 'number' },
  { key: 'lai', label: 'LAI (Leaf Area Index)', type: 'number' },
  { key: 'target_produksi_ton_ha', label: 'Target Produksi (ton/ha)', type: 'number' },
  { key: 'hasil_evaluasi', label: 'Hasil Evaluasi / Rekomendasi Perbaikan', type: 'textarea', wide: true },
];

export default function TbmVegetatif() {
  const { user } = useAuth();
  return (
    <YieldModulePage
      title="TBM Sehat / Standar Vegetatif"
      description="Sensus pertumbuhan vegetatif TBM terhadap standar umur — sampel pokok 1%, minimal 3 bulan sekali."
      api={yieldMakingApi.tbmVegetatif}
      fields={FIELDS}
      listExtraKeys={['umur_bulan', 'jumlah_pelepah']}
      canCreate={canCreateYieldMaking(user)}
      thresholdNote="Target produksi acuan (bukan threshold alert, FR): TBM2 = 10 ton/ha, TBM3 = 20 ton/ha, TM1 = 30 ton/ha, TM3 = 40 ton/ha. Pertumbuhan di bawah standar umur → rekomendasi perbaikan."
    />
  );
}
