import { NavLink, useNavigate } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { useAuthStore } from '../../stores/auth-store';

const navSections = [
  {
    label: 'Monitor',
    items: [
      { path: '/dashboard', label: 'Dashboard', icon: '\u25C8' },
      { path: '/activity', label: 'Activity Feed', icon: '\u25C9' },
      { path: '/chat', label: 'Chat', icon: '\u25EC' },
      { path: '/comms', label: 'Communications', icon: '\u25CE' },
      { path: '/timeline', label: 'Timeline', icon: '\u25AC' },
    ],
  },
  {
    label: 'Manage',
    items: [
      { path: '/boards', label: 'Boards', icon: '\u25A3' },
      { path: '/approvals', label: 'Approvals', icon: '\u2713' },
      { path: '/tasks', label: 'Task Board', icon: '\u25A6' },
      { path: '/topology', label: 'Network Graph', icon: '\u25C7' },
      { path: '/controls', label: 'Agent Controls', icon: '\u229E' },
      { path: '/gateways', label: 'Gateways', icon: '\u2302' },
      { path: '/skills', label: 'Skills', icon: '\u26A1' },
      { path: '/soul-templates', label: 'Soul Templates', icon: '\u2666' },
      { path: '/custom-fields', label: 'Custom Fields', icon: '\u25A4' },
    ],
  },
  {
    label: 'Observe',
    items: [
      { path: '/metrics', label: 'Metrics & Cost', icon: '\u25A5' },
      { path: '/alerts', label: 'Alerts', icon: '\u25B3' },
      { path: '/search', label: 'Search & Audit', icon: '\u2299' },
    ],
  },
  {
    label: 'Account',
    items: [
      { path: '/settings', label: 'Settings', icon: '\u2699' },
    ],
  },
];

export function Sidebar() {
  const navigate = useNavigate();
  const { user, organization, logout } = useAuthStore();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-surface-900 border-r border-white/5 flex flex-col z-50">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-nexus-500 to-nexus-700 flex items-center justify-center text-white font-bold text-lg animate-glow">
            N
          </div>
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">Nexus</h1>
            <p className="text-[11px] text-gray-500 uppercase tracking-widest">Agent Monitor</p>
          </div>
        </div>
      </div>

      {/* Prominent Create Agent Button */}
      <div className="px-3 pt-3 pb-1">
        <NavLink
          to="/agents/new"
          className={({ isActive }) =>
            cn(
              'flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 w-full',
              isActive
                ? 'bg-nexus-600 text-white shadow-lg shadow-nexus-600/20'
                : 'bg-nexus-600/15 text-nexus-400 border border-nexus-500/20 hover:bg-nexus-600/25 hover:text-nexus-300'
            )
          }
        >
          <span className="text-base leading-none">+</span>
          Create Agent
        </NavLink>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3 space-y-4 overflow-y-auto">
        {navSections.map((section) => (
          <div key={section.label}>
            <div className="text-[10px] text-gray-600 uppercase tracking-widest px-3 mb-1.5">{section.label}</div>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === '/dashboard'}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                      isActive
                        ? 'bg-nexus-600/15 text-nexus-400 border border-nexus-500/20'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                    )
                  }
                >
                  <span className="text-base leading-none">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer - User info */}
      <div className="px-4 py-4 border-t border-white/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-full bg-nexus-600/30 flex items-center justify-center text-xs text-nexus-400 font-medium shrink-0">
              {user?.name?.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-xs text-white truncate">{user?.name}</p>
              <p className="text-[10px] text-gray-600 truncate">{organization?.name}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            title="Sign out"
            className="text-gray-600 hover:text-gray-400 text-xs transition-colors"
          >
            {'\u21AA'}
          </button>
        </div>
      </div>
    </aside>
  );
}
