import { HashRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SettingsLoader } from './components/SettingsLoader';
import { DictionaryPage } from './pages/Dictionary';
import { TranslatePage } from './pages/Translate';
import { StatsPage } from './pages/Stats';
import { BooksPage, BookDetailPage } from './pages/Books';
import { FlashcardsPage } from './pages/Flashcards';
import { SettingsPage } from './pages/Settings';
import { DashboardPage } from './pages/Dashboard';
import { PopupDictPage } from './pages/PopupDict';
import { PopupTranslatePage } from './pages/PopupTranslate';
import { api } from './ipc';

/** Listens for `main:navigate` requests from the main process (sent when the
 *  user clicks "switch to main" in a popup) and performs the navigation. */
function MainNavigateListener() {
  const navigate = useNavigate();
  useEffect(() => {
    const off = api.window.onNavigate(({ route, query }) => {
      if (route === '/dictionary' && query?.word) {
        // Hand off to the dictionary page via search param so the page can pick
        // up the word and trigger a lookup.
        navigate(`/dictionary?word=${encodeURIComponent(query.word)}`);
      } else if (route === '/translate' && query?.text) {
        navigate(`/translate?text=${encodeURIComponent(query.text)}`);
      } else {
        navigate(route);
      }
    });
    return () => { off(); };
  }, [navigate]);
  return null;
}

export default function App() {
  return (
    <HashRouter>
      <ErrorBoundary>
        <SettingsLoader />
        <Routes>
          {/* Frameless popup routes — no Layout/Nav wrapping. */}
          <Route path="/popup/dict" element={<PopupDictPage />} />
          <Route path="/popup/translate" element={<PopupTranslatePage />} />

          {/* Main app routes. */}
          <Route
            path="*"
            element={
              <Layout>
                <MainNavigateListener />
                <Routes>
                  <Route path="/dictionary" element={<DictionaryPage />} />
                  <Route path="/translate" element={<TranslatePage />} />
                  <Route path="/books" element={<BooksPage />} />
                  <Route path="/books/:id" element={<BookDetailPage />} />
                  <Route path="/books/:id/flashcards" element={<FlashcardsPage />} />
                  <Route path="/stats" element={<StatsPage />} />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/settings/*" element={<SettingsPage />} />
                  <Route path="/" element={<Navigate to="/dictionary" replace />} />
                </Routes>
              </Layout>
            }
          />
        </Routes>
      </ErrorBoundary>
    </HashRouter>
  );
}
