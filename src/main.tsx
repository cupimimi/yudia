import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppStateProvider } from './state/AppStateContext';
import { AppContent } from './App';
import './index.css';
import { applyAccent } from './theme/accent';
import { applyPerformanceMode } from './theme/performance';
import { installTextInputGuard } from './navigation/textInputGuard';
import { installPhoneLayout } from './theme/responsive';
import { initDownloads } from './services/downloads';
import { registerOfflineApp } from './offline/registerServiceWorker';
import { initCast } from './services/cast';
import { installLeaveGuard } from './navigation/leaveGuard';
import { refreshAutoDeviceName } from './config/deviceName';
import { jellyfinClient } from './api/jellyfin';
import { restartReceiver } from './services/remoteSessions';

applyAccent(); // saved interface accent → CSS variables, before the first paint
applyPerformanceMode(); // Smooth mode on TVs / The Freestyle (Settings → TV Experience & Display)
installTextInputGuard(); // typing in a text field never triggers remote navigation / app shortcuts (first keydown handler)
installPhoneLayout(); // html.is-phone on narrow screens (never on the TV)
initDownloads(); // offline downloads list (website only; no-op on the TV)
registerOfflineApp(); // website: keep a copy of the app so it opens with no connection (downloads)
initCast(); // website: Google Cast (Chrome / Edge); never on the TV app
installLeaveGuard(); // website: asks before reloading / closing while something plays
// Device name read from the device itself ("Pixel 9 Pro XL", "The Freestyle"…) unless one was set by hand
refreshAutoDeviceName(jellyfinClient.getConfig().deviceName, (name) => {
  jellyfinClient.setConfig({ deviceName: name });
  restartReceiver(); // the server and the other devices see the new name
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppStateProvider>
      <AppContent />
    </AppStateProvider>
  </React.StrictMode>
);
