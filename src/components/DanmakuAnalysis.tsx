import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2 } from 'lucide-react';

interface DanmakuAnalysisProps {
  onAnalysisComplete: (data: any) => void;
  initialUrl?: string;
}

export default function DanmakuAnalysis({ onAnalysisComplete, initialUrl }: DanmakuAnalysisProps) {
  const [url, setUrl] = useState(initialUrl || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleAnalyze = async () => {
    if (!url.trim()) {
      setError('请输入直播回放URL');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await apiFetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: url.trim() }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: '未知错误' }));
        throw new Error(errorData.error || '分析失败，请检查URL是否正确');
      }

      const data = await response.json();
      onAnalysisComplete(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '分析过程中出现错误');
    } finally {
      setLoading(false);
    }
  };

  // 若传入初始链接，则自动触发一次分析
  // 防抖：避免重复触发
  useEffect(() => {
    if (initialUrl && !loading) {
      setTimeout(() => {
        handleAnalyze();
      }, 300);
    }
  }, [initialUrl]);

  return (
    <div className="max-w-2xl mx-auto p-6">
      <Card className="bg-white dark:bg-gray-800">
        <CardHeader>
          <CardTitle className="text-2xl text-gray-800 dark:text-white">
            直播回放弹幕分析
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="url" className="text-gray-700 dark:text-gray-300">
              直播回放URL
            </Label>
            <Input
              id="url"
              type="url"
              placeholder="请输入B站直播回放URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600"
              disabled={loading}
            />
          </div>

          {error && (
            <Alert className="border-red-200 bg-red-50">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button
            onClick={handleAnalyze}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                分析中...
              </>
            ) : (
              '开始分析'
            )}
          </Button>

          <div className="text-sm text-gray-500 dark:text-gray-400 space-y-1">
            <p>• 支持B站直播回放URL格式</p>
            <p>• 自动提取弹幕数据并进行分析</p>
            <p>• 生成可视化图表和统计报告</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}