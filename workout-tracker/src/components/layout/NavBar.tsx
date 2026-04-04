import { NavLink } from 'react-router-dom';

const links = [
  { to: '/workout', label: 'Workout', icon: '🏋️' },
  { to: '/upload', label: 'Upload', icon: '📄' },
  { to: '/history', label: 'History', icon: '📊' },
  { to: '/accolades', label: 'Accolades', icon: '🏆' },
];

export function NavBar() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-surface-light border-t border-surface-lighter z-50">
      <div className="max-w-lg mx-auto flex">
        {links.map(link => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-3 text-xs transition-colors ${
                isActive ? 'text-primary-light' : 'text-text-muted hover:text-text'
              }`
            }
          >
            <span className="text-xl mb-1">{link.icon}</span>
            {link.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
