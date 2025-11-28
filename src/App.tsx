import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import {
  SplashScreen,
  PlaylistInput,
  LoadingProgress,
  ErrorScreen,
} from '@ui/onboarding';
import { MainApp } from '@ui/MainApp';

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

        {/* Main App */}
        <Route path="/home" element={<MainApp />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
