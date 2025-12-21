/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import SidebarLayout from './SidebarLayout';
import DanmakuAnalysis from './DanmakuAnalysis';
import UPVideos from './UPVideos';
import VideoAnalysisPage from '@/pages/VideoAnalysisPage';
import SettingsPage from '@/pages/SettingsPage';

type ActiveTab = 'danmaku' | 'up-videos' | 'settings';
type OriginTab = 'danmaku' | 'up-videos' | null;

export default function MainApp() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('danmaku');
  const [analysisData, setAnalysisData] = useState<any>(null);
  const [selectedVideo, setSelectedVideo] = useState<any>(null);
  const [originTab, setOriginTab] = useState<OriginTab>(null);
  const [lastSeriesUrl, setLastSeriesUrl] = useState<string>('');

  const handleAnalysisComplete = (data: any) => {
    setAnalysisData(data);
    setOriginTab(selectedVideo ? 'up-videos' : 'danmaku');
  };

  const handleVideoSelect = (video: any, ctx?: { seriesUrl?: string }) => {
    setSelectedVideo(video);
    setOriginTab('up-videos');
    if (ctx?.seriesUrl) setLastSeriesUrl(ctx.seriesUrl);
    setActiveTab('danmaku');
  };

  const handleReturnHome = () => {
    setAnalysisData(null);
    setSelectedVideo(null);
    if (originTab === 'up-videos') {
      setActiveTab('up-videos');
    } else {
      setActiveTab('danmaku');
    }
  };

  const renderContent = () => {
    if (analysisData) {
      return <VideoAnalysisPage data={analysisData} onReturnHome={handleReturnHome} />;
    }

    switch (activeTab) {
      case 'danmaku':
        return <DanmakuAnalysis onAnalysisComplete={handleAnalysisComplete} initialUrl={selectedVideo?.url} />;
      case 'up-videos':
        return <UPVideos onVideoSelect={handleVideoSelect} initialSeriesUrl={lastSeriesUrl} />;
      
      case 'settings':
        return <SettingsPage />;
      default:
        return <DanmakuAnalysis onAnalysisComplete={handleAnalysisComplete} initialUrl={selectedVideo?.url} />;
    }
  };

  const handleTabChange = (tab: string) => {
    const t = tab as ActiveTab;
    setActiveTab(t);
    if (t !== 'danmaku') {
      setAnalysisData(null);
      setSelectedVideo(null);
      setOriginTab(null);
    }
  };

  return (
    <SidebarLayout activeTab={activeTab} onTabChange={handleTabChange}>
      {renderContent()}
    </SidebarLayout>
  );
}
