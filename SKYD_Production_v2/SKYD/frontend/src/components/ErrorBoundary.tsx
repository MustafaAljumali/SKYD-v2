import React, { Component, useState, useCallback } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw, WifiOff } from 'lucide-react';

interface CatcherProps { children: ReactNode; onError: (error: Error) => void }

/**
 * Minimal class-based error catcher (required by React — hooks can't catch render errors).
 */
class ErrorCatcher extends Component<CatcherProps> {
  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[SKYD ErrorBoundary] Fatal render error:', error);
    console.error('[SKYD ErrorBoundary] Component stack:', info.componentStack);
    (this as Component<CatcherProps>).props.onError(error);
  }

  render(): ReactNode {
    return (this as Component<CatcherProps>).props.children;
  }
}

/**
 * ErrorBoundary — catches fatal React rendering errors and displays a
 * glassmorphic recovery panel instead of a white screen.
 */
export function ErrorBoundary({ children }: { children: ReactNode }) {
  const [error, setError] = useState<Error | null>(null);

  const handleError = useCallback((err: Error) => {
    setError(err);
  }, []);

  const handleReload = useCallback(() => {
    setError(null);
    window.location.reload();
  }, []);

  if (error) {
    const isNetworkError =
      error.message?.includes('Network error') ||
      error.message?.includes('Failed to fetch') ||
      error.message?.includes('unreachable');

    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
        <div className="max-w-lg w-full p-8 rounded-3xl backdrop-blur-xl bg-slate-900/70 border border-white/10 shadow-2xl text-center space-y-6">
          {/* Icon */}
          <div className="flex justify-center">
            <div className="p-4 rounded-full bg-red-500/10 border border-red-500/20">
              {isNetworkError ? (
                <WifiOff className="w-10 h-10 text-red-400" />
              ) : (
                <AlertTriangle className="w-10 h-10 text-amber-400" />
              )}
            </div>
          </div>

          {/* Arabic Message */}
          <div className="space-y-2" dir="rtl">
            <h2 className="text-lg font-black text-white" style={{ fontFamily: "'IBM Plex Sans Arabic', 'Inter', sans-serif" }}>
              {isNetworkError
                ? 'عذراً، تعذر الاتصال بخادم البيانات الحية'
                : 'عذراً، حدث خطأ غير متوقع في التطبيق'}
            </h2>
            <p className="text-sm text-slate-400 leading-relaxed" style={{ fontFamily: "'IBM Plex Sans Arabic', 'Inter', sans-serif" }}>
              {isNetworkError
                ? 'يرجى التحقق من تهيئة روابط الـ API والتأكد من أن خادم Backend يعمل على المنفذ المحدد.'
                : 'يرجى التحقق من سجلات وحدة التحكم (Console) للحصول على تفاصيل الخطأ. يمكنك إعادة تحميل الصفحة للمحاولة مرة أخرى.'}
            </p>
          </div>

          {/* English Message */}
          <div className="space-y-2 text-left">
            <h3 className="text-sm font-bold text-slate-300">
              {isNetworkError
                ? 'Unable to connect to the live data server.'
                : 'An unexpected rendering error occurred.'}
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              {isNetworkError
                ? 'Please verify the API base URL configuration and ensure the FastAPI backend is running.'
                : 'Check the browser console for error details. You can reload to attempt recovery.'}
            </p>
          </div>

          {/* Error detail (collapsed) */}
          <details className="text-left">
            <summary className="text-[10px] text-slate-600 cursor-pointer hover:text-slate-400 transition-colors font-mono">
              Error details
            </summary>
            <pre className="mt-2 p-3 bg-slate-950/80 border border-slate-800 rounded-xl text-[10px] text-red-400 font-mono overflow-x-auto max-h-32">
              {error.message}
            </pre>
          </details>

          {/* Reload button */}
          <button
            type="button"
            onClick={handleReload}
            className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow-lg shadow-emerald-500/20 transition-all cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            Reload Application
          </button>
        </div>
      </div>
    );
  }

  return <ErrorCatcher onError={handleError}>{children}</ErrorCatcher>;
}
