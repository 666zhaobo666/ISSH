import { useEffect, useState } from 'react';

export type DeviceMode = 'desktop' | 'tablet' | 'phone';

function detectDeviceMode(): { mode: DeviceMode; isTouch: boolean; isAndroidApp: boolean } {
  if (typeof window === 'undefined') {
    return { mode: 'desktop', isTouch: false, isAndroidApp: false };
  }
  const ua = navigator.userAgent || '';
  const isAndroidUA = /Android/i.test(ua);
  const isIOSUA = /iPhone|iPad|iPod/i.test(ua);
  const isIPadOS = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  const isMobileOS = isAndroidUA || isIOSUA || isIPadOS;
  const isTouch = isMobileOS || window.matchMedia('(pointer: coarse)').matches;
  const w = window.innerWidth;

  if (w < 768) {
    return { mode: 'phone', isTouch, isAndroidApp: isAndroidUA };
  }
  // Only true mobile/tablet OSes (Android Pad / iPad) use the Touch Tablet UI.
  // Windows / macOS / Linux PCs (even with touchscreens) always use the full Desktop UI.
  if (isMobileOS) {
    return { mode: 'tablet', isTouch: true, isAndroidApp: isAndroidUA };
  }
  return { mode: 'desktop', isTouch: false, isAndroidApp: false };
}

export function useDeviceLayout() {
  const [info, setInfo] = useState(detectDeviceMode);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const update = () => setInfo(detectDeviceMode());
    window.addEventListener('resize', update);

    const vv = window.visualViewport;
    let baseHeight = window.innerHeight;
    const onVvResize = () => {
      if (!vv) return;
      if (vv.height > baseHeight) baseHeight = vv.height;
      setKeyboardOpen(baseHeight - vv.height > 140);
    };
    vv?.addEventListener('resize', onVvResize);

    return () => {
      window.removeEventListener('resize', update);
      vv?.removeEventListener('resize', onVvResize);
    };
  }, []);

  return {
    ...info,
    isMobileOrTablet: info.mode === 'phone' || info.mode === 'tablet',
    keyboardOpen,
  };
}
