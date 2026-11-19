import { emitEvent, isTMA, mockTelegramEnv } from '@telegram-apps/sdk-react';
import { setMockedTelegramEnv } from '@/lib/telegram/env';

// The app also runs as a plain website. When Telegram launch parameters are
// absent, install a synthetic environment so the SDK helpers do not throw.
// A flag records that this is a web session, which disables native-only UI.
let inTelegram = false;
try {
  inTelegram = await isTMA('complete');
} catch {
  inTelegram = false;
}

setMockedTelegramEnv(!inTelegram);

if (!inTelegram) {
  mockTelegramEnv({
    onEvent(e) {
      if (e[0] === 'web_app_request_viewport') {
        return emitEvent('viewport_changed', {
          height: window.innerHeight,
          width: window.innerWidth,
          is_expanded: true,
          is_state_stable: true,
        });
      }
      if (e[0] === 'web_app_data_send') {
        return emitEvent('web_app_data_send', e[1])
      }
    },
    launchParams: new URLSearchParams([
      ['tgWebAppThemeParams', JSON.stringify({})],
      ['tgWebAppData', new URLSearchParams([
        ['auth_date', (new Date().getTime() / 1000 | 0).toString()],
        ['hash', 'some-hash'],
        ['signature', 'some-signature'],
        ['user', JSON.stringify({ id: 1, first_name: 'Web', username: 'web' })],
        ['chat_instance', '5544007052087859818'],
      ]).toString()],
      ['tgWebAppVersion', '8.4'],
      ['tgWebAppPlatform', 'tdesktop'],
    ]),
  });

  console.info(
    'Brio is running outside Telegram. Telegram-native controls are disabled; '
    + 'open the app from the bot to use them.'
  );
}
