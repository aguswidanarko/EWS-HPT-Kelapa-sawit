import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const DEMO_USERS = [
  ['admin@ews.local', 'Administrator'],
  ['superadmin@ews.local', 'Super Admin'],
  ['rnd@ews.local', 'R&D / FOD'],
  ['riset@ews.local', 'Riset (Leaf Analysis / Defisiensi Hara)'],
  ['manager@ews.local', 'Manager'],
  ['askep@ews.local', 'Askep / Asisten'],
  ['deteksi@ews.local', 'Petugas Deteksi'],
  ['sensus@ews.local', 'Petugas Sensus'],
  ['pengendalian@ews.local', 'Petugas Pengendalian'],
  ['viewer@ews.local', 'Viewer / Management (read-only)'],
];

export default function Login() {
  const [email, setEmail] = useState('admin@ews.local');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      const dest = location.state?.from || '/';
      navigate(dest, { replace: true });
    } catch (err) {
      setError(err?.response?.data?.error || err?.response?.data?.message || 'Login gagal. Periksa email/password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="sidebar-brand-mark" style={{ marginBottom: 10 }}>EWS</div>
        <h1>EWS Plantation Dashboard</h1>
        <div className="sub">Early Warning System — HPT, Yield Making &amp; Agronomy Kelapa Sawit</div>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <div className="error-state">{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? 'Masuk…' : 'Masuk'}
          </button>
        </form>
        <div className="login-demo">
          Semua akun demo memakai password <code>password123</code>.
          <table>
            <tbody>
              {DEMO_USERS.map(([em, role]) => (
                <tr key={em}>
                  <td><code>{em}</code></td>
                  <td>{role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
