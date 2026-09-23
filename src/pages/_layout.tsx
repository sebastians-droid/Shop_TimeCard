import { NavLink, Outlet, useLocation } from 'react-router-dom';

const navLinkClassName = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive
      ? 'bg-white/15 text-white'
      : 'text-white/70 hover:bg-white/10 hover:text-white'
  }`;

export default function Layout() {
  const { pathname } = useLocation();
  const isHome = pathname === '/';

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="bg-[oklch(0.18_0.005_45)] text-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <NavLink to="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
            <img src="/swank-logo.jpg" alt="Swank" className="h-8 rounded-sm" />
            <div className="leading-tight">
              <p className="text-[0.9rem] font-semibold tracking-wide">Shop Hub</p>
              <p className="text-[0.7rem] text-white/50 font-medium uppercase tracking-widest">Swank Construction</p>
            </div>
          </NavLink>
          {!isHome && (
            <nav className="flex gap-1.5 flex-wrap" aria-label="Primary navigation">
              <NavLink to="/timecard" className={navLinkClassName}>Timecard</NavLink>
              <NavLink to="/manager" className={navLinkClassName}>Manager</NavLink>
              <NavLink to="/admin" className={navLinkClassName}>Assets & Employees</NavLink>
            </nav>
          )}
        </div>
        <div className="h-[3px] bg-gradient-to-r from-[oklch(0.53_0.20_27)] via-[oklch(0.53_0.20_27)] to-transparent" />
      </header>
      <Outlet />
    </div>
  );
}
