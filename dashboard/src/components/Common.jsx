export function Loading({ label = 'Memuat data…' }) {
  return <div className="loading-state">{label}</div>;
}

export function ErrorBox({ error }) {
  if (!error) return null;
  const msg = error?.response?.data?.error || error?.response?.data?.message || error?.message || String(error);
  return <div className="error-state">Gagal memuat data: {msg}</div>;
}

export function Empty({ label = 'Belum ada data.' }) {
  return <div className="empty-state">{label}</div>;
}

export function Field({ label, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}
