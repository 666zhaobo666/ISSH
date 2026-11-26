import { useEffect, useState } from 'react';

const MOBILE_QUERY = '(max-width: 767px)';

/**
 * Detects mobile viewport (<768px) and whether the on-screen virtual keyboard is open
 * (via visualViewport height drop) so we can hide bottom navigation while typing.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_QUERY).matches : false
  );
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    setIsMobile(mq.matches);

    const vv = window.visualViewport;
    let baseHeight = window.innerHeight;
    const onResize = () => {
      if (!vv) return;
      if (vv.height > baseHeight) baseHeight = vv.height;
      setKeyboardOpen(baseHeight - vv.height > 140);
    };
    vv?.addEventListener('resize', onResize);

    return () => {
      mq.removeEventListener('change', onChange);
      vv?.removeEventListener('resize', onResize);
    };
  }, []);

  return { isMobile, keyboardOpen };
}
