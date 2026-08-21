import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

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
    label: 'Konfigurasi',
    items: [
      { to: '/knowledge-base', icon: '📚', label: 'Knowledge Base' },
      { to: '/import', icon: '📥', label: 'Import Data' },
      { to: '/master', icon: '🗃', label: 'Master Data' },
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
            <strong>EWS HPT</strong>
            <span>Dashboard Kelapa Sawit</span>
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
          <div className="topbar-title">EWS HPT — Early Warning, Action, Monitoring</div>
          <div className="topbar-user">
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
