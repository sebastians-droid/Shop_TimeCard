import { NavLink, Outlet } from 'react-router-dom';

const navLinkClassName = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted hover:text-foreground'
  }`;

export default function Layout() {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="border-b border-border bg-card text-card-foreground">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div>
            <p className="text-lg font-semibold">Shop Timecard</p>
            <p className="text-sm text-muted-foreground">Daily equipment labor tracking</p>
          </div>
          <nav className="flex gap-2" aria-label="Primary navigation">
            <NavLink to="/" end className={navLinkClassName}>My timecard</NavLink>
            <NavLink to="/manager" className={navLinkClassName}>Manager dashboard</NavLink>
          </nav>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
