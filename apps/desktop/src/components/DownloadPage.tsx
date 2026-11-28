import { useCallback, useEffect, useState } from 'react';
import {
  Download,
  ExternalLink,
  Loader2,
  Monitor,
  RefreshCw,
  Smartphone,
  X,
} from 'lucide-react';
import { checkAppUpdate, type UpdateCheckResult } from '../utils/appVersion';

interface DownloadPageProps {
  onClose: () => void;
}

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  const mb = bytes / 1024 / 1024;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * 独立下载页：拉取 GitHub 最新 Release，按平台提供 Windows / Android 安装包下载链接。
 * 复用 checkAppUpdate()（后端 /api/app/latest 缓存，国内快、不受 GitHub 限流影响）。
 */
export function DownloadPage({ onClose }: DownloadPageProps) {
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setResult(await checkAppUpdate(false));
    } catch (e) {
      setError(e instanceof Error ? e.message : '获取下载信息失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 从 assets 里识别各平台安装包（.sig / latest.json 会被过滤掉）
  const winExe = result?.assets.find((a) => /\.exe$/i.test(a.name));
  const winMsi = result?.assets.find((a) => /\.msi$/i.test(a.name));
  const apk = result?.assets.find((a) => /\.apk$/i.test(a.name));

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#0b0f17] text-slate-200">
      {/* 顶栏 */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 bg-[#101622]/90 px-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <Download className="h-4 w-4 text-sky-400" />
          下载 ISSH
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
          title="返回"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-8">
        {loading ? (
          <div className="flex flex-col items-center gap-3 text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin text-sky-400" />
            <span className="text-sm">正在获取最新版本…</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3">
            <span className="text-sm text-rose-400">{error}</span>
            <button
              type="button"
              onClick={() => void load()}
              className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/10"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              重试
            </button>
          </div>
        ) : (
          <div className="w-full max-w-2xl">
            {/* 标题 + 版本 */}
            <div className="mb-6 text-center">
              <h1 className="text-2xl font-bold text-slate-100">
                下载 ISSH
                {result?.tagName ? (
                  <span className="ml-2 inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/15 px-2.5 py-0.5 align-middle text-xs font-semibold text-sky-300">
                    {result.tagName}
                  </span>
                ) : null}
              </h1>
              <p className="mt-1.5 text-sm text-slate-400">
                选择你的平台，下载后即可开始使用
              </p>
            </div>

            {/* 下载卡片 */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Windows */}
              <div className="flex flex-col items-center rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center transition hover:border-sky-500/40 hover:bg-white/[0.06]">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-400">
                  <Monitor className="h-8 w-8" />
                </div>
                <h2 className="text-lg font-semibold text-slate-100">Windows</h2>
                <p className="mt-1 text-xs text-slate-400">电脑版 · x64</p>
                <div className="mt-4 flex flex-col items-center gap-2">
                  {winExe ? (
                    <a
                      href={winExe.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-400"
                    >
                      <Download className="h-4 w-4" />
                      下载安装包
                      {winExe.size ? (
                        <span className="text-xs font-normal opacity-80">
                          {formatSize(winExe.size)}
                        </span>
                      ) : null}
                    </a>
                  ) : (
                    <span className="text-xs text-slate-500">暂无安装包</span>
                  )}
                  {winMsi ? (
                    <a
                      href={winMsi.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-slate-400 transition hover:text-slate-200"
                    >
                      下载 MSI 安装包（{formatSize(winMsi.size)}）
                    </a>
                  ) : null}
                </div>
              </div>

              {/* Android */}
              <div className="flex flex-col items-center rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center transition hover:border-emerald-500/40 hover:bg-white/[0.06]">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400">
                  <Smartphone className="h-8 w-8" />
                </div>
                <h2 className="text-lg font-semibold text-slate-100">Android</h2>
                <p className="mt-1 text-xs text-slate-400">安卓版 · arm64</p>
                <div className="mt-4 flex flex-col items-center gap-2">
                  {apk ? (
                    <a
                      href={apk.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-400"
                    >
                      <Download className="h-4 w-4" />
                      下载 APK
                      {apk.size ? (
                        <span className="text-xs font-normal opacity-80">
                          {formatSize(apk.size)}
                        </span>
                      ) : null}
                    </a>
                  ) : (
                    <span className="text-xs text-slate-500">暂无安装包</span>
                  )}
                </div>
              </div>
            </div>

            {/* 底部链接 */}
            {result?.htmlUrl ? (
              <div className="mt-6 text-center">
                <a
                  href={result.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-slate-500 transition hover:text-sky-300"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  在 GitHub 查看全部版本
                </a>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
