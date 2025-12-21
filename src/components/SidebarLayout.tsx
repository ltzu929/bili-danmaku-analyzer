import { useState, useEffect } from 'react';
import { 
  BarChart3, 
  User, 
  Settings, 
  Moon, 
  Sun,
  ChevronLeft
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SidebarLayoutProps {
  children: React.ReactNode;
  activeTab: string;
  onTabChange: (tab: string) => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const navItems: NavItem[] = [
  { id: 'danmaku', label: '弹幕分析', icon: BarChart3 },
  { id: 'up-videos', label: 'UP主合集', icon: User },
];

export default function SidebarLayout({ children, activeTab, onTabChange }: SidebarLayoutProps) {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // 键盘快捷键支持
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ctrl/Cmd + B 切换侧边栏
      if ((event.ctrlKey || event.metaKey) && event.key === 'b') {
        event.preventDefault();
        setSidebarOpen(prev => !prev);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
    if (isDarkMode) {
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
    }
  };

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      {/* 侧边栏 */}
      <div className={cn(
        "flex flex-col bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm transition-all duration-300 ease-in-out",
        "border-r border-gray-200 dark:border-gray-700",
        sidebarOpen ? "w-64" : "w-12"
      )}>
        {/* 折叠控制区域 - 集成在侧边栏内部顶部 */}
        <div className={cn(
          "border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-gray-50 to-white dark:from-gray-800 dark:to-gray-800/90",
          sidebarOpen ? "p-4" : "p-1.5" // 折叠时更紧凑的内边距
        )}>
          <div className="flex items-center justify-between">
            {sidebarOpen && (
              <h1 className="text-lg font-semibold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                弹幕分析工具
              </h1>
            )}
            <button
              onClick={toggleSidebar}
              className={cn(
                "rounded-lg transition-all duration-200 ease-in-out",
                "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200",
                "hover:bg-white/50 dark:hover:bg-gray-700/50",
                "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-transparent",
                sidebarOpen ? "p-2" : "p-1 mx-auto" // 折叠时更紧凑的按钮内边距
              )}
              title={sidebarOpen ? "折叠侧边栏 (Ctrl+B)" : "展开侧边栏 (Ctrl+B)"}
            >
              <ChevronLeft className={cn(
                "transition-transform duration-300 ease-in-out",
                sidebarOpen ? "w-5 h-5" : "w-3.5 h-3.5", // 折叠时更小的图标
                !sidebarOpen && "rotate-180"
              )} />
            </button>
          </div>
        </div>

        {/* 导航菜单 - 横向紧凑，纵向舒适 */}
        <nav className={cn(
          "flex-1",
          sidebarOpen ? "px-3 py-3" : "px-1 py-2" // 折叠时增加垂直内边距
        )}>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={cn(
                  "relative w-full flex items-center justify-center rounded-lg transition-all duration-200 group",
                  "hover:bg-gray-100 dark:hover:bg-gray-700",
                  activeTab === item.id 
                    ? "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-300" 
                    : "text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-white",
                  sidebarOpen ? "px-3 py-3 mb-1" : "p-2 mb-1.5" // 折叠时增加按钮内边距和间距
                )}
              >
                <Icon className={cn(
                  "flex-shrink-0 transition-all duration-200",
                  sidebarOpen ? "w-5 h-5" : "w-4 h-4" // 折叠时小图标
                )} />
                <span className={cn(
                  "ml-3 transition-all duration-300 overflow-hidden text-sm font-medium",
                  sidebarOpen ? "opacity-100 w-auto" : "opacity-0 w-0 absolute"
                )}>
                  {item.label}
                </span>
                
                {/* 当侧边栏折叠时显示悬浮标签 */}
                {!sidebarOpen && (
                  <span className={cn(
                    "absolute left-full ml-2 px-2 py-1 text-xs bg-gray-800 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-50",
                    "dark:bg-gray-700 pointer-events-none"
                  )}>
                    {item.label}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* 底部设置 - 横向紧凑，纵向舒适 */}
        <div className={cn(
          "border-t border-gray-200 dark:border-gray-700",
          sidebarOpen ? "p-3" : "p-1.5" // 折叠时增加内边距
        )}>
          <div className={cn(
            "space-y-1",
            sidebarOpen ? "" : "space-y-1.5" // 折叠时增加间距
          )}>
            <button
              onClick={toggleTheme}
              className={cn(
                "relative w-full flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-all duration-200 group",
                sidebarOpen ? "px-3 py-3" : "p-2" // 折叠时增加内边距
              )}
            >
              {isDarkMode ? 
                <Sun className={cn("flex-shrink-0 transition-all duration-200", sidebarOpen ? "w-5 h-5" : "w-4 h-4")} /> : 
                <Moon className={cn("flex-shrink-0 transition-all duration-200", sidebarOpen ? "w-5 h-5" : "w-4 h-4")} />
              }
              <span className={cn(
                "ml-3 transition-all duration-300 overflow-hidden text-sm font-medium",
                sidebarOpen ? "opacity-100 w-auto" : "opacity-0 w-0 absolute"
              )}>
                主题设置
              </span>
              {/* 当侧边栏折叠时显示悬浮标签 */}
              {!sidebarOpen && (
                <span className={cn(
                  "absolute left-full ml-2 px-2 py-1 text-xs bg-gray-800 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-50",
                  "dark:bg-gray-700 pointer-events-none"
                )}>
                  主题设置
                </span>
              )}
            </button>
            <button 
              className={cn(
                "relative w-full flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-all duration-200 group",
                sidebarOpen ? "px-3 py-3" : "p-2" // 折叠时增加内边距
              )}
              onClick={() => onTabChange('settings')}
            >
              <Settings className={cn("flex-shrink-0 transition-all duration-200", sidebarOpen ? "w-5 h-5" : "w-4 h-4")} />
              <span className={cn(
                "ml-3 transition-all duration-300 overflow-hidden text-sm font-medium",
                sidebarOpen ? "opacity-100 w-auto" : "opacity-0 w-0 absolute"
              )}>
                设置
              </span>
              {/* 当侧边栏折叠时显示悬浮标签 */}
              {!sidebarOpen && (
                <span className={cn(
                  "absolute left-full ml-2 px-2 py-1 text-xs bg-gray-800 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-50",
                  "dark:bg-gray-700 pointer-events-none"
                )}>
                  设置
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="flex-1 overflow-auto">
        {children}
      </div>
    </div>
  );
}
