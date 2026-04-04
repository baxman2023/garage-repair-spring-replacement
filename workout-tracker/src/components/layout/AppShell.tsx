import { Outlet } from 'react-router-dom';
import { NavBar } from './NavBar';

export function AppShell() {
  return (
    <div className="min-h-screen pb-20">
      <header className="bg-surface-light border-b border-surface-lighter px-4 py-3">
        <h1 className="text-xl font-bold text-center text-primary-light">
          Workout Tracker
        </h1>
      </header>
      <main className="max-w-lg mx-auto px-4 py-4">
        <Outlet />
      </main>
      <NavBar />
    </div>
  );
}
