import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Unregister any active service worker and clear cache to prevent stale HTML/React bundle issues (white screen on load)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister().then((unregistered) => {
        if (unregistered) console.log('Successfully unregistered stale Service Worker');
      });
    }
  }).catch((err) => {
    console.error('Error unregistering stale SW:', err);
  });

  if (window.caches) {
    caches.keys().then((keys) => {
      keys.forEach((key) => {
        caches.delete(key).then(() => {
          console.log(`Cleared stale cache: ${key}`);
        });
      });
    }).catch((err) => {
      console.error('Error clearing stale caches:', err);
    });
  }
}
