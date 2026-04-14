import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from './AuthContext';
import { LogOut, MapPin, MessageSquare, Edit2, Check, X, Camera, Image as ImageIcon, Loader2, Globe } from 'lucide-react';
import { collection, query, where, getDocs, doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import { useTranslation } from 'react-i18next';

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const { t, i18n } = useTranslation();
  const [postCount, setPostCount] = useState(0);
  const [placeCount, setPlaceCount] = useState(0);
  
  const [nickname, setNickname] = useState('');
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [tempNickname, setTempNickname] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const [customAvatar, setCustomAvatar] = useState('');
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const presetAvatars = [
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Felix&backgroundColor=b6e3f4',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Aneka&backgroundColor=c0aede',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Molly&backgroundColor=ffdfbf',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Oliver&backgroundColor=d1d4f9',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Jasper&backgroundColor=b6e3f4',
    'https://api.dicebear.com/7.x/avataaars/svg?seed=Mia&backgroundColor=ffdfbf',
  ];

  useEffect(() => {
    if (!user) return;
    const fetchUserData = async () => {
      try {
        // Fetch stats
        const postsQ = query(collection(db, 'posts'), where('authorId', '==', user.uid));
        const placesQ = query(collection(db, 'safe_places'), where('addedBy', '==', user.uid));
        
        const [postsSnap, placesSnap] = await Promise.all([
          getDocs(postsQ),
          getDocs(placesQ)
        ]);
        
        setPostCount(postsSnap.size);
        setPlaceCount(placesSnap.size);

        // Fetch user profile for nickname and avatar
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          if (userDoc.data().nickname) setNickname(userDoc.data().nickname);
          if (userDoc.data().customAvatar) setCustomAvatar(userDoc.data().customAvatar);
        }
      } catch (error) {
        console.error("Error fetching user data:", error);
      }
    };
    fetchUserData();
  }, [user]);

  const handleSaveNickname = async () => {
    if (!user) return;
    setIsSaving(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        nickname: tempNickname.trim()
      });
      setNickname(tempNickname.trim());
      setIsEditingNickname(false);
    } catch (error) {
      console.error("Error saving nickname:", error);
      alert("Có lỗi xảy ra khi lưu biệt danh.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAvatar = async (avatarUrl: string) => {
    if (!user) return;
    setIsSaving(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        customAvatar: avatarUrl
      });
      setCustomAvatar(avatarUrl);
      setShowAvatarModal(false);
    } catch (error) {
      console.error("Error saving avatar:", error);
      alert("Có lỗi xảy ra khi lưu ảnh đại diện.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 400;
        const MAX_HEIGHT = 400;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
        } else {
          if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        const base64 = canvas.toDataURL('image/jpeg', 0.8);
        handleSaveAvatar(base64);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const startEditing = () => {
    setTempNickname(nickname || user?.displayName || '');
    setIsEditingNickname(true);
  };

  const toggleLanguage = () => {
    const newLang = i18n.language === 'en' ? 'vi' : 'en';
    i18n.changeLanguage(newLang);
  };

  if (!user) return null;

  return (
    <div className="flex flex-col h-full bg-[#F2F2F7] relative">
      <div className="p-4 bg-white/80 backdrop-blur-xl border-b border-gray-200/80 z-10 sticky top-0 flex justify-between items-center">
        <div className="w-8"></div>
        <h1 className="text-[17px] font-semibold text-black text-center">{t('profile.title')}</h1>
        <button onClick={toggleLanguage} className="w-8 h-8 flex items-center justify-center text-[#007AFF] bg-[#007AFF]/10 rounded-full">
          <Globe size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="bg-white rounded-[20px] p-6 shadow-[0_2px_10px_rgba(0,0,0,0.04)] border-0 flex flex-col items-center">
          <div className="relative mb-4">
            <img 
              src={customAvatar || user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`} 
              alt="Avatar" 
              className="w-24 h-24 rounded-full border border-gray-200 object-cover bg-white"
            />
            <button 
              onClick={() => setShowAvatarModal(true)}
              className="absolute bottom-0 right-0 bg-[#007AFF] text-white p-1.5 rounded-full border-2 border-white hover:bg-[#007AFF]/90 transition-colors shadow-sm"
            >
              <Camera size={14} />
            </button>
          </div>
          
          {isEditingNickname ? (
            <div className="flex items-center gap-2 mb-1">
              <input 
                type="text" 
                value={tempNickname}
                onChange={(e) => setTempNickname(e.target.value)}
                className="border-b-2 border-[#007AFF] outline-none text-center text-xl font-bold text-black w-48 bg-transparent"
                placeholder="Nhập biệt danh..."
                autoFocus
              />
              <button onClick={handleSaveNickname} disabled={isSaving} className="p-1 text-[#34C759] hover:bg-[#34C759]/10 rounded-full">
                <Check size={20} />
              </button>
              <button onClick={() => setIsEditingNickname(false)} disabled={isSaving} className="p-1 text-[#FF3B30] hover:bg-[#FF3B30]/10 rounded-full">
                <X size={20} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-[22px] font-bold text-black">{nickname || user.displayName}</h2>
              <button onClick={startEditing} className="p-1 text-[#8E8E93] hover:text-[#007AFF] transition-colors">
                <Edit2 size={16} />
              </button>
            </div>
          )}
          
          <p className="text-[15px] text-[#8E8E93] mt-1">{user.email}</p>
          {nickname && <p className="text-xs text-[#007AFF] mt-2 bg-[#007AFF]/10 px-3 py-1 rounded-full font-medium">Tên thật: {user.displayName}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white p-4 rounded-[20px] shadow-[0_2px_10px_rgba(0,0,0,0.04)] border-0 flex flex-col items-center">
            <div className="w-12 h-12 bg-[#007AFF]/10 text-[#007AFF] rounded-full flex items-center justify-center mb-2">
              <MapPin size={24} />
            </div>
            <span className="text-[22px] font-bold text-black">{placeCount}</span>
            <span className="text-[13px] text-[#8E8E93]">{t('profile.stats.saved')}</span>
          </div>
          <div className="bg-white p-4 rounded-[20px] shadow-[0_2px_10px_rgba(0,0,0,0.04)] border-0 flex flex-col items-center">
            <div className="w-12 h-12 bg-[#007AFF]/10 text-[#007AFF] rounded-full flex items-center justify-center mb-2">
              <MessageSquare size={24} />
            </div>
            <span className="text-[22px] font-bold text-black">{postCount}</span>
            <span className="text-[13px] text-[#8E8E93]">{t('profile.stats.posts')}</span>
          </div>
        </div>

        <button 
          onClick={signOut}
          className="w-full bg-white text-[#FF3B30] mt-4 py-4 rounded-[20px] shadow-[0_2px_10px_rgba(0,0,0,0.04)] font-semibold text-[17px] flex items-center justify-center gap-2 transition-colors active:bg-gray-50"
        >
          <LogOut size={20} />
          {t('profile.logout')}
        </button>
      </div>

      {/* Avatar Modal */}
      {showAvatarModal && (
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-[24px] w-full max-w-sm flex flex-col shadow-2xl overflow-hidden relative">
            <div className="flex justify-between items-center p-4 border-b border-gray-100">
              <h2 className="text-[17px] font-semibold text-black">Đổi ảnh đại diện</h2>
              <button onClick={() => setShowAvatarModal(false)} className="p-1.5 text-[#8E8E93] hover:text-black bg-gray-100 rounded-full">
                <X size={20} />
              </button>
            </div>
            
            <div className="p-5 space-y-6">
              <div>
                <p className="text-[15px] font-semibold text-black mb-3">Tải ảnh lên</p>
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-4 border-2 border-dashed border-gray-300 rounded-xl flex items-center justify-center gap-2 text-[#8E8E93] hover:bg-gray-50 hover:border-[#007AFF] hover:text-[#007AFF] transition-colors"
                >
                  <ImageIcon size={20} />
                  <span className="font-medium text-[15px]">Chọn ảnh từ thiết bị</span>
                </button>
                <input 
                  type="file" 
                  accept="image/*" 
                  className="hidden" 
                  ref={fileInputRef} 
                  onChange={handleImageUpload} 
                />
              </div>

              <div>
                <p className="text-[15px] font-semibold text-black mb-3">Hoặc chọn ảnh có sẵn</p>
                <div className="grid grid-cols-3 gap-3">
                  {presetAvatars.map((url, idx) => (
                    <button 
                      key={idx}
                      onClick={() => handleSaveAvatar(url)}
                      className="aspect-square rounded-xl border border-gray-200 overflow-hidden hover:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/30 transition-all bg-gray-50"
                    >
                      <img src={url} alt={`Preset ${idx}`} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
            
            {isSaving && (
              <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-10">
                <Loader2 size={32} className="animate-spin text-[#007AFF]" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
