import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import {
  SplashScreen,
  PlaylistInput,
  LoadingProgress,
  ErrorScreen,
} from '@ui/onboarding';
import { Home } from '@ui/home';
import { SeriesDetailWrapper } from '@ui/series/SeriesDetailWrapper';
import { MovieDetailWrapper } from '@ui/movie';
import { AccountInfo } from '@ui/settings';
import { CategoryPage } from '@ui/category/CategoryPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Splash/Root */}
        <Route path="/" element={<SplashScreen />} />

        {/* Onboarding Flow */}
        <Route path="/onboarding/input" element={<PlaylistInput />} />
        <Route path="/onboarding/loading" element={<LoadingProgress />} />
        <Route path="/onboarding/error" element={<ErrorScreen />} />

        {/* Main App - Stateless Home */}
        <Route path="/home" element={<Home />} />

        {/* Series Detail */}
        <Route path="/series/:seriesId" element={<SeriesDetailWrapper />} />

        {/* Movie Detail - VOD with rich metadata */}
        <Route path="/movie/:movieId" element={<MovieDetailWrapper />} />

        {/* Category Page - Grid view of all items in a group */}
        <Route path="/category/:groupId" element={<CategoryPage />} />

        {/* Settings - Account Info */}
        <Route path="/account" element={<AccountInfo />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
