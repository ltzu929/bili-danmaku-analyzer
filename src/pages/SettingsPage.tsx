import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Loader2 } from 'lucide-react'

type AppSettings = {
  topHotwords?: number
  tooltipWindowSeconds?: number
  mergeSimilar?: boolean
  coverDownloadPath?: string
  tcSecretId?: string
  tcSecretKey?: string
  tcRegion?: string
  tcBucket?: string
  asrEngine?: string
  watchPath?: string
  audioFormats?: string
}

const FEATURE_AUDIO_TEXT = false
export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>({ topHotwords: 5, tooltipWindowSeconds: 30, mergeSimilar: true, coverDownloadPath: '', tcSecretId: '', tcSecretKey: '', tcRegion: '', tcBucket: '', asrEngine: '16k_zh', watchPath: './watch', audioFormats: '*.wav' })
  const [saving, setSaving] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [updateState, setUpdateState] = useState<string>('')
  const [updateProgress, setUpdateProgress] = useState<number>(0)
  const [defaultDownloads, setDefaultDownloads] = useState<string>('')
  const [pythonPath, setPythonPath] = useState<string>('python')
  const [watchBusy, setWatchBusy] = useState<boolean>(false)
  const [watchStatus, setWatchStatus] = useState<{ running: boolean; pid?: number; logs: string[] }>({ running: false, pid: undefined, logs: [] })
  const [logsRef, setLogsRef] = useState<HTMLDivElement | null>(null)
  const regionOptions = [
    'ap-beijing','ap-nanjing','ap-shanghai','ap-guangzhou','ap-chengdu','ap-chongqing',
    'ap-hongkong','ap-singapore','ap-jakarta','ap-seoul','ap-bangkok','ap-tokyo',
    'na-siliconvalley','na-ashburn','sa-saopaulo','eu-frankfurt',
    'ap-shenzhen-fsi','ap-shanghai-fsi','ap-beijing-fsi','me-saudi-arabia'
  ]

  useEffect(() => {
    try {
      const raw = localStorage.getItem('app_settings')
      if (raw) {
        const s = JSON.parse(raw)
        setSettings({ topHotwords: s.topHotwords ?? 5, tooltipWindowSeconds: s.tooltipWindowSeconds ?? 30, mergeSimilar: s.mergeSimilar ?? true, coverDownloadPath: s.coverDownloadPath ?? '', tcSecretId: s.tcSecretId ?? '', tcSecretKey: s.tcSecretKey ?? '', tcRegion: s.tcRegion ?? '', tcBucket: s.tcBucket ?? '', asrEngine: s.asrEngine ?? '16k_zh', watchPath: s.watchPath ?? './watch', audioFormats: s.audioFormats ?? '*.wav' })
      }
    } catch {}
    ;(async () => {
      try {
        if (!settings.coverDownloadPath) {
          const resp = await fetch('/api/system/downloads-path')
          if (resp.ok) {
            const json = await resp.json()
            setDefaultDownloads(json.path || '')
            setSettings(prev => ({ ...prev, coverDownloadPath: prev.coverDownloadPath || json.path || '' }))
          }
        }
        if (FEATURE_AUDIO_TEXT) {
          const confResp = await fetch('/api/asr-config')
          if (confResp.ok) {
            const c = await confResp.json()
            setSettings(prev => ({ ...prev, tcSecretId: c.secretId || prev.tcSecretId, tcSecretKey: c.secretKey || prev.tcSecretKey, tcRegion: c.region || prev.tcRegion, tcBucket: c.bucket || prev.tcBucket, asrEngine: c.engineModelType || prev.asrEngine, watchPath: c.watchPath || prev.watchPath, audioFormats: c.audioFormats || prev.audioFormats }))
          }
        }
      } catch {}
    })()
  }, [])

  const saveSettings = async () => {
    setSaving(true)
    try {
      let region = settings.tcRegion || ''
      if (!region) {
        try {
          const resp = await fetch('/api/asr-config')
          if (resp.ok) {
            const c = await resp.json()
            region = c.region || ''
          }
        } catch {}
      }
      const next = { ...settings, tcRegion: region }
      localStorage.setItem('app_settings', JSON.stringify(next))
      if (FEATURE_AUDIO_TEXT) {
        fetch('/api/asr-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secretId: next.tcSecretId, secretKey: next.tcSecretKey, region: next.tcRegion, bucket: next.tcBucket, engineModelType: next.asrEngine, watchPath: next.watchPath, audioFormats: next.audioFormats }) }).catch(() => {})
      }
      setSettings(next)
    } finally {
      setSaving(false)
    }
  }

  const resetSettings = () => {
    const defaults: AppSettings = { topHotwords: 5, tooltipWindowSeconds: 30, mergeSimilar: true, coverDownloadPath: defaultDownloads || '', tcSecretId: '', tcSecretKey: '', tcRegion: '', tcBucket: '', asrEngine: '16k_zh', watchPath: './watch', audioFormats: '*.wav' }
    setSettings(defaults)
    localStorage.setItem('app_settings', JSON.stringify(defaults))
    if (FEATURE_AUDIO_TEXT) {
      fetch('/api/asr-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secretId: '', secretKey: '', region: '', bucket: '', engineModelType: '16k_zh', watchPath: './watch', audioFormats: '*.wav' }) }).catch(() => {})
    }
  }

  const clearServerCache = async () => {
    setClearing(true)
    try {
      await fetch('/api/cache', { method: 'DELETE' })
    } catch {}
    setClearing(false)
  }

  useEffect(() => {
    if (!FEATURE_AUDIO_TEXT) return
    let timer: any = null
    const poll = async () => {
      try {
        const resp = await fetch('/api/audio-watch/status')
        if (resp.ok) {
          const s = await resp.json()
          setWatchStatus({ running: !!s.running, pid: s.pid, logs: Array.isArray(s.logs) ? s.logs : [] })
        }
      } catch {}
    }
    poll()
    timer = setInterval(poll, 3000)
    return () => { if (timer) clearInterval(timer) }
  }, [])

  const startWatch = async () => {
    if (!FEATURE_AUDIO_TEXT) return
    setWatchBusy(true)
    try {
      await fetch('/api/audio-watch/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pythonPath, watchPath: settings.watchPath, audioFormats: settings.audioFormats }) })
    } catch {}
    setWatchBusy(false)
  }

  const stopWatch = async () => {
    if (!FEATURE_AUDIO_TEXT) return
    setWatchBusy(true)
    try {
      await fetch('/api/audio-watch/stop', { method: 'POST' })
    } catch {}
    setWatchBusy(false)
  }

  const clearLogs = async () => {
    if (!FEATURE_AUDIO_TEXT) return
    try { await fetch('/api/audio-watch/clear-logs', { method: 'POST' }) } catch {}
    setWatchStatus(prev => ({ ...prev, logs: [] }))
  }

  const downloadLogs = () => {
    if (!FEATURE_AUDIO_TEXT) return
    const text = (watchStatus.logs || []).join('\n')
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    a.download = `audio-watch-logs-${ts}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    if (logsRef) {
      logsRef.scrollTop = logsRef.scrollHeight
    }
  }, [watchStatus.logs, logsRef])

  useEffect(() => {
    const api = (window as any).updater
    if (!api || updateState) return
    api.on('checking', () => setUpdateState('checking'))
    api.on('available', () => setUpdateState('available'))
    api.on('none', () => setUpdateState('none'))
    api.on('progress', (p: any) => { setUpdateState('progress'); if (p && typeof p.percent === 'number') setUpdateProgress(p.percent) })
    api.on('downloaded', () => setUpdateState('downloaded'))
    api.on('error', () => setUpdateState('error'))
  }, [updateState])

  return (
    <div className="max-w-3xl mx-auto p-6">
      <Card className="bg-white dark:bg-gray-800">
        <CardHeader>
          <CardTitle className="text-2xl text-gray-800 dark:text-white">设置</CardTitle>
        </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-8">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="topHotwords">悬浮窗热词显示数量</Label>
              <Input id="topHotwords" type="number" min={1} max={20} value={settings.topHotwords ?? 5} onChange={(e) => setSettings({ ...settings, topHotwords: Number(e.target.value) })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tooltipWindowSeconds">悬浮窗时间窗口（秒）</Label>
              <Input id="tooltipWindowSeconds" type="number" min={5} max={120} value={settings.tooltipWindowSeconds ?? 30} onChange={(e) => setSettings({ ...settings, tooltipWindowSeconds: Number(e.target.value) })} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>合并相似弹幕</Label>
              <div className="flex items-center gap-3">
                <Switch checked={settings.mergeSimilar ?? true} onCheckedChange={(v) => setSettings({ ...settings, mergeSimilar: v })} />
                <span className="text-sm text-gray-600">将“哈哈”“？？？”等变体合并统计</span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="coverDownloadPath">封面下载路径</Label>
            <div className="flex items-center gap-2">
              <Input id="coverDownloadPath" type="text" value={settings.coverDownloadPath ?? ''} placeholder={defaultDownloads || '系统下载文件夹'} onChange={(e) => setSettings({ ...settings, coverDownloadPath: e.target.value })} />
              <Button variant="secondary" onClick={async () => {
                try {
                  const api = (window as any).dialogs
                  if (api && typeof api.chooseDir === 'function') {
                    const r = await api.chooseDir()
                    if (r && r.path) setSettings({ ...settings, coverDownloadPath: r.path })
                    return
                  }
                  if ((window as any).showDirectoryPicker) {
                    alert('当前为浏览器模式，无法获取系统路径，请在输入框中手动填写或使用桌面应用进行选择')
                    return
                  }
                  alert('当前环境不支持目录选择，请在桌面应用中使用或手动填写路径')
                } catch {}
              }}>选择目录</Button>
            </div>
            <div className="text-xs text-gray-500">默认使用系统“下载”文件夹</div>
          </div>

          {FEATURE_AUDIO_TEXT && (
            <>
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="tcSecretId">腾讯云 SecretId</Label>
                  <Input id="tcSecretId" type="text" value={settings.tcSecretId ?? ''} onChange={(e) => setSettings({ ...settings, tcSecretId: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tcSecretKey">腾讯云 SecretKey</Label>
                  <Input id="tcSecretKey" type="password" value={settings.tcSecretKey ?? ''} onChange={(e) => setSettings({ ...settings, tcSecretKey: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tcRegion">区域 Region</Label>
                  <div className="grid gap-2 md:grid-cols-2">
                    <select id="tcRegionSelect" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={settings.tcRegion && regionOptions.includes(settings.tcRegion) ? settings.tcRegion : ''} onChange={(e) => setSettings({ ...settings, tcRegion: e.target.value })}>
                      <option value="">不选择</option>
                      <option value="ap-beijing">ap-beijing（北京）</option>
                      <option value="ap-nanjing">ap-nanjing（南京）</option>
                      <option value="ap-shanghai">ap-shanghai（上海）</option>
                      <option value="ap-guangzhou">ap-guangzhou（广州）</option>
                      <option value="ap-chengdu">ap-chengdu（成都）</option>
                      <option value="ap-chongqing">ap-chongqing（重庆）</option>
                      <option value="ap-hongkong">ap-hongkong（中国香港）</option>
                      <option value="ap-singapore">ap-singapore（新加坡）</option>
                      <option value="ap-jakarta">ap-jakarta（雅加达）</option>
                      <option value="ap-seoul">ap-seoul（首尔）</option>
                      <option value="ap-bangkok">ap-bangkok（曼谷）</option>
                      <option value="ap-tokyo">ap-tokyo（东京）</option>
                      <option value="na-siliconvalley">na-siliconvalley（硅谷）</option>
                      <option value="na-ashburn">na-ashburn（弗吉尼亚）</option>
                      <option value="sa-saopaulo">sa-saopaulo（圣保罗）</option>
                      <option value="eu-frankfurt">eu-frankfurt（法兰克福）</option>
                      <option value="ap-shenzhen-fsi">ap-shenzhen-fsi（深圳金融）</option>
                      <option value="ap-shanghai-fsi">ap-shanghai-fsi（上海金融）</option>
                      <option value="ap-beijing-fsi">ap-beijing-fsi（北京金融）</option>
                      <option value="me-saudi-arabia">me-saudi-arabia（沙特阿拉伯）</option>
                    </select>
                    <Input id="tcRegion" type="text" placeholder="可自定义，如 ap-guangzhou" value={settings.tcRegion ?? ''} onChange={(e) => setSettings({ ...settings, tcRegion: e.target.value })} />
                  </div>
                  <div className="text-xs text-gray-500">默认与 COS 地域一致</div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tcBucket">COS Bucket</Label>
                  <Input id="tcBucket" type="text" value={settings.tcBucket ?? ''} onChange={(e) => setSettings({ ...settings, tcBucket: e.target.value })} />
                </div>
              </div>
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="asrEngine">ASR 引擎模型</Label>
                  <select id="asrEngine" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={settings.asrEngine ?? '16k_zh'} onChange={(e) => setSettings({ ...settings, asrEngine: e.target.value })}>
                    <option value="16k_zh">16k_zh（中文）</option>
                    <option value="16k_en">16k_en（英文）</option>
                  </select>
                </div>
              </div>
            </>
          )}

          {FEATURE_AUDIO_TEXT && (
            <>
              <div className="space-y-2">
                <Label htmlFor="watchPath">监控目录 WatchPath</Label>
                <div className="flex items-center gap-2">
                  <Input id="watchPath" type="text" value={settings.watchPath ?? './watch'} onChange={(e) => setSettings({ ...settings, watchPath: e.target.value })} />
                  <Button variant="secondary" onClick={async () => {
                    try {
                      const api = (window as any).dialogs
                      if (api && typeof api.chooseDir === 'function') {
                        const r = await api.chooseDir()
                        if (r && r.path) setSettings({ ...settings, watchPath: r.path })
                        return
                      }
                      if ((window as any).showDirectoryPicker) {
                        alert('当前为浏览器模式，无法获取系统路径，请在输入框中手动填写或使用桌面应用进行选择')
                        return
                      }
                      alert('当前环境不支持目录选择，请在桌面应用中使用或手动填写路径')
                    } catch {}
                  }}>选择目录</Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="audioFormats">音频格式 AudioFormats</Label>
                <Input id="audioFormats" type="text" placeholder="*.wav,*.mp3" value={settings.audioFormats ?? '*.wav'} onChange={(e) => setSettings({ ...settings, audioFormats: e.target.value })} />
              </div>
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="pythonPath">Python 路径</Label>
                  <Input id="pythonPath" type="text" placeholder="python 或 python3" value={pythonPath} onChange={(e) => setPythonPath(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>本地监控控制</Label>
                  <div className="flex items-center gap-2">
                    <Button onClick={startWatch} disabled={watchBusy} className="bg-green-600 hover:bg-green-700 text白">启动监控</Button>
                    <Button onClick={stopWatch} disabled={watchBusy} variant="destructive">停止监控</Button>
                    <span className="text-sm text-gray-600">状态：{watchStatus.running ? `运行中 (PID: ${watchStatus.pid})` : '已停止'}</span>
                  </div>
                </div>
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
            </>
          )}
        </div>

          <div className="flex items-center gap-3">
            <Button onClick={saveSettings} disabled={saving} className="bg-blue-600 hover:bg-blue-700">保存设置</Button>
            <Button onClick={resetSettings} variant="secondary">重置为默认</Button>
            <Button onClick={clearServerCache} className="bg-gray-100 text-gray-700 hover:bg-gray-200" disabled={clearing}>清除服务器缓存</Button>
            <Button onClick={() => (window as any).updater?.check?.()} className="bg-green-600 hover:bg-green-700 text-white">检查更新</Button>
            {updateState === 'progress' && (
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <div className="w-40 h-2 bg-gray-200 rounded">
                  <div className="h-2 bg-green-600 rounded" style={{ width: `${Math.round(updateProgress)}%` }} />
                </div>
                <span className="text-xs text-gray-600">{Math.round(updateProgress)}%</span>
              </div>
            )}
            {updateState === 'downloaded' && (
              <Button onClick={() => (window as any).updater?.install?.()} className="bg-red-600 hover:bg-red-700 text-white">安装更新</Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
