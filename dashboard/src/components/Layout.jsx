import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { healthApi } from '../api/resources';

// BRD EWS HPT V3.2.1 section 23 (Dashboard Connectivity Indicator): poll GET /health so the
// dashboard can tell "backend down" apart from "my own network is fine" - same distinction Mobile
// makes with its Server Connectivity Test (section 11).
const HEALTH_POLL_MS = 30000;

function BackendStatusPill() {
  const [status, setStatus] = useState('CHECKING'); // CHECKING | CONNECTED | DISCONNECTED
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let timer;
    const check = async () => {
      try {
        await healthApi.check();
        if (mounted.current) setStatus('CONNECTED');
      } catch {
        if (mounted.current) setStatus('DISCONNECTED');
      } finally {
        if (mounted.current) timer = setTimeout(check, HEALTH_POLL_MS);
      }
    };
    check();
    return () => {
      mounted.current = false;
      clearTimeout(timer);
    };
  }, []);

  const config = {
    CHECKING: { emoji: '⚪', label: 'Memeriksa backend...' },
    CONNECTED: { emoji: '🟢', label: 'Backend Connected' },
    DISCONNECTED: { emoji: '🔴', label: 'Backend Disconnected' },
  }[status];

  return (
    <span className={'backend-status-pill backend-status-' + status.toLowerCase()} title="GET /health">
      {config.emoji} {config.label}
    </span>
  );
}

const NAV_SECTIONS = [
  {
    label: 'Monitoring',
    items: [
      { to: '/', icon: '▦', label: 'Dashboard Utama', end: true },
      { to: '/peta', icon: '🗺', label: 'Peta EWS' },
      { to: '/alerts', icon: '🔔', label: 'EWS Alert Center' },
      { to: '/incidents', icon: '📁', label: 'Incident Management' },
    ],
  },
  {
    label: 'Data Lapangan',
    items: [
      { to: '/deteksi', icon: '🔍', label: 'Deteksi' },
      { to: '/sensus', icon: '📋', label: 'Sensus' },
      { to: '/pengendalian', icon: '🧪', label: 'Pengendalian' },
      { to: '/mortalitas', icon: '☠', label: 'Mortalitas' },
    ],
  },
  {
    label: 'Yield Making',
    items: [
      { to: '/yield-making/partenocarpi', icon: '🌴', label: 'Partenocarpi / Elaeidobius' },
      { to: '/yield-making/water-management', icon: '💧', label: 'Water Management' },
      { to: '/yield-making/bahan-organik', icon: '🍃', label: 'Bahan Organik' },
      { to: '/yield-making/tbm-vegetatif', icon: '🌱', label: 'TBM Vegetatif' },
      { to: '/defisiensi-hara', icon: '🧪', label: 'Defisiensi Hara' },
    ],
  },
  {
    label: 'Tindak Lanjut',
    items: [
      { to: '/action-plans', icon: '✅', label: 'Action Plan' },
      { to: '/monitoring-schedule', icon: '🗓', label: 'Monitoring Schedule' },
      { to: '/scoring', icon: '🏆', label: 'Scoring / KPI' },
    ],
  },
  {
    label: 'Konfigurasi',
    items: [
      { to: '/knowledge-base', icon: '📚', label: 'Knowledge Base' },
      { to: '/import', icon: '📥', label: 'Import Data' },
      { to: '/master', icon: '🗃', label: 'Master Data' },
      { to: '/rules', icon: '🛠', label: 'Rule & Parameter Management' },
      { to: '/pic-user', icon: '👥', label: 'PIC / User' },
      { to: '/notification', icon: '📣', label: 'Notification' },
    ],
  },
  {
    label: 'Analitik & Audit',
    items: [
      { to: '/report', icon: '📈', label: 'Report' },
      { to: '/audit-log', icon: '📜', label: 'Audit Log' },
      { to: '/settings', icon: '⚙', label: 'System Settings' },
    ],
  },
];

const PAGE_TITLES = {};
NAV_SECTIONS.forEach((s) => s.items.forEach((i) => { PAGE_TITLES[i.to] = i.label; }));

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark">EWS</div>
          <div className="sidebar-brand-text">
            <strong>EWS Plantation</strong>
            <span>HPT + Yield Making + Agronomy — v3.2</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <div className="sidebar-section-label">{section.label}</div>
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => 'sidebar-link' + (isActive ? ' active' : '')}
                >
                  <span className="sidebar-icon">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="main-col">
        <header className="topbar">
          <div className="topbar-title">EWS Plantation — Early Warning, Action, Monitoring</div>
          <div className="topbar-user">
            <BackendStatusPill />
            <span>{user?.name}</span>
            <span className="role-pill">{user?.role_name}</span>
            <button className="btn-logout" onClick={handleLogout}>Keluar</button>
          </div>
        </header>
        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export { PAGE_TITLES };
