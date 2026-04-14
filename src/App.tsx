import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Map, Users, ShieldAlert, User as UserIcon, MessageCircleHeart, Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from './AuthContext';
import { useTranslation } from 'react-i18next';
import MapScreen from './MapScreen';
import CommunityScreen from './CommunityScreen';
import ProfileScreen from './ProfileScreen';

function BottomNav() {
  const location = useLocation();
  const { t } = useTranslation();
  
  const navItems = [
    { path: '/', icon: Users, label: t('nav.home') },
    { path: '/map', icon: Map, label: t('nav.map') },
    { path: '/profile', icon: UserIcon, label: t('nav.profile') },
  ];

  return (
    <div className="bg-white/80 backdrop-blur-xl border-t border-gray-200/80 flex justify-around items-center p-2 pb-safe z-50">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = location.pathname === item.path;
        return (
          <Link 
            key={item.path} 
            to={item.path}
            className={`flex flex-col items-center p-2 rounded-xl transition-colors ${isActive ? 'text-[#007AFF]' : 'text-[#8E8E93] hover:text-[#007AFF]/70'}`}
          >
            <Icon size={24} className={isActive ? 'fill-[#007AFF]/10' : ''} strokeWidth={isActive ? 2.5 : 2} />
            <span className="text-[10px] font-medium mt-1">{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

function MainLayout() {
  const { user, loading, signIn, isSigningIn } = useAuth();
  const { t } = useTranslation();

  if (loading) {
    return <div className="h-screen flex items-center justify-center bg-[#F2F2F7]">Loading...</div>;
  }

  if (!user) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-[#F2F2F7] p-6 text-center">
        <ShieldAlert size={64} className="text-[#007AFF] mb-6" />
        <h1 className="text-3xl font-bold text-black mb-2">GoMap</h1>
        <p className="text-[#8E8E93] mb-8">Cộng đồng an toàn và bảo vệ lẫn nhau.</p>
        <button 
          onClick={signIn}
          disabled={isSigningIn}
          className="bg-white text-black px-6 py-3 rounded-[20px] font-semibold shadow-[0_2px_10px_rgba(0,0,0,0.04)] hover:bg-gray-50 flex items-center gap-3 transition-transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSigningIn ? (
            <Loader2 className="w-6 h-6 animate-spin text-[#007AFF]" />
          ) : (
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-6 h-6" />
          )}
          {isSigningIn ? 'Đang đăng nhập...' : 'Đăng nhập với Google'}
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#F2F2F7] overflow-hidden font-sans">
      <div className="flex-1 overflow-hidden relative">
        <Routes>
          <Route path="/" element={<CommunityScreen />} />
          <Route path="/map" element={<MapScreen />} />
          <Route path="/profile" element={<ProfileScreen />} />
        </Routes>
      </div>
      <BottomNav />
    </div>
  );
}

import { ErrorBoundary } from './components/ErrorBoundary';

export default function App() {
  React.useEffect(() => {
    const setAppHeight = () => {
      document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
    };
    window.addEventListener('resize', setAppHeight);
    setAppHeight();
    return () => window.removeEventListener('resize', setAppHeight);
  }, []);

  return (
    <ErrorBoundary>
      <AuthProvider>
        <Router>
          <MainLayout />
        </Router>
      </AuthProvider>
    </ErrorBoundary>
  );
}
