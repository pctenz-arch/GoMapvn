import React, { useState, useEffect, useRef } from 'react';
import { collection, onSnapshot, addDoc, serverTimestamp, query, orderBy, doc, getDoc, updateDoc, arrayUnion, arrayRemove, deleteDoc, where } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './AuthContext';
import { Send, Loader2, X, MessageCircle, MapPin, Plus, Users, ChevronLeft, Image as ImageIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { handleFirestoreError, OperationType } from './lib/firestoreErrorHandler';

interface ChatGroup {
  id: string;
  name: string;
  description: string;
  lat: number;
  lng: number;
  createdBy: string;
  createdAt: any;
  members: string[];
  isPublic: boolean;
}

interface GroupMessage {
  id: string;
  authorId: string;
  authorName: string;
  authorPhoto: string;
  text: string;
  imageUrl?: string;
  createdAt: any;
}

// Haversine distance in km
function getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); 
  const d = R * c; 
  return d;
}

export default function CommunityScreen() {
  const { user } = useAuth();
  const { t } = useTranslation();
  
  const [activeTab, setActiveTab] = useState<'my_groups' | 'discover' | 'feed'>('my_groups');
  const [groups, setGroups] = useState<ChatGroup[]>([]);
  const [myGroups, setMyGroups] = useState<ChatGroup[]>([]);
  const [discoverGroups, setDiscoverGroups] = useState<ChatGroup[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  
  const [selectedGroup, setSelectedGroup] = useState<ChatGroup | null>(null);
  const [selectedPost, setSelectedPost] = useState<any | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [postComments, setPostComments] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [newPostContent, setNewPostContent] = useState('');
  const [image, setImage] = useState<string | null>(null);
  
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [isCreatingPost, setIsCreatingPost] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  
  const [userNickname, setUserNickname] = useState('');
  const [userAvatar, setUserAvatar] = useState('');
  const [loading, setLoading] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserLocation([pos.coords.latitude, pos.coords.longitude]),
        (err) => console.error(err),
        { enableHighAccuracy: true }
      );
    }
  }, []);

  useEffect(() => {
    if (user) {
      getDoc(doc(db, 'users', user.uid)).then(docSnap => {
        if (docSnap.exists()) {
          if (docSnap.data().nickname) setUserNickname(docSnap.data().nickname);
          if (docSnap.data().customAvatar) setUserAvatar(docSnap.data().customAvatar);
        }
      });
    }
  }, [user]);

  useEffect(() => {
    const qGroups = query(collection(db, 'chat_groups'), orderBy('createdAt', 'desc'));
    const unsubGroups = onSnapshot(qGroups, (snapshot) => {
      const groupsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ChatGroup));
      setGroups(groupsData);
    });

    const qPosts = query(collection(db, 'posts'), orderBy('createdAt', 'desc'));
    const unsubPosts = onSnapshot(qPosts, (snapshot) => {
      const postsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPosts(postsData);
    });

    return () => {
      unsubGroups();
      unsubPosts();
    };
  }, []);

  useEffect(() => {
    if (selectedPost) {
      const q = query(collection(db, 'posts', selectedPost.id, 'comments'), orderBy('createdAt', 'asc'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const commentsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setPostComments(commentsData);
      });
      return () => unsubscribe();
    }
  }, [selectedPost]);

  useEffect(() => {
    if (!user) return;
    const mine = groups.filter(g => g.members?.includes(user.uid) || g.createdBy === user.uid);
    setMyGroups(mine);
    
    if (userLocation) {
      const others = groups.filter(g => !g.members?.includes(user.uid) && g.createdBy !== user.uid);
      const withDistance = others.map(g => ({
        ...g,
        distance: getDistanceFromLatLonInKm(userLocation[0], userLocation[1], g.lat, g.lng)
      })).sort((a, b) => a.distance - b.distance);
      setDiscoverGroups(withDistance);
    } else {
      setDiscoverGroups(groups.filter(g => !g.members?.includes(user.uid) && g.createdBy !== user.uid));
    }
  }, [groups, user, userLocation]);

  useEffect(() => {
    if (selectedGroup) {
      const q = query(
        collection(db, 'chat_groups', selectedGroup.id, 'messages'),
        orderBy('createdAt', 'asc')
      );
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as GroupMessage));
        setMessages(msgs);
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      });
      return () => unsubscribe();
    }
  }, [selectedGroup]);

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newGroupName.trim() || !userLocation) {
      alert("Vui lòng bật vị trí để tạo nhóm chat khu vực.");
      return;
    }
    setLoading(true);
    try {
      const docRef = await addDoc(collection(db, 'chat_groups'), {
        name: newGroupName.trim(),
        description: newGroupDesc.trim(),
        lat: userLocation[0],
        lng: userLocation[1],
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        members: [user.uid],
        isPublic: true
      });
      setNewGroupName('');
      setNewGroupDesc('');
      setIsCreatingGroup(false);
      // Auto select
      const newGroup = { id: docRef.id, name: newGroupName.trim(), description: newGroupDesc.trim(), lat: userLocation[0], lng: userLocation[1], createdBy: user.uid, members: [user.uid], isPublic: true, createdAt: new Date() };
      setSelectedGroup(newGroup as any);
    } catch (error) {
      console.error("Error creating group", error);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinGroup = async (group: ChatGroup) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'chat_groups', group.id), {
        members: arrayUnion(user.uid)
      });
      setSelectedGroup(group);
    } catch (error) {
      console.error("Error joining group", error);
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
        const MAX_WIDTH = 800;
        const MAX_HEIGHT = 800;
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
        setImage(canvas.toDataURL('image/jpeg', 0.6));
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || (!newPostContent.trim() && !image)) return;
    setLoading(true);
    try {
      await addDoc(collection(db, 'posts'), {
        authorId: user.uid,
        authorName: userNickname || user.displayName || 'Anonymous',
        authorPhoto: userAvatar || user.photoURL || '',
        content: newPostContent.trim(),
        imageUrl: image || '',
        createdAt: serverTimestamp()
      });
      setNewPostContent('');
      setImage(null);
      setIsCreatingPost(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'posts');
    } finally {
      setLoading(false);
    }
  };

  const handleAddPostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedPost || !newMessage.trim()) return;
    const text = newMessage.trim();
    setNewMessage('');
    try {
      await addDoc(collection(db, 'posts', selectedPost.id, 'comments'), {
        authorId: user.uid,
        authorName: userNickname || user.displayName || 'Anonymous',
        authorPhoto: userAvatar || user.photoURL || '',
        text,
        createdAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `posts/${selectedPost.id}/comments`);
    }
  };
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedGroup || (!newMessage.trim() && !image)) return;
    
    const msgText = newMessage.trim();
    const msgImage = image;
    setNewMessage('');
    setImage(null);
    
    try {
      await addDoc(collection(db, 'chat_groups', selectedGroup.id, 'messages'), {
        authorId: user.uid,
        authorName: userNickname || user.displayName || 'Anonymous',
        authorPhoto: userAvatar || user.photoURL || '',
        text: msgText,
        imageUrl: msgImage || '',
        createdAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `chat_groups/${selectedGroup.id}/messages`);
    }
  };

  if (selectedGroup) {
    return (
      <div className="flex flex-col h-full bg-[#F2F2F7] relative">
        <div className="p-4 bg-white/90 backdrop-blur-xl border-b border-gray-200/80 z-10 sticky top-0 flex items-center justify-between">
          <button onClick={() => { setSelectedGroup(null); setImage(null); }} className="p-2 -ml-2 text-[#007AFF] hover:bg-gray-100 rounded-full">
            <ChevronLeft size={24} />
          </button>
          <div className="flex-1 text-center">
            <h1 className="text-[17px] font-bold text-black leading-tight">{selectedGroup.name}</h1>
            <p className="text-[12px] text-gray-500">{selectedGroup.members?.length || 1} thành viên</p>
          </div>
          <div className="w-10"></div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg, idx) => {
            const isMe = msg.authorId === user?.uid;
            return (
              <div key={msg.id || idx} className={`flex gap-2 max-w-[85%] ${isMe ? 'ml-auto flex-row-reverse' : ''}`}>
                {!isMe && (
                  <img 
                    src={msg.authorPhoto || `https://ui-avatars.com/api/?name=${msg.authorName}`} 
                    alt={msg.authorName} 
                    className="w-8 h-8 rounded-full object-cover mt-auto mb-1 flex-shrink-0"
                  />
                )}
                <div className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  {!isMe && <span className="text-[11px] text-gray-500 ml-1 mb-0.5">{msg.authorName}</span>}
                  <div className={`p-3 px-4 rounded-2xl ${isMe ? 'bg-[#007AFF] text-white rounded-br-sm' : 'bg-white border border-gray-200 text-black rounded-bl-sm'}`}>
                    {msg.imageUrl && (
                      <img src={msg.imageUrl} alt="Attached" className="max-w-full h-auto rounded-xl mb-2 object-cover" />
                    )}
                    {msg.text && <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{msg.text}</p>}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-3 bg-white/90 backdrop-blur-xl border-t border-gray-200/80 pb-safe">
          {image && (
            <div className="mb-3 relative inline-block">
              <img src={image} alt="Preview" className="h-20 rounded-xl object-cover border border-gray-200" />
              <button onClick={() => setImage(null)} className="absolute -top-2 -right-2 bg-gray-800 text-white p-1 rounded-full hover:bg-gray-900 shadow-md">
                <X size={14} />
              </button>
            </div>
          )}
          <form onSubmit={handleSendMessage} className="flex gap-2 items-end">
            <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleImageUpload} />
            <button type="button" onClick={() => fileInputRef.current?.click()} className="p-2 text-[#8E8E93] hover:text-[#007AFF] rounded-full transition-colors mb-1">
              <ImageIcon size={24} />
            </button>
            <textarea
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(e); } }}
              placeholder="Nhắn tin..."
              className="flex-1 max-h-32 min-h-[40px] py-2.5 px-4 bg-[#F2F2F7] border-none rounded-3xl focus:ring-2 focus:ring-[#007AFF]/20 outline-none transition-all resize-none text-[15px]"
              rows={1}
            />
            <button type="submit" disabled={!newMessage.trim() && !image} className="w-10 h-10 bg-[#007AFF] text-white rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-50 hover:bg-[#007AFF]/80 transition-colors mb-0.5">
              <Send size={18} className="ml-0.5" />
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#F2F2F7] relative">
      <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleImageUpload} />
      <div className="p-4 bg-white/90 backdrop-blur-xl border-b border-gray-200/80 z-10 sticky top-0">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-[22px] font-bold text-black">Cộng đồng</h1>
          <button onClick={() => setIsCreatingGroup(true)} className="bg-[#007AFF]/10 text-[#007AFF] p-2 rounded-full hover:bg-[#007AFF]/20 transition-colors">
            <Plus size={20} />
          </button>
        </div>
        <div className="flex gap-2 bg-gray-100 p-1 rounded-xl">
          <button 
            onClick={() => setActiveTab('my_groups')}
            className={`flex-1 py-1.5 text-sm font-semibold rounded-lg transition-all ${activeTab === 'my_groups' ? 'bg-white text-black shadow-sm' : 'text-gray-500'}`}
          >
            Kênh của tôi
          </button>
          <button 
            onClick={() => setActiveTab('discover')}
            className={`flex-1 py-1.5 text-sm font-semibold rounded-lg transition-all ${activeTab === 'discover' ? 'bg-white text-black shadow-sm' : 'text-gray-500'}`}
          >
            Khám phá
          </button>
          <button 
            onClick={() => setActiveTab('feed')}
            className={`flex-1 py-1.5 text-sm font-semibold rounded-lg transition-all ${activeTab === 'feed' ? 'bg-white text-black shadow-sm' : 'text-gray-500'}`}
          >
            Bản tin
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 pb-20">
        {activeTab === 'feed' && (
          <div className="space-y-4">
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-3 cursor-pointer" onClick={() => setIsCreatingPost(true)}>
              <img src={userAvatar || user?.photoURL || ''} className="w-10 h-10 rounded-full object-cover bg-gray-100" />
              <div className="flex-1 bg-gray-50 px-4 py-2.5 rounded-full text-gray-500 text-sm">
                Bạn đang nghĩ gì?
              </div>
            </div>

            {posts.map(post => (
              <div key={post.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-4 flex items-center gap-3">
                  <img src={post.authorPhoto || `https://ui-avatars.com/api/?name=${post.authorName}`} className="w-10 h-10 rounded-full object-cover" />
                  <div>
                    <h3 className="font-bold text-black text-sm">{post.authorName}</h3>
                    <p className="text-[10px] text-gray-400">{post.createdAt?.toDate?.().toLocaleString('vi-VN') || 'Vừa xong'}</p>
                  </div>
                </div>
                <div className="px-4 pb-3">
                  <p className="text-[15px] text-gray-800 whitespace-pre-wrap">{post.content}</p>
                  {post.imageUrl && <img src={post.imageUrl} className="mt-3 rounded-xl w-full object-cover max-h-64" />}
                </div>
                <div className="px-4 py-3 border-t border-gray-50 flex items-center gap-4">
                  <button onClick={() => setSelectedPost(post)} className="flex items-center gap-2 text-gray-500 text-sm hover:text-[#007AFF]">
                    <MessageCircle size={18} />
                    <span>{post.commentCount || 0} bình luận</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {activeTab === 'my_groups' && (
          <>
            <div className="mb-4">
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-2 ml-1">Kênh cố định</h2>
              <div 
                onClick={() => setSelectedGroup({ id: 'general', name: 'Kênh Chung', description: 'Nơi giao lưu của tất cả mọi người', lat: 0, lng: 0, createdBy: 'system', createdAt: new Date(), members: [], isPublic: true })} 
                className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4 cursor-pointer hover:bg-gray-50 transition-colors"
              >
                <div className="w-12 h-12 bg-gradient-to-br from-[#FF9500] to-[#FF3B30] rounded-full flex items-center justify-center text-white font-bold text-lg shrink-0">
                  <Users size={24} />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-black text-[16px]">Kênh Chung</h3>
                  <p className="text-sm text-gray-500 line-clamp-1">Nơi giao lưu của tất cả mọi người</p>
                </div>
              </div>
            </div>

            <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-2 ml-1 mt-6">Nhóm của bạn</h2>
            {myGroups.length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                <MessageCircle size={48} className="mx-auto mb-3 opacity-20" />
                <p>Bạn chưa tham gia nhóm nào.</p>
                <button onClick={() => setActiveTab('discover')} className="text-[#007AFF] font-medium mt-2">Khám phá các nhóm quanh đây</button>
              </div>
            ) : (
              myGroups.map(group => (
                <div key={group.id} onClick={() => setSelectedGroup(group)} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4 cursor-pointer hover:bg-gray-50 transition-colors">
                  <div className="w-12 h-12 bg-gradient-to-br from-[#007AFF] to-[#0056b3] rounded-full flex items-center justify-center text-white font-bold text-lg shrink-0">
                    {group.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-black text-[16px]">{group.name}</h3>
                    <p className="text-sm text-gray-500 line-clamp-1">{group.description || 'Không có mô tả'}</p>
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {activeTab === 'discover' && (
          <>
            {discoverGroups.length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                <MapPin size={48} className="mx-auto mb-3 opacity-20" />
                <p>Không tìm thấy nhóm nào quanh đây.</p>
                <button onClick={() => setIsCreatingGroup(true)} className="text-[#007AFF] font-medium mt-2">Tạo nhóm đầu tiên</button>
              </div>
            ) : (
              discoverGroups.map((group: any) => (
                <div key={group.id} className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-4">
                  <div className="w-12 h-12 bg-gradient-to-br from-[#34C759] to-[#248A3D] rounded-full flex items-center justify-center text-white font-bold text-lg shrink-0">
                    {group.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-black text-[16px]">{group.name}</h3>
                    <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                      <span className="flex items-center gap-1"><Users size={12}/> {group.members?.length || 1}</span>
                      {group.distance !== undefined && (
                        <>
                          <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
                          <span className="flex items-center gap-1"><MapPin size={12}/> {group.distance < 1 ? `${Math.round(group.distance * 1000)}m` : `${group.distance.toFixed(1)}km`}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <button onClick={() => handleJoinGroup(group)} className="bg-[#007AFF]/10 text-[#007AFF] px-4 py-2 rounded-full font-semibold text-sm hover:bg-[#007AFF]/20 transition-colors shrink-0">
                    Tham gia
                  </button>
                </div>
              ))
            )}
          </>
        )}
      </div>

      {isCreatingPost && (
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-[24px] p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-black">Tạo bài viết</h3>
              <button onClick={() => { setIsCreatingPost(false); setImage(null); }} className="text-[#8E8E93] hover:text-black bg-gray-100 rounded-full p-1.5">
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreatePost} className="space-y-4">
              <textarea 
                value={newPostContent}
                onChange={(e) => setNewPostContent(e.target.value)}
                placeholder="Bạn đang nghĩ gì?"
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#007AFF]/20 focus:border-[#007AFF] outline-none transition-all resize-none"
                rows={4}
              />
              {image && (
                <div className="relative inline-block">
                  <img src={image} alt="Preview" className="h-20 rounded-xl object-cover border border-gray-200" />
                  <button onClick={() => setImage(null)} className="absolute -top-2 -right-2 bg-gray-800 text-white p-1 rounded-full">
                    <X size={14} />
                  </button>
                </div>
              )}
              <div className="flex gap-2">
                <button type="button" onClick={() => fileInputRef.current?.click()} className="p-3 bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 transition-colors">
                  <ImageIcon size={20} />
                </button>
                <button 
                  type="submit"
                  disabled={loading || (!newPostContent.trim() && !image)}
                  className="flex-1 bg-[#007AFF] text-white py-3 rounded-xl font-bold disabled:opacity-50"
                >
                  {loading ? <Loader2 size={20} className="animate-spin mx-auto" /> : 'Đăng bài'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedPost && (
        <div className="absolute inset-0 bg-white z-[60] flex flex-col animate-in slide-in-from-bottom duration-300">
          <div className="p-4 bg-white border-b border-gray-100 flex items-center justify-between">
            <button onClick={() => setSelectedPost(null)} className="p-2 -ml-2 text-[#007AFF] hover:bg-gray-100 rounded-full">
              <ChevronLeft size={24} />
            </button>
            <h3 className="font-bold text-black">Bình luận</h3>
            <div className="w-10"></div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="pb-4 border-b border-gray-50">
              <div className="flex items-center gap-3 mb-2">
                <img src={selectedPost.authorPhoto} className="w-8 h-8 rounded-full object-cover" />
                <span className="font-bold text-sm">{selectedPost.authorName}</span>
              </div>
              <p className="text-[15px] text-gray-800">{selectedPost.content}</p>
              {selectedPost.imageUrl && <img src={selectedPost.imageUrl} className="mt-2 rounded-xl w-full object-cover max-h-48" />}
            </div>
            
            {postComments.map(comment => (
              <div key={comment.id} className="flex gap-3">
                <img src={comment.authorPhoto || `https://ui-avatars.com/api/?name=${comment.authorName}`} className="w-8 h-8 rounded-full object-cover shrink-0" />
                <div className="flex-1">
                  <div className="bg-gray-100 p-3 rounded-2xl rounded-tl-none">
                    <p className="font-bold text-[12px] text-black mb-0.5">{comment.authorName}</p>
                    <p className="text-[14px] text-gray-700">{comment.text}</p>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1 ml-1">{comment.createdAt?.toDate?.().toLocaleString('vi-VN') || 'Vừa xong'}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="p-3 bg-white border-t border-gray-100 pb-safe">
            <form onSubmit={handleAddPostComment} className="flex gap-2">
              <input 
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Viết bình luận..."
                className="flex-1 bg-gray-100 border-none rounded-full px-4 py-2.5 text-sm outline-none"
              />
              <button type="submit" disabled={!newMessage.trim()} className="w-10 h-10 bg-[#007AFF] text-white rounded-full flex items-center justify-center disabled:opacity-50">
                <Send size={18} />
              </button>
            </form>
          </div>
        </div>
      )}

      {isCreatingGroup && (
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-[24px] p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-black">Tạo nhóm khu vực</h3>
              <button onClick={() => setIsCreatingGroup(false)} className="text-[#8E8E93] hover:text-black bg-gray-100 rounded-full p-1.5">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">Nhóm sẽ được gắn với vị trí hiện tại của bạn để những người xung quanh có thể tìm thấy.</p>
            <form onSubmit={handleCreateGroup} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tên nhóm</label>
                <input 
                  type="text" 
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="VD: Hội chị em Quận 1"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#007AFF]/20 focus:border-[#007AFF] outline-none transition-all"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Mô tả</label>
                <textarea 
                  value={newGroupDesc}
                  onChange={(e) => setNewGroupDesc(e.target.value)}
                  placeholder="Nhóm này dành cho ai?"
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#007AFF]/20 focus:border-[#007AFF] outline-none transition-all resize-none"
                  rows={3}
                />
              </div>
              <button 
                type="submit"
                disabled={loading || !newGroupName.trim()}
                className="w-full bg-[#007AFF] hover:bg-[#007AFF]/90 text-white py-3.5 rounded-xl font-bold disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 size={20} className="animate-spin" /> : 'Tạo nhóm'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
