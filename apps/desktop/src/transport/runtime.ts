/**
 * Detect whether the app is running inside the native Tauri desktop/mobile shell
 * or as a standalone Web browser SPA.
 */
export function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ ||
        (window as unknown as Record<string, unknown>).__TAURI__
    )
  );
}
