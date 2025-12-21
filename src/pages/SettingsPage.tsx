/* eslint-disable @typescript-eslint/no-explicit-any */
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
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>({ topHotwords: 5, tooltipWindowSeconds: 30, mergeSimilar: true, coverDownloadPath: '' })
  const [saving, setSaving] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [updateState, setUpdateState] = useState<string>('')
  const [updateProgress, setUpdateProgress] = useState<number>(0)
  const [defaultDownloads, setDefaultDownloads] = useState<string>('')

  useEffect(() => {
    try {
      const raw = localStorage.getItem('app_settings')
      if (raw) {
        const s = JSON.parse(raw)
        setSettings({ topHotwords: s.topHotwords ?? 5, tooltipWindowSeconds: s.tooltipWindowSeconds ?? 30, mergeSimilar: s.mergeSimilar ?? true, coverDownloadPath: s.coverDownloadPath ?? '' })
      }
    } catch { /* ignore */ }
    (async () => {
      try {
        if (!settings.coverDownloadPath) {
          const resp = await fetch('/api/system/downloads-path')
          if (resp.ok) {
            const json = await resp.json()
            setDefaultDownloads(json.path || '')
            setSettings(prev => ({ ...prev, coverDownloadPath: prev.coverDownloadPath || json.path || '' }))
          }
        }
      } catch { /* ignore */ }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveSettings = async () => {
    setSaving(true)
    try {
      localStorage.setItem('app_settings', JSON.stringify(settings))
    } finally {
      setSaving(false)
    }
  }

  const resetSettings = () => {
    const defaults: AppSettings = { topHotwords: 5, tooltipWindowSeconds: 30, mergeSimilar: true, coverDownloadPath: defaultDownloads || '' }
    setSettings(defaults)
    localStorage.setItem('app_settings', JSON.stringify(defaults))
  }

  const clearServerCache = async () => {
    setClearing(true)
    try {
      await fetch('/api/cache', { method: 'DELETE' })
    } catch { /* ignore */ }
    setClearing(false)
  }

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
                } catch { /* ignore */ }
              }}>选择目录</Button>
            </div>
            <div className="text-xs text-gray-500">默认使用系统“下载”文件夹</div>
          </div>
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
