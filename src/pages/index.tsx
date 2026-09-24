import { Link } from 'react-router-dom';
import { ClipboardList, Clock, LayoutDashboard, Wrench } from 'lucide-react';

const sections = [
  {
    to: '/timecard',
    icon: Clock,
    title: 'Timecard',
    description: 'Clock in and out on equipment and log daily labor hours.',
    iconBg: 'bg-blue-700',
  },
  {
    to: '/mechanic-log',
    icon: ClipboardList,
    title: 'Mechanic Log',
    description: 'View your work history, daily hours, and overtime breakdown.',
    iconBg: 'bg-teal-700',
  },
  {
    to: '/manager',
    icon: LayoutDashboard,
    title: 'Manager Dashboard',
    description: 'Review time entries, edit timecards, and export weekly payroll.',
    iconBg: 'bg-amber-600',
  },
  {
    to: '/admin',
    icon: Wrench,
    title: 'Assets & Employees',
    description: 'Add, update, or deactivate equipment assets and shop employee records.',
    iconBg: 'bg-emerald-700',
  },
];

export default function HomePage() {
  return (
    <main className="flex-1 flex items-center justify-center">
      <div className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
        <div className="mb-12 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Shop Hub
          </h1>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {sections.map(({ to, icon: Icon, title, description, iconBg }) => (
            <Link key={to} to={to} className="group">
              <div className="relative h-full rounded-xl border border-border bg-card p-6 transition-all hover:shadow-md hover:border-primary/25 hover:-translate-y-0.5">
                <div className={`mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg ${iconBg} text-white`}>
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="text-[0.95rem] font-semibold text-foreground mb-1.5 group-hover:text-primary transition-colors">
                  {title}
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
              </div>
            </Link>
          ))}
        </div>

        <p className="mt-10 text-center text-xs text-muted-foreground/60 tracking-wide uppercase">
          Swank Construction Co.
        </p>
      </div>
    </main>
  );
}
