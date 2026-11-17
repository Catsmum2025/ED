import { Nav } from './Nav';
import { ExtractionWatcher } from './ExtractionWatcher';
import { ExtractionOverlay } from './ExtractionOverlay';
import { useLocation } from 'react-router-dom';

/** Main-window shell. Global appearance tokens (theme, accent, UI scale) are
 *  applied by SettingsLoader so popup windows share them. */
export function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  // Only top-level sections replay the page entrance. Settings sub-tabs animate
  // their own right-hand panel, so switching tabs must not re-animate the whole
  // content area.
  const section = pathname.split('/')[1] || 'dictionary';

  return (
    <div className="app-bg min-h-screen text-slate-900 dark:text-slate-100">
      <ExtractionWatcher />
      <Nav />
      <main className="app-main min-h-screen">
        {/* Keying on the pathname replays the entrance animation on every
            route change (including settings sub-tabs). */}
        <div key={section} className="page-enter mx-auto w-full max-w-5xl">
          {children}
        </div>
      </main>
      <ExtractionOverlay />
    </div>
  );
}
