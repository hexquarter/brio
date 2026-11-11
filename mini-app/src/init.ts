import {
  setDebug,
  mountBackButton,
  mountMainButton,
  mountSwipeBehavior,
  disableVerticalSwipes,
  restoreInitData,
  init as initSDK,
  bindThemeParamsCssVars,
  mountViewport,
  bindViewportCssVars,
  expandViewport,
  setMiniAppBackgroundColor,
  setMiniAppBottomBarColor,
  setMiniAppHeaderColor,
  mockTelegramEnv,
  type ThemeParams,
  themeParamsState,
  retrieveLaunchParams,
  emitEvent,
  miniApp,
} from '@telegram-apps/sdk-react';

/**
 * Initializes the application and configures its dependencies.
 */
export async function init(options: {
  debug: boolean;
  eruda: boolean;
  mockForMacOS: boolean;
}): Promise<void> {
  // Set @telegram-apps/sdk-react debug mode and initialize it.
  setDebug(options.debug);
  initSDK();

  // Add Eruda if needed.
  options.eruda && void import('eruda').then(({ default: eruda }) => {
    eruda.init();
    eruda.position({ x: window.innerWidth - 50, y: 0 });
  });

  // Telegram for macOS has a ton of bugs, including cases, when the client doesn't
  // even response to the "web_app_request_theme" method. It also generates an incorrect
  // event for the "web_app_request_safe_area" method.
  if (options.mockForMacOS) {
    let firstThemeSent = false;
    mockTelegramEnv({
      onEvent(event, next) {
        if (event[0] === 'web_app_request_theme') {
          let tp: ThemeParams = {};
          if (firstThemeSent) {
            tp = themeParamsState();
          } else {
            firstThemeSent = true;
            tp ||= retrieveLaunchParams().tgWebAppThemeParams;
          }
          return emitEvent('theme_changed', { theme_params: tp });
        }

        if (event[0] === 'web_app_request_safe_area') {
          return emitEvent('safe_area_changed', { left: 0, top: 0, right: 0, bottom: 0 });
        }

        next();
      },
    });
  }

  // Mount all components used in the project.
  mountBackButton.ifAvailable();
  mountMainButton.ifAvailable();
  mountSwipeBehavior.ifAvailable();
  disableVerticalSwipes.ifAvailable();
  restoreInitData();
  
  if (miniApp.mountSync.isAvailable()) {
    miniApp.mountSync();
    bindThemeParamsCssVars();
    // Use explicit RGB values: theme key names are unavailable when Telegram
    // sends partial theme params, and a failed lookup aborts initialization.
    try {
      if (setMiniAppHeaderColor.isAvailable()) setMiniAppHeaderColor('#f5f5f6');
      if (setMiniAppBackgroundColor.isAvailable()) setMiniAppBackgroundColor('#f5f5f6');
      if (setMiniAppBottomBarColor.isAvailable()) setMiniAppBottomBarColor('#f5f5f6');
    } catch (error) {
      console.warn('Unable to apply Telegram chrome colors:', error);
    }
  }

  if (mountViewport.isAvailable()) {
    // Never block the first render on Telegram's viewport handshake: some
    // clients (and the development mock) may not answer the request.
    void mountViewport()
      .then(() => {
        bindViewportCssVars();
        expandViewport.ifAvailable();
      })
      .catch(error => console.warn('Unable to mount the Telegram viewport:', error));
  }
}