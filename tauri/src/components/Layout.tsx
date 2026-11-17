import { Nav } from './Nav';
import { ExtractionWatcher } from './ExtractionWatcher';
import { ExtractionOverlay } from './ExtractionOverlay';
import { useLocation } from 'react-router-dom';

/** Main-window shell. Global appearance tokens (theme, accent, UI scale) are
 *  applied by SettingsLoader so popup windows share them. */
export function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();

  return (
    <div className="app-bg min-h-screen text-slate-900 dark:text-slate-100">
      <ExtractionWatcher />
      <Nav />
      <main className="app-main min-h-screen">
        {/* Keying on the pathname replays the entrance animation on every
            route change (including settings sub-tabs). */}
        <div key={pathname} className="page-enter mx-auto w-full max-w-5xl">
          {children}
        </div>
      </main>
      <ExtractionOverlay />
    </div>
  );
}
