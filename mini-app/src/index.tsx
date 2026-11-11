import ReactDOM from 'react-dom/client';
import { StrictMode } from 'react';
import { retrieveLaunchParams } from '@telegram-apps/sdk-react';

import { Root } from '@/components/Root.tsx';
import { EnvUnsupported } from '@/components/EnvUnsupported.tsx';
import { init } from '@/init.ts';

import './index.css';

// Mock the environment in case, we are outside Telegram.
import './mockEnv.ts';

import './i18n';
import { initWasm } from '@/lib/wallet/wasmLoader.tsx';

const root = ReactDOM.createRoot(document.getElementById('root')!);

if (window.location.hash.startsWith('#tgWebAppData=')) {
  const search = window.location.hash.slice(1); // strip "#"
  const newUrl =
    window.location.pathname + '?' + search + '#/'; // put params into search, keep router hash root
  window.history.replaceState(null, '', newUrl);
}

try {
  const launchParams = retrieveLaunchParams();
  const { tgWebAppPlatform: platform } = launchParams;
  const debug = (launchParams.tgWebAppStartParam || '').includes('platformer_debug')
    || import.meta.env.DEV;

  // Initialize WASM module
  await initWasm()

  // Configure all application dependencies.
  await init({
    debug: import.meta.env.DEV,
    eruda: debug && ['ios', 'android'].includes(platform),
    mockForMacOS: platform === 'macos',
  })
    .then(() => {
      root.render(
        <StrictMode>
          <Root/>
        </StrictMode>,
      );
    });
} catch (e) {
  console.error('Failed to get launch params:', e);
  root.render(<EnvUnsupported/>);
}
