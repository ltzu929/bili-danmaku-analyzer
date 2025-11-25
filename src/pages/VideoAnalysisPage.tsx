import React, { useEffect, useState } from 'react';
import { apiUrl } from '@/lib/api';
import { ArrowLeft, Download, Share2, Calendar, User } from 'lucide-react';
import DanmakuChart from '../components/DanmakuChart';
import KeywordSearch from '../components/KeywordSearch';

interface VideoInfo {
  bvid: string;
  title: string;
  date: string;
  url: string;
  videoOwner?: {
    mid: number;
    name: string;
    face: string;
  };
}

interface DanmakuData {
  bvid: string;
  title: string;
  date: string;
  url: string;
  cover?: string;
  totalDanmakus: number;
  stats: any[];
  keywords: any[];
  danmakus: any[];
  videoOwner?: {
    mid: number;
    name: string;
    face: string;
  };
}

interface VideoAnalysisPageProps {
  data: DanmakuData;
  onReturnHome: () => void;
}

export default function VideoAnalysisPage({ data, onReturnHome }: VideoAnalysisPageProps) {
  const [chartOptions, setChartOptions] = useState({
    showAll: true,
    showPeakOnly: false,
    showWithEmoji: false,
    highPrecision: false,
    smoothLine: true,
    filterMode: 'all' as 'all' | 'call' | 'ha' | 'cao' | 'question'
  });

  // 封面兜底：如果后端返回的分析数据没有封面，则按BV号再拉一次封面
  const [cover, setCover] = useState<string>(data.cover || '');
  useEffect(() => {
    let ignore = false;
    const load = async () => {
      if (!cover && data.bvid) {
        try {
          const resp = await fetch(`/api/video/${data.bvid}`);
          if (resp.ok) {
            const json = await resp.json();
            if (!ignore) setCover(json.cover || '');
          }
        } catch {}
      }
    };
    load();
    return () => { ignore = true; };
  }, [data.bvid, cover]);

  const handleExport = () => {
    if (!data) return;
    
    const dataStr = JSON.stringify(data, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `danmaku_${data.bvid}_${data.date}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleShare = () => {
    const shareUrl = `${window.location.origin}/analysis?bvid=${data.bvid}`;
    if (navigator.share) {
      navigator.share({
        title: `B站视频弹幕分析 - ${data.title}`,
        text: `视频 ${data.title} 的弹幕分析报告`,
        url: shareUrl
      });
    } else {
      navigator.clipboard.writeText(shareUrl);
      alert('分析链接已复制到剪贴板');
    }
  };

  // 下载封面：通过后端封面代理接口获取二进制并触发浏览器下载
  const handleDownloadCover = async () => {
    try {
      if (!cover) return;
      let targetPath = '';
      try {
        const raw = localStorage.getItem('app_settings');
        if (raw) {
          const s = JSON.parse(raw);
          if (typeof s.coverDownloadPath === 'string') targetPath = s.coverDownloadPath;
        }
      } catch {}

      if (targetPath) {
        const resp = await fetch(apiUrl('/api/save-cover'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: cover, bvid: data.bvid, dir: targetPath })
        });
        if (resp.ok) {
          const json = await resp.json();
          alert(`封面已保存到: ${json.path}`);
          return;
        }
      }

      const coverProxy = apiUrl(`/api/cover?url=${encodeURIComponent(cover)}`);
      const resp = await fetch(coverProxy);
      if (!resp.ok) return;
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const extMatch = (cover.split('.').pop() || '').toLowerCase();
      const ext = ['png','jpg','jpeg','webp'].includes(extMatch) ? extMatch : 'jpg';
      link.href = url;
      link.download = `cover_${data.bvid || 'video'}.${ext}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {}
  };

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">未找到数据</h2>
          <p className="text-gray-600 mb-4">无法获取视频弹幕数据</p>
          <button 
            onClick={onReturnHome}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            返回首页
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* 头部导航 */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-3">
            <div className="flex items-center space-x-4">
              <button
                onClick={onReturnHome}
                className="flex items-center text-gray-600 hover:text-gray-900 transition-colors"
              >
                <ArrowLeft className="w-5 h-5 mr-2" />
                返回
              </button>
              <div className="h-6 w-px bg-gray-300"></div>
              <div>
                <h1 className="text-lg font-bold text-gray-900">视频弹幕分析</h1>
                <p className="text-xs text-gray-500">B站视频弹幕数据可视化</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-2">
              <button
                onClick={handleExport}
                className="flex items-center px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
              >
                <Download className="w-4 h-4 mr-1.5" />
                导出
              </button>
              <button
                onClick={handleShare}
                className="flex items-center px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-sm"
              >
                <Share2 className="w-4 h-4 mr-1.5" />
                分享
              </button>
              {data.videoOwner && (
                <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-white shadow-sm">
                  <img 
                    src={data.videoOwner.face} 
                    alt={data.videoOwner.name}
                    className="w-full h-full object-cover"
                    onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                      const nextSibling = target.nextElementSibling as HTMLElement;
                      if (nextSibling) {
                        nextSibling.style.display = 'flex';
                      }
                    }}
                  />
                  <div className="w-full h-full bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center" style={{display: 'none'}}>
                    <User className="w-4 h-4 text-white" />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* 视频信息卡片 */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
        <div className="bg-white/70 backdrop-blur-sm rounded-xl shadow-sm border border-white/50 p-4 mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="w-24 h-16 bg-gray-300 rounded-lg flex items-center justify-center overflow-hidden relative">
                <img 
                  src={cover ? apiUrl(`/api/cover?url=${encodeURIComponent(cover)}`) : ''}
                  alt="封面"
                  className="w-full h-full object-cover cursor-pointer"
                  onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                    const nextSibling = target.nextElementSibling as HTMLElement;
                    if (nextSibling) {
                      nextSibling.style.display = 'flex';
                    }
                  }}
                  onClick={handleDownloadCover}
                  style={{ display: cover ? 'block' : 'none' }}
                />
                <div className="w-full h-full bg-gray-200 rounded flex items-center justify-center" style={{ display: cover ? 'none' : 'flex' }}>
                  <span className="text-xs text-gray-500">封面</span>
                </div>
                {cover && (
                  <button
                    onClick={handleDownloadCover}
                    title="下载封面"
                    className="absolute top-1 right-1 bg-white/80 text-gray-700 hover:bg-white px-1.5 py-0.5 rounded shadow"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{data.title}</h2>
                <p className="text-sm text-gray-600">
                  <span className="inline-flex items-center">
                    <User className="w-3 h-3 mr-1" />
                    UP主: {data.videoOwner?.name || '未知'}
                  </span>
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                {data.totalDanmakus.toLocaleString()}
              </div>
              <div className="text-sm text-gray-500">总弹幕数</div>
            </div>
          </div>
        </div>
      </div>

      {/* 主要内容 */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        {/* 图表区域 */}
        <div className="grid grid-cols-1 gap-4">
          <div>
            <div className="bg-white/70 backdrop-blur-sm rounded-xl shadow-sm border border-white/50 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold text-gray-900">
                  弹幕数量与时间分布
                </h2>
                
              </div>
              <DanmakuChart 
                data={data.stats} 
                options={chartOptions}
                danmakus={data.danmakus}
              />
            </div>
          </div>
          
          
        </div>

        <div className="mb-2">
          <div className="space-y-1 text-xs text-gray-700">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input type="radio" name="filterMode" checked={chartOptions.filterMode==='all'} onChange={() => setChartOptions({ ...chartOptions, filterMode: 'all' })} />
              <span>显示全部</span>
            </label>
            <label className="flex items-center space-x-2 cursor-pointer">
              <input type="radio" name="filterMode" checked={chartOptions.filterMode==='call'} onChange={() => setChartOptions({ ...chartOptions, filterMode: 'call' })} />
              <span>仅显示打call密度（定位歌）</span>
            </label>
            <label className="flex items-center space-x-2 cursor-pointer">
              <input type="radio" name="filterMode" checked={chartOptions.filterMode==='ha'} onChange={() => setChartOptions({ ...chartOptions, filterMode: 'ha' })} />
              <span>仅显示哈哈密度</span>
            </label>
            <label className="flex items-center space-x-2 cursor-pointer">
              <input type="radio" name="filterMode" checked={chartOptions.filterMode==='cao'} onChange={() => setChartOptions({ ...chartOptions, filterMode: 'cao' })} />
              <span>仅显示草密度</span>
            </label>
            <label className="flex items-center space-x-2 cursor-pointer">
              <input type="radio" name="filterMode" checked={chartOptions.filterMode==='question'} onChange={() => setChartOptions({ ...chartOptions, filterMode: 'question' })} />
              <span>仅显示？密度</span>
            </label>
          </div>
        </div>
        {/* 热词搜索 */}
        <div className="mt-4">
          <KeywordSearch 
            bvid={data.bvid}
            date={data.date}
            keywords={data.keywords}
          />
        </div>

        {/* 使用说明 */}
        <div className="mt-6 bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200/50 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-2">
            <div className="w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center">
              <span className="text-white text-xs font-bold">i</span>
            </div>
            <h3 className="font-medium text-blue-900">分析说明</h3>
          </div>
          <div className="text-sm text-blue-800 space-y-1 leading-relaxed">
            <p>• 本分析基于B站视频的弹幕数据</p>
            <p>• 高峰时段表示弹幕密度较高的精彩时刻</p>
            <p>• 可用于快速定位视频中的高能片段进行剪辑</p>
            <p>• 分析结果仅供参考，建议结合实际内容判断</p>
          </div>
        </div>
      </div>
    </div>
  );
}
