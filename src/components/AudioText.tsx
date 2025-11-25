import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Loader2, Upload, FileAudio, Download } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface AudioTextProps {
  onTextGenerated: (text: string) => void;
}

export default function AudioText({ onTextGenerated }: AudioTextProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [watchBusy, setWatchBusy] = useState(false);
  const [watchStatus, setWatchStatus] = useState<{ running: boolean; pid?: number; logs: string[] }>({ running: false, pid: undefined, logs: [] });
  const [logsRef, setLogsRef] = useState<HTMLDivElement | null>(null);
  const [watchPath, setWatchPath] = useState<string>('');
  const [audioFormats, setAudioFormats] = useState<string>('*.wav');
  const [pythonPath, setPythonPath] = useState<string>('python');

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch('/api/asr-config');
        if (resp.ok) {
          const c = await resp.json();
          setWatchPath(c.watchPath || './watch');
          setAudioFormats(c.audioFormats || '*.wav');
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    let timer: any = null;
    const poll = async () => {
      try {
        const resp = await fetch('/api/audio-watch/status');
        if (resp.ok) {
          const s = await resp.json();
          setWatchStatus({ running: !!s.running, pid: s.pid, logs: Array.isArray(s.logs) ? s.logs : [] });
        }
      } catch {}
    };
    poll();
    timer = setInterval(poll, 3000);
    return () => { if (timer) clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (logsRef) {
      logsRef.scrollTop = logsRef.scrollHeight;
    }
  }, [watchStatus.logs, logsRef]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('audio/')) {
        setError('请选择音频文件');
        return;
      }
      setSelectedFile(file);
      setError('');
    }
  };

  const handleConvert = async () => {
    if (!selectedFile) {
      setError('请先选择音频文件');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // 创建FormData对象
      const formData = new FormData();
      formData.append('audio', selectedFile);

      // 调用后端API进行语音转文字
      const response = await fetch('/api/audio-to-text', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('转换失败，请检查音频文件格式');
      }

      const data = await response.json();
      const srt = data.srt || '';
      setResult(srt);
      onTextGenerated(srt);
    } catch (err) {
      setError(err instanceof Error ? err.message : '转换过程中出现错误');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (result) {
      const blob = new Blob([result], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedFile?.name.replace(/\.[^/.]+$/, '') || 'audio'}.srt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const startWatch = async () => {
    setWatchBusy(true);
    try {
      await fetch('/api/audio-watch/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pythonPath, watchPath, audioFormats }) });
    } catch {}
    setWatchBusy(false);
  };

  const stopWatch = async () => {
    setWatchBusy(true);
    try {
      await fetch('/api/audio-watch/stop', { method: 'POST' });
    } catch {}
    setWatchBusy(false);
  };

  const clearLogs = async () => {
    try { await fetch('/api/audio-watch/clear-logs', { method: 'POST' }); } catch {}
    setWatchStatus(prev => ({ ...prev, logs: [] }));
  };

  const downloadLogs = () => {
    const text = (watchStatus.logs || []).join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    a.download = `audio-watch-logs-${ts}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <Card className="bg-white dark:bg-gray-800">
        <CardHeader>
          <CardTitle className="text-2xl text-gray-800 dark:text-white">
            语音转文字
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 文件选择 */}
          <div className="space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              onChange={handleFileSelect}
              className="hidden"
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              variant="outline"
              className="w-full"
              disabled={loading}
            >
              <Upload className="mr-2 h-4 w-4" />
              选择音频文件
            </Button>
            
            {selectedFile && (
              <div className="flex items-center p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <FileAudio className="w-5 h-5 mr-2 text-blue-600" />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  {selectedFile.name}
                </span>
                <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">
                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                </span>
              </div>
            )}
          </div>

          {error && (
            <Alert className="border-red-200 bg-red-50">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button
            onClick={handleConvert}
            disabled={loading || !selectedFile}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                转换中...
              </>
            ) : (
              '开始转换'
            )}
          </Button>

          {/* 转换结果 */}
          {result && (
            <div className="space-y-4">
              <div>
                <Label className="text-gray-700 dark:text-gray-300">
                  转换结果
                </Label>
                <Textarea
                  value={result}
                  readOnly
                  rows={8}
                  className="mt-2 bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600"
                />
              </div>
              <Button
                onClick={handleDownload}
                variant="outline"
                className="w-full"
              >
                <Download className="mr-2 h-4 w-4" />
                下载文本文件
              </Button>
            </div>
          )}

          <div className="text-sm text-gray-500 dark:text-gray-400 space-y-1">
            <p>• 支持MP3、WAV、M4A等常见音频格式</p>
            <p>• 自动识别中文语音并转换为文字</p>
            <p>• 支持下载转换后的文本文件</p>
          </div>

          <div className="space-y-6">
            <div className="space-y-2">
              <Label>本地监控控制</Label>
              <div className="flex items-center gap-2">
                <Button onClick={startWatch} disabled={watchBusy} className="bg-green-600 hover:bg-green-700 text-white">启动监控</Button>
                <Button onClick={stopWatch} disabled={watchBusy} variant="destructive">停止监控</Button>
                <span className="text-sm text-gray-600">状态：{watchStatus.running ? `运行中 (PID: ${watchStatus.pid})` : '已停止'}</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="watchPathLocal">监控目录</Label>
              <div className="flex items-center gap-2">
                <Input id="watchPathLocal" type="text" value={watchPath} onChange={(e) => setWatchPath(e.target.value)} />
                <Button variant="secondary" onClick={async () => {
                  try {
                    const api = (window as any).dialogs;
                    if (api && typeof api.chooseDir === 'function') {
                      const r = await api.chooseDir();
                      if (r && r.path) setWatchPath(r.path);
                      return;
                    }
                    if ((window as any).showDirectoryPicker) {
                      alert('当前为浏览器模式，无法获取系统路径，请在输入框中手动填写或使用桌面应用进行选择');
                      return;
                    }
                    alert('当前环境不支持目录选择，请在桌面应用中使用或手动填写路径');
                  } catch {}
                }}>选择目录</Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="audioFormatsLocal">音频格式</Label>
              <Input id="audioFormatsLocal" type="text" placeholder="*.wav,*.mp3" value={audioFormats} onChange={(e) => setAudioFormats(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>监控日志</Label>
              <div ref={setLogsRef} className="h-32 overflow-auto rounded-md border border-input bg-background p-2 text-xs text-gray-700 whitespace-pre-wrap">
                {(watchStatus.logs || []).join('\n') || '暂无日志'}
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={downloadLogs} variant="outline">下载日志</Button>
                <Button onClick={clearLogs} variant="secondary">清空日志</Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
