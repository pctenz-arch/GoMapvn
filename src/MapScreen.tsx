import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents, Circle, Polyline } from 'react-leaflet';
import { collection, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, deleteDoc, query, orderBy, where, getDoc, setDoc, limit, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './AuthContext';
import { 
  Plus, X, Star, Navigation, Image as ImageIcon, Loader2, Edit2, MapPin, Search, Check, 
  AlertTriangle, ShieldCheck, Trash2, Clock, Accessibility, Heart, VolumeX, MessageCircle, 
  Send, ChevronUp, ChevronDown, Download, WifiOff, ThumbsUp, ThumbsDown, CheckCircle, Shield,
  Bot, HeartHandshake, Paperclip, MessageSquarePlus, History, User
} from 'lucide-react';
import L from 'leaflet';
import { useTranslation } from 'react-i18next';
import { db as offlineDb } from './lib/db';
import { GoogleGenAI } from '@google/genai';

import { handleFirestoreError, OperationType } from './lib/firestoreErrorHandler';

// Initialize Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface Message {
  role: 'user' | 'model';
  text: string;
  imageUrl?: string;
}

interface ChatSession {
  id: string;
  title: string;
  updatedAt: any;
}

// Tile calculation helper
const lon2tile = (lon: number, zoom: number) => Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
const lat2tile = (lat: number, zoom: number) => Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));

function OfflineTileLayer() {
  const map = useMap();
  
  useEffect(() => {
    const CustomTileLayer = L.TileLayer.extend({
      createTile: function(coords: any, done: any) {
        const tile = document.createElement('img');
        const tileId = `${coords.z}/${coords.x}/${coords.y}`;
        
        offlineDb.tiles.get(tileId).then(cached => {
          if (cached) {
            tile.src = URL.createObjectURL(cached.data);
            done(null, tile);
          } else {
            tile.src = this.getTileUrl(coords);
            tile.onload = () => done(null, tile);
            tile.onerror = (err) => done(err, tile);
          }
        }).catch(() => {
          tile.src = this.getTileUrl(coords);
          tile.onload = () => done(null, tile);
          tile.onerror = (err) => done(err, tile);
        });
        return tile;
      }
    });

    const layer = new (CustomTileLayer as any)('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    });

    layer.addTo(map);
    return () => {
      map.removeLayer(layer);
    };
  }, [map]);

  return null;
}
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const userIcon = L.divIcon({
  className: 'custom-user-icon',
  html: `<div style="width: 16px; height: 16px; background-color: #3b82f6; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 0 2px rgba(59,130,246,0.5);"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8]
});

const LONG_XUYEN_BOUNDS: L.LatLngBoundsExpression = [
  [10.3100, 105.3800], // Southwest coordinates
  [10.4300, 105.4800]  // Northeast coordinates
];

interface SafePlace {
  id: string;
  name: string;
  description: string;
  category: string;
  lat: number;
  lng: number;
  addedBy: string;
  imageUrl?: string;
  rating?: number;
  wheelchairAccessible?: boolean;
  hasRamp?: boolean;
  lgbtqFriendly?: boolean;
  genderNeutralRestroom?: boolean;
  quietZone?: boolean;
  inclusivityRating?: number;
}

interface Comment {
  id: string;
  authorId: string;
  authorName: string;
  authorPhoto: string;
  text: string;
  createdAt: any;
}

interface DangerZone {
  id: string;
  name: string;
  description: string;
  lat: number;
  lng: number;
  radius: number;
  severity: 'low' | 'medium' | 'high';
  isTemporary?: boolean;
  expiresAt?: any;
  addedBy: string;
}

interface RouteSegment {
  id: string;
  positions: [number, number][];
  isDangerous: boolean;
  zones: DangerZone[];
}

function MapController({ center, zoom = 15, isNavigating = false }: { center: [number, number] | null, zoom?: number, isNavigating?: boolean }) {
  const map = useMap();
  const lastCenterRef = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (center) {
      const shouldMove = !lastCenterRef.current || 
        L.latLng(center).distanceTo(L.latLng(lastCenterRef.current)) > (isNavigating ? 5 : 0.0001);

      if (shouldMove) {
        if (isNavigating) {
          map.setView(center, zoom, { animate: true });
        } else {
          map.flyTo(center, zoom, { duration: 0.5 });
        }
        lastCenterRef.current = center;
      }
    }
  }, [center, map, zoom, isNavigating]);
  return null;
}

function MapEvents({ onMoveEnd, onMapClick }: { onMoveEnd: (center: [number, number]) => void, onMapClick: () => void }) {
  const map = useMapEvents({
    move: () => {
      const center = map.getCenter();
      onMoveEnd([center.lat, center.lng]);
    },
    moveend: () => {
      const center = map.getCenter();
      onMoveEnd([center.lat, center.lng]);
    },
    click: (e) => {
      // Only trigger if not clicking a marker (Leaflet handles marker clicks separately)
      if ((e.originalEvent.target as HTMLElement).classList.contains('leaflet-container')) {
        onMapClick();
      }
    }
  });
  return null;
}

export default function MapScreen() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [places, setPlaces] = useState<SafePlace[]>([]);
  const [dangerZones, setDangerZones] = useState<DangerZone[]>([]);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);
  
  const [isAddingMode, setIsAddingMode] = useState(false);
  const [isAddingDangerMode, setIsAddingDangerMode] = useState(false);
  const [draftLocation, setDraftLocation] = useState<[number, number] | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<[number, number] | null>(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [showDangerModal, setShowDangerModal] = useState(false);
  const [editingPlace, setEditingPlace] = useState<SafePlace | null>(null);
  const [newPlace, setNewPlace] = useState({ 
    name: '', description: '', category: 'cafe',
    wheelchairAccessible: false,
    hasRamp: false,
    lgbtqFriendly: false,
    genderNeutralRestroom: false,
    quietZone: false
  });
  const [newDanger, setNewDanger] = useState({ name: '', description: '', radius: 100, severity: 'medium' as const, isTemporary: true, duration: 24 });
  const [image, setImage] = useState<string | null>(null);
  const [rating, setRating] = useState<number>(5);
  const [inclusivityRating, setInclusivityRating] = useState<number>(5);
  const [loading, setLoading] = useState(false);

  const [routingTo, setRoutingTo] = useState<SafePlace | null>(null);
  const [routeSegments, setRouteSegments] = useState<RouteSegment[]>([]);
  const [dangerZonesOnRoute, setDangerZonesOnRoute] = useState<string[]>([]);
  const [routingMode, setRoutingMode] = useState<'driving' | 'walking'>('driving');
  const [routeDistance, setRouteDistance] = useState<number | null>(null);
  const [routeDuration, setRouteDuration] = useState<number | null>(null);
  const [isInsideDanger, setIsInsideDanger] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [activeDangerZone, setActiveDangerZone] = useState<DangerZone | null>(null);
  
  const [selectedPlace, setSelectedPlace] = useState<SafePlace | null>(null);
  const [selectedDangerZone, setSelectedDangerZone] = useState<DangerZone | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showAmenities, setShowAmenities] = useState(false);
  const [showReviews, setShowReviews] = useState(false);

  const [userNickname, setUserNickname] = useState('');
  const [userAvatar, setUserAvatar] = useState('');
  const [activeFilters, setActiveFilters] = useState<string[]>([]);

  // AI Chat State
  const [isAIChatOpen, setIsAIChatOpen] = useState(false);
  const [aiMessages, setAiMessages] = useState<Message[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiSelectedImage, setAiSelectedImage] = useState<string | null>(null);
  const [isAILoading, setIsAILoading] = useState(false);
  const [aiStreamingText, setAiStreamingText] = useState('');
  const [aiChats, setAiChats] = useState<ChatSession[]>([]);
  const [currentAIChatId, setCurrentAIChatId] = useState<string | null>(null);
  const [showAIHistory, setShowAIHistory] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const aiMessagesEndRef = useRef<HTMLDivElement>(null);
  const aiFileInputRef = useRef<HTMLInputElement>(null);
  const lastRecalculationRef = useRef<number>(0);
  const userLocationRef = useRef<[number, number] | null>(null);

  useEffect(() => {
    userLocationRef.current = userLocation;
  }, [userLocation]);

  const getMinDistanceToRoute = (userLoc: [number, number], segments: RouteSegment[]) => {
    let minDistance = Infinity;
    segments.forEach(segment => {
      segment.positions.forEach(pos => {
        const d = L.latLng(userLoc).distanceTo(L.latLng(pos));
        if (d < minDistance) minDistance = d;
      });
    });
    return minDistance;
  };

  const filteredPlaces = places.filter(place => {
    if (activeFilters.length === 0) return true;
    return activeFilters.every(filter => {
      if (filter === 'wheelchair') return place.wheelchairAccessible;
      if (filter === 'lgbtq') return place.lgbtqFriendly;
      if (filter === 'quiet') return place.quietZone;
      if (filter === 'ramp') return place.hasRamp;
      if (filter === 'gender_neutral') return place.genderNeutralRestroom;
      return true;
    });
  });

  const toggleFilter = (filter: string) => {
    setActiveFilters(prev => 
      prev.includes(filter) ? prev.filter(f => f !== filter) : [...prev, filter]
    );
  };

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
    if (selectedPlace) {
      const q = query(
        collection(db, 'safe_places', selectedPlace.id, 'comments'),
        orderBy('createdAt', 'desc')
      );
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const commentsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Comment));
        setComments(commentsData);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, `safe_places/${selectedPlace.id}/comments`);
      });
      return () => unsubscribe();
    } else if (selectedDangerZone) {
      const q = query(
        collection(db, 'danger_zones', selectedDangerZone.id, 'comments'),
        orderBy('createdAt', 'desc')
      );
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const commentsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Comment));
        setComments(commentsData);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, `danger_zones/${selectedDangerZone.id}/comments`);
      });
      return () => unsubscribe();
    } else {
      setComments([]);
      setShowComments(false);
    }
  }, [selectedPlace, selectedDangerZone]);

  useEffect(() => {
    if (isAIChatOpen) {
      aiMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [aiMessages, isAILoading, aiStreamingText, isAIChatOpen]);

  // Load AI chat list
  useEffect(() => {
    if (!user || !isAIChatOpen) return;
    
    const q = query(
      collection(db, 'users', user.uid, 'chats'),
      orderBy('updatedAt', 'desc')
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loadedChats: ChatSession[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as ChatSession));
      setAiChats(loadedChats);
      
      if (!currentAIChatId && loadedChats.length > 0) {
        setCurrentAIChatId(loadedChats[0].id);
      }
    });
    
    return () => unsubscribe();
  }, [user, isAIChatOpen]);

  // Load AI messages
  useEffect(() => {
    if (!user || !currentAIChatId || !isAIChatOpen) {
      if (isAIChatOpen) setAiMessages([{ role: 'model', text: t('chat.welcome_msg') }]);
      return;
    }
    
    const q = query(
      collection(db, 'users', user.uid, 'chats', currentAIChatId, 'messages'),
      orderBy('createdAt', 'asc')
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loadedMessages: Message[] = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          role: data.role,
          text: data.text,
          imageUrl: data.imageUrl
        };
      });
      
      const welcomeMsg: Message = { 
        role: 'model', 
        text: t('chat.welcome_msg')
      };
      
      setAiMessages([welcomeMsg, ...loadedMessages]);
    });
    
    return () => unsubscribe();
  }, [user, currentAIChatId, isAIChatOpen, t]);

  const startNewAIChat = async () => {
    if (!user) return;
    
    const newChatRef = doc(collection(db, 'users', user.uid, 'chats'));
    await setDoc(newChatRef, {
      title: t('chat.new_chat_title') || 'Cuộc trò chuyện mới',
      updatedAt: serverTimestamp()
    });
    setCurrentAIChatId(newChatRef.id);
    setShowAIHistory(false);
  };

  const handleAIImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 512;
        const MAX_HEIGHT = 512;
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
        setAiSelectedImage(canvas.toDataURL('image/jpeg', 0.5));
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
    if (aiFileInputRef.current) aiFileInputRef.current.value = '';
  };

  const handleAISend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((!aiInput.trim() && !aiSelectedImage) || isAILoading || !user) return;

    const userMsg = aiInput.trim();
    const currentImage = aiSelectedImage;
    
    setAiInput('');
    setAiSelectedImage(null);
    setIsAILoading(true);
    setAiStreamingText('');

    try {
      let chatId = currentAIChatId;
      
      if (!chatId) {
        const newChatRef = doc(collection(db, 'users', user.uid, 'chats'));
        await setDoc(newChatRef, {
          title: userMsg.substring(0, 30) + (userMsg.length > 30 ? '...' : ''),
          updatedAt: serverTimestamp()
        });
        chatId = newChatRef.id;
        setCurrentAIChatId(chatId);
      } else {
        await setDoc(doc(db, 'users', user.uid, 'chats', chatId), {
          updatedAt: serverTimestamp()
        }, { merge: true });
      }

      await addDoc(collection(db, 'users', user.uid, 'chats', chatId, 'messages'), {
        role: 'user',
        text: userMsg,
        imageUrl: currentImage || null,
        createdAt: serverTimestamp()
      });

      const contents = aiMessages.map(m => {
        const parts: any[] = [];
        if (m.text) parts.push({ text: m.text });
        if (m.imageUrl) {
          const base64Data = m.imageUrl.split(',')[1];
          const mimeType = m.imageUrl.split(';')[0].split(':')[1];
          parts.push({ inlineData: { data: base64Data, mimeType } });
        }
        return { role: m.role, parts };
      });

      const newUserParts: any[] = [];
      if (userMsg) newUserParts.push({ text: userMsg });
      if (currentImage) {
        const base64Data = currentImage.split(',')[1];
        const mimeType = currentImage.split(';')[0].split(':')[1];
        newUserParts.push({ inlineData: { data: base64Data, mimeType } });
      }
      if (newUserParts.length === 0) newUserParts.push({ text: "Hình ảnh đính kèm" });
      
      contents.push({ role: 'user', parts: newUserParts });

      const responseStream = await ai.models.generateContentStream({
        model: 'gemini-2.5-flash',
        contents: contents,
        config: {
          systemInstruction: "Bạn là trợ lý ảo của GoMap, một ứng dụng bảo vệ và hỗ trợ phụ nữ, cộng đồng LGBT, và người khuyết tật. Nhiệm vụ của bạn là tư vấn tâm lý, cung cấp các kỹ năng an toàn cá nhân, và lắng nghe người dùng. ĐẶC BIỆT LƯU Ý: Bạn có khả năng tự động phân tích và thấu hiểu cảm xúc của người dùng thông qua câu chữ và hình ảnh họ gửi (vui, buồn, hoảng loạn, lo âu, sợ hãi...). Hãy thể hiện sự thấu hiểu đó ngay trong câu trả lời của bạn. Ví dụ: Nếu họ hoảng loạn, hãy nói 'Tôi thấy bạn đang rất hoảng sợ, hãy bình tĩnh lại nhé...'. Nếu họ buồn, hãy nói 'Tôi hiểu bạn đang cảm thấy buồn...'. Hãy luôn trả lời một cách thấu cảm, tôn trọng, và đưa ra lời khuyên thiết thực, ngắn gọn. Nếu người dùng đang trong tình trạng khẩn cấp, hãy khuyên họ sử dụng nút SOS trong ứng dụng hoặc gọi cảnh sát/cấp cứu ngay lập tức."
        }
      });

      let fullResponse = '';
      for await (const chunk of responseStream) {
        if (chunk.text) {
          fullResponse += chunk.text;
          setAiStreamingText(fullResponse);
        }
      }

      if (fullResponse) {
        await addDoc(collection(db, 'users', user.uid, 'chats', chatId, 'messages'), {
          role: 'model',
          text: fullResponse,
          createdAt: serverTimestamp()
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'ai_chat');
      alert('Xin lỗi, hiện tại tôi đang gặp sự cố kết nối. Vui lòng thử lại sau một lát nhé.');
    } finally {
      setIsAILoading(false);
      setAiStreamingText('');
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || (!selectedPlace && !selectedDangerZone) || !newComment.trim()) return;

    setIsSubmittingComment(true);
    const collectionPath = selectedPlace 
      ? `safe_places/${selectedPlace.id}/comments`
      : `danger_zones/${selectedDangerZone!.id}/comments`;
      
    try {
      await addDoc(collection(db, collectionPath), {
        authorId: user.uid,
        authorName: userNickname || user.displayName || 'Anonymous',
        authorPhoto: userAvatar || user.photoURL || '',
        text: newComment.trim(),
        createdAt: serverTimestamp()
      });
      setNewComment('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, collectionPath);
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const formatDistance = (meters: number) => {
    if (!meters) return '0m';
    if (meters < 1000) return `${Math.round(meters)}m`;
    return `${(meters / 1000).toFixed(1)}km`;
  };

  const formatDuration = (seconds: number) => {
    if (!seconds) return '0p';
    if (seconds < 60) return `1 phút`;
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins} phút`;
    const hrs = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return `${hrs}h ${remainMins}p`;
  };

  const clearRouting = () => {
    setRoutingTo(null);
    setRouteSegments([]);
    setDangerZonesOnRoute([]);
    setRouteDistance(null);
    setRouteDuration(null);
    setIsNavigating(false);
  };

  const buildRouteSegments = (coords: [number, number][], allZones: DangerZone[]) => {
    const segments: RouteSegment[] = [];
    let currentSegment: RouteSegment | null = null;

    for (let i = 0; i < coords.length; i++) {
      const coord = coords[i];
      const activeZones = allZones.filter(z => {
        if (z.isTemporary && z.expiresAt && z.expiresAt.toDate() < new Date()) return false;
        return L.latLng(coord).distanceTo(L.latLng(z.lat, z.lng)) <= z.radius;
      });

      const isDangerous = activeZones.length > 0;

      if (!currentSegment) {
        currentSegment = { id: `seg-${i}`, positions: [coord], isDangerous, zones: activeZones };
      } else {
        const prevZonesStr = currentSegment.zones.map(z => z.id).sort().join(',');
        const currZonesStr = activeZones.map(z => z.id).sort().join(',');
        
        if (currentSegment.isDangerous === isDangerous && prevZonesStr === currZonesStr) {
          currentSegment.positions.push(coord);
        } else {
          segments.push(currentSegment);
          currentSegment = { id: `seg-${i}`, positions: [coords[i-1], coord], isDangerous, zones: activeZones };
        }
      }
    }
    if (currentSegment) {
      segments.push(currentSegment);
    }
    return segments;
  };

  const calculateSafeRoute = useCallback(async (target: SafePlace | null, mode: 'driving' | 'walking' = routingMode, startOverride?: [number, number]) => {
    if (!target) return;
    const start = startOverride || userLocationRef.current;
    if (!start) {
      if (!startOverride) alert("Không thể xác định vị trí của bạn.");
      return;
    }
    
    const end: [number, number] = [target.lat, target.lng];
    
    try {
      setLoading(true);

      const evaluateRoute = (coordinates: [number, number][]) => {
        const dangerousZonesOnRouteIds = new Set<string>();
        coordinates.forEach((coord: [number, number], index: number) => {
          if (index % 3 !== 0) return;
          dangerZones.forEach(zone => {
            if (zone.isTemporary && zone.expiresAt && zone.expiresAt.toDate() < new Date()) return;
            const dist = L.latLng(coord).distanceTo(L.latLng(zone.lat, zone.lng));
            if (dist <= zone.radius) {
              dangerousZonesOnRouteIds.add(zone.id);
            }
          });
        });
        return Array.from(dangerousZonesOnRouteIds);
      };

      // 1. Try direct routes with alternatives
      const res = await fetch(`https://router.project-osrm.org/route/v1/${mode}/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson&alternatives=3`);
      const data = await res.json();
      
      let bestRouteCoords: [number, number][] = [];
      let minDangerCount = Infinity;
      let bestDangerZones: string[] = [];
      let bestDistance = 0;
      let bestDuration = 0;

      if (data.code !== 'Ok') {
        console.error("OSRM Error:", data.code, data.message);
        alert(`Không thể tìm thấy đường đi: ${data.code === 'NoRoute' ? 'Không có đường đi khả dụng' : 'Lỗi hệ thống'}`);
        clearRouting();
        setMapCenter(end);
        setLoading(false);
        return;
      }

      if (data.routes.length > 0) {
        for (const route of data.routes) {
          const coordinates = route.geometry.coordinates.map((coord: [number, number]) => [coord[1], coord[0]]);
          const zones = evaluateRoute(coordinates);
          
          if (zones.length < minDangerCount || (zones.length === minDangerCount && route.distance < (bestDistance || Infinity))) {
            minDangerCount = zones.length;
            bestRouteCoords = coordinates;
            bestDangerZones = zones;
            bestDistance = route.distance;
            bestDuration = route.duration;
          }
          if (minDangerCount === 0) break;
        }
      }

      // 2. If still hitting danger zones, try forcing a detour around the first danger zone
      if (minDangerCount > 0 && bestDangerZones.length > 0) {
        const firstDangerZone = dangerZones.find(z => z.id === bestDangerZones[0]);
        if (firstDangerZone) {
          // Create 4 detour points (N, S, E, W) outside the danger zone
          const safeDistance = firstDangerZone.radius + 200; // 200m buffer
          const offsetLat = safeDistance / 111320;
          const offsetLng = safeDistance / (111320 * Math.cos(firstDangerZone.lat * Math.PI / 180));
          
          const detours = [
            [firstDangerZone.lat + offsetLat, firstDangerZone.lng], // North
            [firstDangerZone.lat - offsetLat, firstDangerZone.lng], // South
            [firstDangerZone.lat, firstDangerZone.lng + offsetLng], // East
            [firstDangerZone.lat, firstDangerZone.lng - offsetLng]  // West
          ];

          for (const detour of detours) {
            try {
              const detourRes = await fetch(`https://router.project-osrm.org/route/v1/${mode}/${start[1]},${start[0]};${detour[1]},${detour[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`);
              const detourData = await detourRes.json();
              
              if (detourData.code === 'Ok' && detourData.routes.length > 0) {
                const detourRoute = detourData.routes[0];
                const coordinates = detourRoute.geometry.coordinates.map((coord: [number, number]) => [coord[1], coord[0]]);
                const zones = evaluateRoute(coordinates);
                
                if (zones.length < minDangerCount || (zones.length === minDangerCount && detourRoute.distance < (bestDistance || Infinity))) {
                  minDangerCount = zones.length;
                  bestRouteCoords = coordinates;
                  bestDangerZones = zones;
                  bestDistance = detourRoute.distance;
                  bestDuration = detourRoute.duration;
                }
                if (minDangerCount === 0) break; // Found a perfectly safe route!
              }
            } catch (e) {
              console.error("Detour fetch error", e);
            }
          }
        }
      }

      if (bestRouteCoords.length > 0) {
        const segments = buildRouteSegments(bestRouteCoords, dangerZones);
        setRouteSegments(segments);
        setRoutingTo(target);
        setMapCenter(end);
        setDangerZonesOnRoute(bestDangerZones);
        setRouteDistance(bestDistance);
        setRouteDuration(bestDuration);
      } else {
        alert("Không thể tìm thấy đường đi thực tế. Vui lòng thử lại.");
        clearRouting();
        setMapCenter(end);
      }
    } catch (error) {
      console.error("Routing error:", error);
      alert("Lỗi khi tìm đường.");
      clearRouting();
      setMapCenter(end);
    } finally {
      setLoading(false);
    }
  }, [dangerZones, routingMode]);

  useEffect(() => {
    if (routingTo) {
      calculateSafeRoute(routingTo, routingMode);
    }
  }, [routingMode]);

  useEffect(() => {
    if (navigator.geolocation) {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const loc: [number, number] = [pos.coords.latitude, pos.coords.longitude];
          setUserLocation(loc);
          setMapCenter(prev => prev || loc);
          
          // Check if inside any danger zone
          let inside = false;
          let currentZone: DangerZone | null = null;
          dangerZones.forEach(zone => {
            const dist = L.latLng(loc).distanceTo(L.latLng(zone.lat, zone.lng));
            if (dist <= zone.radius) {
              inside = true;
              currentZone = zone;
            }
          });
          
          setIsInsideDanger(inside);
          setActiveDangerZone(currentZone);
          
          // Real-time route recalculation on deviation
          if (isNavigating && routingTo && routeSegments.length > 0) {
            const distToRoute = getMinDistanceToRoute(loc, routeSegments);
            const now = Date.now();
            // If user is more than 40m away from the planned route, recalculate
            if (distToRoute > 40 && now - lastRecalculationRef.current > 10000) {
              console.log("User deviated from route (dist:", distToRoute, "m). Recalculating...");
              lastRecalculationRef.current = now;
              calculateSafeRoute(routingTo, routingMode, loc);
            }
          }
        },
        (err) => console.error(err),
        { enableHighAccuracy: true }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, [dangerZones, isNavigating, routingTo, routeSegments, routingMode, calculateSafeRoute]);

  useEffect(() => {
    const unsubPlaces = onSnapshot(collection(db, 'safe_places'), (snapshot) => {
      const placesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SafePlace));
      setPlaces(placesData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'safe_places');
    });

    const unsubDanger = onSnapshot(collection(db, 'danger_zones'), (snapshot) => {
      const dangerData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as DangerZone));
      setDangerZones(dangerData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'danger_zones');
    });

    return () => {
      unsubPlaces();
      unsubDanger();
    };
  }, []);

  useEffect(() => {
    if (isNavigating && userLocation && !isAddingMode && !isAddingDangerMode) {
      setMapCenter([...userLocation]);
    }
  }, [userLocation, isNavigating, isAddingMode, isAddingDangerMode]);

  const handleDangerFeedback = async (zoneId: string, type: 'up' | 'down' | 'clear') => {
    if (!user) return;
    const zoneRef = doc(db, 'danger_zones', zoneId);
    
    try {
      const zoneSnap = await getDoc(zoneRef);
      if (!zoneSnap.exists()) return;
      
      const data = zoneSnap.data();
      const upvotes = data.upvotes || 0;
      const downvotes = data.downvotes || 0;
      const clearReports = data.clearReports || 0;

      if (type === 'up') {
        await updateDoc(zoneRef, { upvotes: upvotes + 1 });
      } else if (type === 'down') {
        await updateDoc(zoneRef, { downvotes: downvotes + 1 });
      } else if (type === 'clear') {
        const newClearCount = clearReports + 1;
        if (newClearCount >= 3) {
          // Auto-clear if 3 people report it's gone
          await deleteDoc(zoneRef);
          setSelectedDangerZone(null);
        } else {
          await updateDoc(zoneRef, { clearReports: newClearCount });
        }
      }
    } catch (error) {
      console.error("Error updating danger feedback", error);
    }
  };

  const startAddDangerMode = () => {
    setIsAddingDangerMode(true);
    setDraftLocation(mapCenter || userLocation || [10.3759, 105.4333]);
  };

  const confirmDangerLocation = () => {
    setSelectedLocation(draftLocation);
    setIsAddingDangerMode(false);
    setNewDanger({ name: '', description: '', radius: 100, severity: 'medium', isTemporary: true, duration: 24 });
    setShowDangerModal(true);
  };

  const handleSaveDanger = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedLocation) return;
    setLoading(true);

    try {
      const expiresAt = newDanger.isTemporary 
        ? new Date(Date.now() + newDanger.duration * 60 * 60 * 1000)
        : null;

      await addDoc(collection(db, 'danger_zones'), {
        name: newDanger.name,
        description: newDanger.description,
        radius: newDanger.radius,
        severity: newDanger.severity,
        isTemporary: newDanger.isTemporary,
        expiresAt: expiresAt,
        lat: selectedLocation[0],
        lng: selectedLocation[1],
        addedBy: user.uid,
        createdAt: serverTimestamp()
      });
      setShowDangerModal(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'danger_zones');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDanger = async (zoneId: string) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa báo cáo nguy hiểm này?')) return;
    try {
      await deleteDoc(doc(db, 'danger_zones', zoneId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `danger_zones/${zoneId}`);
    }
  };

  const handleDeletePlace = async (placeId: string) => {
    if (!window.confirm('Bạn có chắc chắn muốn xóa địa điểm này?')) return;
    try {
      await deleteDoc(doc(db, 'safe_places', placeId));
      setShowModal(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `safe_places/${placeId}`);
    }
  };

  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  const downloadTiles = async () => {
    const map = (window as any).leafletMap;
    if (!map) return;

    const bounds = map.getBounds();
    const zoomLevels = [13, 14, 15, 16];
    const tilesToDownload: {z: number, x: number, y: number}[] = [];

    zoomLevels.forEach(z => {
      const nw = bounds.getNorthWest();
      const se = bounds.getSouthEast();
      const xMin = lon2tile(nw.lng, z);
      const xMax = lon2tile(se.lng, z);
      const yMin = lat2tile(nw.lat, z);
      const yMax = lat2tile(se.lat, z);

      for (let x = xMin; x <= xMax; x++) {
        for (let y = yMin; y <= yMax; y++) {
          tilesToDownload.push({ z, x, y });
        }
      }
    });

    if (tilesToDownload.length > 500) {
      alert("Khu vực quá lớn! Vui lòng phóng to hơn để tải bản đồ ngoại tuyến.");
      return;
    }

    setIsDownloading(true);
    let downloaded = 0;

    for (const tile of tilesToDownload) {
      const tileId = `${tile.z}/${tile.x}/${tile.y}`;
      const url = `https://a.tile.openstreetmap.org/${tileId}.png`;
      
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        await offlineDb.tiles.put({
          id: tileId,
          data: blob,
          timestamp: Date.now()
        });
      } catch (e) {
        console.error("Download failed for tile", tileId, e);
      }
      
      downloaded++;
      setDownloadProgress(Math.round((downloaded / tilesToDownload.length) * 100));
    }

    setIsDownloading(false);
    setDownloadProgress(0);
    alert("Đã tải bản đồ ngoại tuyến cho khu vực này!");
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    
    setIsSearching(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&countrycodes=vn&limit=1`);
      const data = await res.json();
      if (data && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        setMapCenter([lat, lon]);
        if (isAddingMode) {
          setDraftLocation([lat, lon]);
        }
      } else {
        alert("Không tìm thấy địa chỉ này tại Việt Nam.");
      }
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setIsSearching(false);
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
        const MAX_WIDTH = 600;
        const MAX_HEIGHT = 600;
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
        setImage(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const startAddMode = () => {
    setIsAddingMode(true);
    setDraftLocation(mapCenter || userLocation || [10.3759, 105.4333]);
  };

  const confirmLocation = () => {
    setSelectedLocation(draftLocation);
    setIsAddingMode(false);
    
    setEditingPlace(null);
    setNewPlace({ 
      name: '', description: '', category: 'cafe',
      wheelchairAccessible: false,
      hasRamp: false,
      lgbtqFriendly: false,
      genderNeutralRestroom: false,
      quietZone: false
    });
    setImage(null);
    setRating(5);
    setInclusivityRating(5);
    setShowModal(true);
  };

  const openEditModal = (place: SafePlace) => {
    setEditingPlace(place);
    setSelectedLocation([place.lat, place.lng]);
    setNewPlace({ 
      name: place.name || '', 
      description: place.description || '', 
      category: place.category || 'cafe',
      wheelchairAccessible: place.wheelchairAccessible || false,
      hasRamp: place.hasRamp || false,
      lgbtqFriendly: place.lgbtqFriendly || false,
      genderNeutralRestroom: place.genderNeutralRestroom || false,
      quietZone: place.quietZone || false
    });
    setImage(place.imageUrl || null);
    setRating(place.rating || 5);
    setInclusivityRating(place.inclusivityRating || 5);
    setShowModal(true);
  };

  const handleSavePlace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedLocation) return;
    setLoading(true);

    try {
      if (editingPlace) {
        await updateDoc(doc(db, 'safe_places', editingPlace.id), {
          ...newPlace,
          lat: selectedLocation[0],
          lng: selectedLocation[1],
          imageUrl: image || '',
          rating: rating,
          inclusivityRating: inclusivityRating
        });
      } else {
        await addDoc(collection(db, 'safe_places'), {
          ...newPlace,
          lat: selectedLocation[0],
          lng: selectedLocation[1],
          addedBy: user.uid,
          imageUrl: image || '',
          rating: rating,
          inclusivityRating: inclusivityRating,
          createdAt: serverTimestamp()
        });
      }
      setShowModal(false);
    } catch (error) {
      handleFirestoreError(error, editingPlace ? OperationType.UPDATE : OperationType.CREATE, editingPlace ? `safe_places/${editingPlace.id}` : 'safe_places');
    } finally {
      setLoading(false);
    }
  };

  const locateUser = () => {
    if (userLocation) {
      setMapCenter([...userLocation]);
    }
  };

  return (
    <div className="relative h-full w-full flex flex-col">
      <div className="p-4 bg-white/80 backdrop-blur-xl border-b border-gray-200/80 z-10 flex flex-col gap-3">
        <div className="flex justify-between items-center">
          <h1 className="text-[17px] font-semibold text-black">GoMap</h1>
          <div className="flex gap-2">
            <button 
              onClick={downloadTiles}
              disabled={isDownloading}
              className={`p-2 rounded-full shadow-sm border border-gray-200 transition-all ${isDownloading ? 'bg-gray-100 text-gray-400' : 'bg-white/90 backdrop-blur-md text-[#34C759] hover:bg-gray-50'}`}
              title="Tải bản đồ ngoại tuyến"
            >
              {isDownloading ? (
                <div className="relative">
                  <Loader2 size={22} className="animate-spin" />
                  <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold">{downloadProgress}%</span>
                </div>
              ) : <Download size={22} />}
            </button>
            {!isAddingMode && !isAddingDangerMode && (
              <div className="flex gap-2">
                <button 
                  onClick={startAddDangerMode}
                  className="bg-[#FF3B30] text-white p-2 rounded-full shadow-sm hover:bg-[#FF3B30]/90 transition-colors"
                  title="Báo cáo vùng nguy hiểm"
                >
                  <AlertTriangle size={22} />
                </button>
                <button 
                  onClick={startAddMode}
                  className="bg-[#007AFF] text-white p-2 rounded-full shadow-sm hover:bg-[#007AFF]/90 transition-colors"
                  aria-label={t('map.add_place')}
                >
                  <Plus size={22} />
                </button>
              </div>
            )}
          </div>
        </div>
        
        {/* Search Bar */}
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <input 
              type="text" 
              placeholder={t('map.search_placeholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-[#767680]/12 border-transparent rounded-[10px] focus:bg-white focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/20 outline-none transition-all text-[15px] text-black placeholder-[#8E8E93]"
            />
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8E8E93]" />
          </div>
          <button 
            type="submit"
            disabled={isSearching || !searchQuery.trim()}
            className="bg-[#007AFF] text-white px-4 rounded-[10px] font-semibold text-[15px] disabled:opacity-50 transition-colors"
          >
            {isSearching ? <Loader2 size={18} className="animate-spin" /> : 'Tìm'}
          </button>
        </form>

        {/* Filter Bar */}
        <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          <button 
            onClick={() => toggleFilter('wheelchair')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold whitespace-nowrap transition-all border ${activeFilters.includes('wheelchair') ? 'bg-[#007AFF] text-white border-[#007AFF]' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
          >
            <Accessibility size={14} /> Xe lăn
          </button>
          <button 
            onClick={() => toggleFilter('lgbtq')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold whitespace-nowrap transition-all border ${activeFilters.includes('lgbtq') ? 'bg-[#FF2D55] text-white border-[#FF2D55]' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
          >
            <Heart size={14} /> LGBTQ+
          </button>
          <button 
            onClick={() => toggleFilter('quiet')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold whitespace-nowrap transition-all border ${activeFilters.includes('quiet') ? 'bg-[#34C759] text-white border-[#34C759]' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
          >
            <VolumeX size={14} /> Yên tĩnh
          </button>
          <button 
            onClick={() => toggleFilter('gender_neutral')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold whitespace-nowrap transition-all border ${activeFilters.includes('gender_neutral') ? 'bg-[#AF52DE] text-white border-[#AF52DE]' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
          >
            Nhà vệ sinh chung
          </button>
        </div>
      </div>

      <div className="flex-1 relative z-0">
        <MapContainer 
          center={[10.3759, 105.4333]} 
          zoom={13} 
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
          ref={(m) => { if (m) (window as any).leafletMap = m; }}
        >
          <OfflineTileLayer />
          <MapController center={mapCenter} zoom={isNavigating ? 17 : 15} isNavigating={isNavigating} />
          <MapEvents 
            onMoveEnd={(center) => {
              if (isAddingMode || isAddingDangerMode) setDraftLocation(center);
            }} 
            onMapClick={() => {
              if (!isAddingMode && !isAddingDangerMode) {
                setSelectedPlace(null);
                setSelectedDangerZone(null);
              }
            }}
          />
          
          {userLocation && (
            <Marker position={userLocation} icon={userIcon}>
              <Popup>Vị trí hiện tại của bạn</Popup>
            </Marker>
          )}

          {routeSegments.map((segment, idx) => (
            <Polyline 
              key={segment.id + idx}
              positions={segment.positions} 
              color={segment.isDangerous ? "#FF3B30" : "#007AFF"} 
              weight={segment.isDangerous ? 6 : 5} 
              opacity={segment.isDangerous ? 0.9 : 0.7}
              dashArray={segment.isDangerous ? '8, 8' : undefined}
            >
              {segment.isDangerous && (
                <Popup>
                  <div className="font-sans w-48">
                    <p className="font-bold text-[#FF3B30] flex items-center gap-1 mb-1 text-[13px]">
                      <AlertTriangle size={14} /> Đoạn đường nguy hiểm
                    </p>
                    <p className="text-[11px] text-gray-600 mb-2 leading-tight">Tuyến đường này đi xuyên qua:</p>
                    <ul className="text-[12px] font-semibold list-disc pl-4 text-black">
                      {segment.zones.map(z => (
                        <li key={z.id}>{z.name || 'Khu vực không tên'}</li>
                      ))}
                    </ul>
                  </div>
                </Popup>
              )}
            </Polyline>
          ))}

          {dangerZones.map(zone => {
            // Filter out expired temporary zones
            if (zone.isTemporary && zone.expiresAt && zone.expiresAt.toDate() < new Date()) return null;

            return (
              <Circle 
                key={zone.id}
                center={[zone.lat, zone.lng]}
                radius={zone.radius}
                pathOptions={{ 
                  color: zone.severity === 'high' ? '#FF3B30' : zone.severity === 'medium' ? '#FF9500' : '#FFCC00',
                  fillColor: zone.severity === 'high' ? '#FF3B30' : zone.severity === 'medium' ? '#FF9500' : '#FFCC00',
                  fillOpacity: dangerZonesOnRoute.includes(zone.id) ? 0.6 : 0.3,
                  weight: dangerZonesOnRoute.includes(zone.id) ? 4 : 2,
                  dashArray: dangerZonesOnRoute.includes(zone.id) ? '5, 10' : undefined
                }}
                eventHandlers={{
                  click: () => {
                    setSelectedDangerZone(zone);
                    setSelectedPlace(null);
                    setRoutingTo(null);
                  }
                }}
              />
            );
          })}
          
          {filteredPlaces.map(place => {
            const isLGBTQ = place.lgbtqFriendly;
            const isAccessible = place.wheelchairAccessible;
            
            const customMarkerIcon = L.divIcon({
              className: 'custom-place-icon',
              html: `
                <div class="relative flex items-center justify-center">
                  <div class="w-8 h-8 rounded-full bg-white shadow-lg border-2 flex items-center justify-center overflow-hidden transition-transform hover:scale-110" style="border-color: ${isLGBTQ ? '#FF2D55' : isAccessible ? '#007AFF' : '#34C759'}">
                    ${place.category === 'cafe' ? '<span class="text-[14px]">☕</span>' : 
                      place.category === 'clinic' ? '<span class="text-[14px]">🏥</span>' :
                      place.category === 'shelter' ? '<span class="text-[14px]">🏠</span>' :
                      place.category === 'store' ? '<span class="text-[14px]">🛒</span>' : '<span class="text-[14px]">📍</span>'}
                  </div>
                  ${isLGBTQ ? '<div class="absolute -top-1 -right-1 w-4 h-4 bg-white rounded-full shadow-sm flex items-center justify-center border border-pink-100"><span class="text-[10px]">🏳️‍🌈</span></div>' : ''}
                  ${isAccessible ? '<div class="absolute -bottom-1 -right-1 w-4 h-4 bg-white rounded-full shadow-sm flex items-center justify-center border border-blue-100"><span class="text-[10px]">♿</span></div>' : ''}
                </div>
              `,
              iconSize: [32, 32],
              iconAnchor: [16, 16]
            });

            return (
              <Marker 
                key={place.id} 
                position={[place.lat, place.lng]}
                icon={customMarkerIcon}
                eventHandlers={{
                  click: () => {
                    setSelectedPlace(place);
                    setSelectedDangerZone(null);
                    setRoutingTo(null);
                  }
                }}
              />
            );
          })}
        </MapContainer>

        {/* AI Chat Floating Button */}
        <button 
          onClick={() => setIsAIChatOpen(true)}
          className="absolute bottom-24 right-4 w-14 h-14 bg-[#007AFF] text-white rounded-full shadow-2xl flex items-center justify-center z-[1000] hover:scale-110 transition-all active:scale-95 group"
        >
          <Bot size={28} className="group-hover:rotate-12 transition-transform" />
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-[#34C759] rounded-full border-2 border-white"></div>
        </button>

        {/* My Location Floating Button */}
        <button 
          onClick={locateUser}
          className="absolute bottom-8 right-4 w-14 h-14 bg-white text-[#007AFF] rounded-full shadow-2xl flex items-center justify-center z-[1000] hover:bg-gray-50 transition-all active:scale-95 border border-gray-200"
          aria-label={t('map.my_location')}
        >
          <Navigation size={26} />
        </button>

        {/* Integrated AI Chat Overlay */}
        {isAIChatOpen && (
          <div className="absolute inset-0 z-[2000] bg-black/20 backdrop-blur-sm animate-in fade-in duration-200 flex flex-col justify-end">
            <div className="bg-white w-full h-[80vh] rounded-t-[32px] shadow-2xl flex flex-col animate-in slide-in-from-bottom duration-300">
              {/* AI Chat Header */}
              <div className="p-4 bg-white border-b border-gray-100 flex items-center justify-between rounded-t-[32px]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#007AFF]/10 rounded-full flex items-center justify-center text-[#007AFF]">
                    <HeartHandshake size={24} />
                  </div>
                  <div>
                    <h1 className="text-[17px] font-bold text-black leading-tight">Trợ lý GoMap</h1>
                    <p className="text-[11px] text-[#34C759] font-bold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-[#34C759] rounded-full"></span>
                      Đang hoạt động
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setShowAIHistory(!showAIHistory)}
                    className={`p-2 rounded-full transition-colors ${showAIHistory ? 'bg-[#007AFF] text-white' : 'text-[#8E8E93] hover:bg-gray-100'}`}
                  >
                    <History size={20} />
                  </button>
                  <button 
                    onClick={() => setIsAIChatOpen(false)}
                    className="p-2 text-[#8E8E93] hover:bg-gray-100 rounded-full transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              {/* AI History Overlay */}
              {showAIHistory && (
                <div className="absolute inset-0 z-50 bg-white rounded-t-[32px] flex flex-col animate-in slide-in-from-left duration-200">
                  <div className="p-4 border-b border-gray-100 flex justify-between items-center">
                    <h2 className="font-bold text-lg">Lịch sử trò chuyện</h2>
                    <button onClick={() => setShowAIHistory(false)} className="p-1 text-gray-400">
                      <X size={20} />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {aiChats.map(chat => (
                      <button
                        key={chat.id}
                        onClick={() => {
                          setCurrentAIChatId(chat.id);
                          setShowAIHistory(false);
                        }}
                        className={`w-full text-left p-3 rounded-xl transition-colors flex items-center gap-3 ${currentAIChatId === chat.id ? 'bg-[#007AFF]/10 text-[#007AFF]' : 'hover:bg-gray-50 text-gray-700'}`}
                      >
                        <div className={`w-2 h-2 rounded-full ${currentAIChatId === chat.id ? 'bg-[#007AFF]' : 'bg-gray-300'}`}></div>
                        <span className="truncate text-[15px] font-medium">{chat.title}</span>
                      </button>
                    ))}
                    {aiChats.length === 0 && (
                      <p className="text-center text-gray-400 mt-10 text-sm">Chưa có cuộc trò chuyện nào</p>
                    )}
                  </div>
                  <div className="p-4 border-t border-gray-100">
                    <button 
                      onClick={startNewAIChat}
                      className="w-full bg-[#007AFF] text-white py-3 rounded-xl font-semibold flex items-center justify-center gap-2"
                    >
                      <Plus size={20} />
                      Trò chuyện mới
                    </button>
                  </div>
                </div>
              )}

              {/* AI Chat Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/30">
                {aiMessages.map((msg, index) => (
                  <div 
                    key={index} 
                    className={`flex gap-2 max-w-[85%] ${msg.role === 'user' ? 'ml-auto flex-row-reverse' : ''}`}
                  >
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-auto mb-1 ${msg.role === 'user' ? 'bg-[#007AFF] text-white hidden' : 'bg-white border border-gray-200 text-[#007AFF] shadow-sm'}`}>
                      {msg.role === 'user' ? <User size={14} /> : <Bot size={16} />}
                    </div>
                    <div 
                      className={`p-3 px-4 rounded-2xl ${
                        msg.role === 'user' 
                          ? 'bg-[#007AFF] text-white rounded-br-sm shadow-sm' 
                          : 'bg-white text-black rounded-bl-sm border border-gray-100 shadow-sm'
                      }`}
                    >
                      {msg.imageUrl && (
                        <img src={msg.imageUrl} alt="Attached" className="max-w-full h-auto rounded-xl mb-2 object-cover" />
                      )}
                      {msg.text && <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{msg.text}</p>}
                    </div>
                  </div>
                ))}
                
                {aiStreamingText && (
                  <div className="flex gap-2 max-w-[85%]">
                    <div className="w-7 h-7 rounded-full bg-white border border-gray-200 text-[#007AFF] shadow-sm flex items-center justify-center flex-shrink-0 mt-auto mb-1">
                      <Bot size={16} />
                    </div>
                    <div className="p-3 px-4 rounded-2xl bg-white text-black rounded-bl-sm border border-gray-100 shadow-sm">
                      <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{aiStreamingText}</p>
                    </div>
                  </div>
                )}

                {isAILoading && !aiStreamingText && (
                  <div className="flex gap-2 max-w-[85%]">
                    <div className="w-7 h-7 rounded-full bg-white border border-gray-200 text-[#007AFF] shadow-sm flex items-center justify-center flex-shrink-0 mt-auto mb-1">
                      <Bot size={16} />
                    </div>
                    <div className="p-4 rounded-2xl bg-white rounded-bl-sm flex items-center gap-1.5 border border-gray-100 shadow-sm">
                      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                    </div>
                  </div>
                )}
                <div ref={aiMessagesEndRef} />
              </div>

              {/* AI Chat Input */}
              <div className="p-4 bg-white border-t border-gray-100 pb-safe">
                {aiSelectedImage && (
                  <div className="mb-3 relative inline-block">
                    <img src={aiSelectedImage} alt="Preview" className="h-16 rounded-xl object-cover border border-gray-200" />
                    <button 
                      onClick={() => setAiSelectedImage(null)}
                      className="absolute -top-2 -right-2 bg-gray-800 text-white p-1 rounded-full hover:bg-gray-900 shadow-md"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}
                <form onSubmit={handleAISend} className="flex gap-2 items-end">
                  <input 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    ref={aiFileInputRef} 
                    onChange={handleAIImageUpload} 
                  />
                  <button 
                    type="button"
                    onClick={() => aiFileInputRef.current?.click()}
                    className="p-2.5 text-[#8E8E93] hover:text-[#007AFF] rounded-full transition-colors"
                  >
                    <Paperclip size={22} />
                  </button>
                  <textarea
                    value={aiInput}
                    onChange={(e) => setAiInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleAISend();
                      }
                    }}
                    placeholder="Hỏi trợ lý GoMap..."
                    className="flex-1 max-h-32 min-h-[44px] py-2.5 px-4 bg-gray-100 border-none rounded-[22px] focus:ring-2 focus:ring-[#007AFF]/20 outline-none transition-all resize-none text-[14px]"
                    rows={1}
                  />
                  <button 
                    type="submit"
                    disabled={(!aiInput.trim() && !aiSelectedImage) || isAILoading}
                    className="w-11 h-11 bg-[#007AFF] text-white rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-50 hover:bg-[#007AFF]/80 transition-all active:scale-90 shadow-lg shadow-[#007AFF]/20"
                  >
                    {isAILoading ? <Loader2 size={20} className="animate-spin" /> : <Send size={18} className="ml-0.5" />}
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}
        {(isAddingMode || isAddingDangerMode) && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-[400]">
            <MapPin size={48} className={`${isAddingDangerMode ? 'text-[#FF3B30]' : 'text-[#007AFF]'} -mt-12 drop-shadow-lg animate-bounce`} />
          </div>
        )}

        {/* Add Mode Controls */}
        {(isAddingMode || isAddingDangerMode) && (
          <div className="absolute bottom-6 left-0 right-0 px-4 z-[400] flex flex-col gap-2">
            <div className="bg-white/90 backdrop-blur-xl text-black text-center py-2 px-4 rounded-full shadow-sm text-[13px] font-medium mx-auto border border-gray-200/50">
              Di chuyển bản đồ để chọn vị trí {isAddingDangerMode ? 'nguy hiểm' : 'an toàn'}
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => { setIsAddingMode(false); setIsAddingDangerMode(false); }}
                className="flex-1 bg-white text-[#FF3B30] py-3.5 rounded-[14px] font-semibold shadow-[0_2px_10px_rgba(0,0,0,0.08)] border border-gray-100 text-[17px]"
              >
                Hủy
              </button>
              <button 
                onClick={isAddingDangerMode ? confirmDangerLocation : confirmLocation}
                className={`flex-[2] ${isAddingDangerMode ? 'bg-[#FF3B30]' : 'bg-[#007AFF]'} text-white py-3.5 rounded-[14px] font-semibold shadow-[0_2px_10px_rgba(0,0,0,0.08)] flex items-center justify-center gap-2 text-[17px]`}
              >
                <Check size={20} />
                Xác nhận vị trí
              </button>
            </div>
          </div>
        )}

        {/* Selected Place Overlay */}
        {selectedPlace && !routingTo && (
          <div className={`absolute left-0 right-0 z-[1001] bg-white/98 backdrop-blur-2xl shadow-[0_-12px_40px_rgba(0,0,0,0.12)] border-t border-gray-200/50 transition-all duration-300 ease-out flex flex-col ${showComments ? 'bottom-0 h-[65vh] rounded-t-[32px]' : 'bottom-4 mx-4 rounded-[28px]'}`}>
            {showComments && <div className="w-12 h-1.5 bg-gray-300/60 rounded-full mx-auto mt-3 mb-1 shrink-0" />}
            
            <div className={`flex flex-col ${showComments ? 'overflow-hidden flex-1' : ''}`}>
              <div className={`p-4 flex flex-col gap-2.5 ${showComments ? 'overflow-y-auto max-h-[25vh] shrink-0' : ''}`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="flex items-center gap-1 bg-[#007AFF]/8 text-[#007AFF] text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg border border-[#007AFF]/10">
                        <MapPin size={10} />
                        {selectedPlace.category}
                      </div>
                      {userLocation && (
                        <div className="flex items-center gap-1 text-[11px] text-gray-500 font-semibold bg-gray-50 px-2 py-1 rounded-lg border border-gray-100">
                          <Navigation size={10} className="text-gray-400" />
                          {formatDistance(L.latLng(userLocation).distanceTo(L.latLng(selectedPlace.lat, selectedPlace.lng)))}
                        </div>
                      )}
                    </div>
                    <h2 className="text-[20px] font-black text-gray-900 tracking-tight leading-tight">{selectedPlace.name}</h2>
                  </div>
                  <button 
                    onClick={() => setSelectedPlace(null)}
                    className="bg-gray-100/80 hover:bg-gray-200/80 text-gray-500 p-2 rounded-full transition-all active:scale-90"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="flex items-center gap-3 py-0.5">
                  <div className="flex-1 bg-gray-50/80 p-2 rounded-xl border border-gray-100 flex items-center justify-between">
                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wide">An toàn</span>
                    <div className="flex items-center gap-0.5 text-[#FF9500]">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} size={13} className={i < (selectedPlace.rating || 0) ? "fill-current" : "text-gray-200"} />
                      ))}
                    </div>
                  </div>
                  <div className="flex-1 bg-gray-50/80 p-2 rounded-xl border border-gray-100 flex items-center justify-between">
                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wide">Thân thiện</span>
                    <div className="flex items-center gap-0.5 text-[#FF2D55]">
                      {[...Array(5)].map((_, i) => (
                        <Heart key={i} size={13} className={i < (selectedPlace.inclusivityRating || 0) ? "fill-current" : "text-gray-200"} />
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  {/* Amenities Section - Always visible */}
                  <div className="bg-gray-50/50 rounded-xl border border-gray-100 p-2.5">
                    <div className="flex items-center gap-2 mb-2">
                      <Shield size={14} className="text-gray-400" />
                      <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Tiện ích & Tính năng</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedPlace.wheelchairAccessible && <span className="bg-white text-blue-600 text-[10px] font-bold px-2 py-1 rounded-md flex items-center gap-1 border border-blue-100 shadow-sm"><Accessibility size={10}/> Xe lăn</span>}
                      {selectedPlace.hasRamp && <span className="bg-white text-blue-600 text-[10px] font-bold px-2 py-1 rounded-md border border-blue-100 shadow-sm">Dốc</span>}
                      {selectedPlace.lgbtqFriendly && <span className="bg-white text-pink-600 text-[10px] font-bold px-2 py-1 rounded-md flex items-center gap-1 border border-pink-100 shadow-sm"><Heart size={10}/> LGBTQ+</span>}
                      {selectedPlace.genderNeutralRestroom && <span className="bg-white text-purple-600 text-[10px] font-bold px-2 py-1 rounded-md border border-purple-100 shadow-sm">WC chung</span>}
                      {selectedPlace.quietZone && <span className="bg-white text-green-600 text-[10px] font-bold px-2 py-1 rounded-md flex items-center gap-1 border border-green-100 shadow-sm"><VolumeX size={10}/> Yên tĩnh</span>}
                      {!selectedPlace.wheelchairAccessible && !selectedPlace.hasRamp && !selectedPlace.lgbtqFriendly && !selectedPlace.genderNeutralRestroom && !selectedPlace.quietZone && (
                        <span className="text-[10px] text-gray-400 italic">Không có thông tin tiện ích</span>
                      )}
                    </div>
                  </div>

                  <p className="text-[14px] text-gray-600 leading-relaxed font-medium px-1">{selectedPlace.description}</p>

                  {/* Reviews Section Preview - Moved below description */}
                  <div className="bg-gray-50/50 rounded-xl border border-gray-100 overflow-hidden">
                    <button 
                      onClick={() => setShowReviews(!showReviews)}
                      className="flex items-center justify-between w-full p-2.5 group transition-colors hover:bg-gray-100/50"
                    >
                      <div className="flex items-center gap-2">
                        <MessageCircle size={14} className="text-gray-400" />
                        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Đánh giá cộng đồng</span>
                        {comments.length > 0 && <span className="bg-[#007AFF] text-white text-[9px] font-black px-1.5 py-0.5 rounded-full">{comments.length}</span>}
                      </div>
                      {showReviews ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                    </button>
                    {showReviews && (
                      <div className="px-2.5 pb-2.5 space-y-2.5 animate-in fade-in slide-in-from-top-1 duration-200">
                        {comments.slice(0, 1).map(comment => (
                          <div key={comment.id} className="flex gap-2 bg-white p-2 rounded-lg border border-gray-100 shadow-sm">
                            <img 
                              src={comment.authorPhoto || `https://ui-avatars.com/api/?name=${comment.authorName}`} 
                              alt={comment.authorName} 
                              className="w-5 h-5 rounded-full object-cover shrink-0 bg-gray-100"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-[12px] text-gray-700 line-clamp-2 leading-snug font-medium">{comment.text}</p>
                            </div>
                          </div>
                        ))}
                        {comments.length > 0 ? (
                          <button 
                            onClick={() => setShowComments(true)}
                            className="text-[#007AFF] text-[12px] font-bold hover:underline ml-1"
                          >
                            {comments.length > 1 ? `Xem tất cả ${comments.length} đánh giá` : 'Xem chi tiết đánh giá'}
                          </button>
                        ) : (
                          <p className="text-[12px] text-gray-400 italic px-1">Chưa có đánh giá nào.</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <button 
                    onClick={(e) => { e.stopPropagation(); calculateSafeRoute(selectedPlace); }}
                    className="flex-[2.5] bg-[#007AFF] text-white py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-[#007AFF]/20 hover:bg-[#007AFF]/90 transition-all active:scale-95 text-[15px]"
                  >
                    <ShieldCheck size={20} /> Chỉ đường an toàn
                  </button>
                  <button 
                    onClick={() => setShowComments(!showComments)}
                    className={`flex-1 py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all border ${showComments ? 'bg-gray-100 border-gray-200 text-black' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50 shadow-sm'}`}
                  >
                    <MessageCircle size={20} />
                    {showComments ? <ChevronDown size={16}/> : <ChevronUp size={16}/>}
                  </button>
                </div>
              </div>

              {showComments && (
                <div className="flex-1 flex flex-col overflow-hidden bg-gray-50/50 border-t border-gray-100">
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {comments.map(comment => (
                      <div key={comment.id} className="flex gap-3 animate-in fade-in slide-in-from-bottom-2">
                        <img 
                          src={comment.authorPhoto || `https://ui-avatars.com/api/?name=${comment.authorName}`} 
                          alt={comment.authorName} 
                          className="w-8 h-8 rounded-full object-cover bg-white shadow-sm"
                        />
                        <div className="flex-1">
                          <div className="bg-white p-3 rounded-2xl rounded-tl-none shadow-sm border border-gray-100">
                            <p className="font-bold text-[12px] text-black mb-0.5">{comment.authorName}</p>
                            <p className="text-[14px] text-gray-700 leading-relaxed">{comment.text}</p>
                          </div>
                          <p className="text-[10px] text-gray-400 mt-1 ml-1">
                            {comment.createdAt?.toDate ? comment.createdAt.toDate().toLocaleString('vi-VN') : 'Vừa xong'}
                          </p>
                        </div>
                      </div>
                    ))}
                    {comments.length === 0 && (
                      <div className="text-center py-12 text-gray-400">
                        <MessageCircle size={48} className="mx-auto mb-3 opacity-10" />
                        <p className="text-sm">Chưa có đánh giá nào cho địa điểm này.</p>
                      </div>
                    )}
                  </div>

                  <div className="p-4 bg-white border-t border-gray-100 pb-safe">
                    <form onSubmit={handleAddComment} className="flex gap-2 items-center">
                      <input 
                        type="text"
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        placeholder="Chia sẻ trải nghiệm của bạn..."
                        className="flex-1 bg-gray-100 border-none rounded-2xl px-4 py-3 text-[14px] focus:ring-2 focus:ring-[#007AFF]/20 outline-none transition-all"
                      />
                      <button 
                        type="submit"
                        disabled={!newComment.trim() || isSubmittingComment}
                        className="w-12 h-12 bg-[#007AFF] text-white rounded-2xl flex items-center justify-center disabled:opacity-50 shadow-lg shadow-[#007AFF]/20 transition-all active:scale-90"
                      >
                        {isSubmittingComment ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Selected Danger Zone Overlay */}
        {selectedDangerZone && !routingTo && (
          <div className={`absolute left-0 right-0 z-[1001] bg-white/98 backdrop-blur-2xl shadow-[0_-12px_40px_rgba(0,0,0,0.12)] border-t border-gray-200/50 transition-all duration-300 ease-out flex flex-col ${showComments ? 'bottom-0 h-[65vh] rounded-t-[32px]' : 'bottom-4 mx-4 rounded-[28px]'}`}>
            {showComments && <div className="w-12 h-1.5 bg-gray-300/60 rounded-full mx-auto mt-3 mb-1 shrink-0" />}
            
            <div className={`flex flex-col ${showComments ? 'overflow-hidden flex-1' : ''}`}>
              <div className={`p-4 flex flex-col gap-2.5 ${showComments ? 'overflow-y-auto max-h-[25vh] shrink-0' : ''}`}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="flex items-center gap-1 bg-[#FF3B30]/8 text-[#FF3B30] text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg border border-[#FF3B30]/10">
                        <AlertTriangle size={10} /> Khu vực nguy hiểm
                      </div>
                      <div className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg border ${
                        selectedDangerZone.severity === 'high' ? 'bg-red-50 text-red-700 border-red-100' : 
                        selectedDangerZone.severity === 'medium' ? 'bg-orange-50 text-orange-700 border-orange-100' : 'bg-yellow-50 text-yellow-700 border-yellow-100'
                      }`}>
                        Mức độ: {selectedDangerZone.severity}
                      </div>
                    </div>
                    <h2 className="text-[20px] font-black text-gray-900 tracking-tight leading-tight">{selectedDangerZone.name || 'Khu vực không tên'}</h2>
                  </div>
                  <button 
                    onClick={() => setSelectedDangerZone(null)}
                    className="bg-gray-100/80 hover:bg-gray-200/80 text-gray-500 p-2 rounded-full transition-all active:scale-90"
                  >
                    <X size={18} />
                  </button>
                </div>

                <p className="text-[14px] text-gray-600 leading-relaxed font-medium px-1">{selectedDangerZone.description}</p>

                {/* Reviews Section Preview for Danger Zone - Moved below description */}
                <div className="bg-gray-50/50 rounded-xl border border-gray-100 overflow-hidden">
                  <button 
                    onClick={() => setShowReviews(!showReviews)}
                    className="flex items-center justify-between w-full p-2.5 group transition-colors hover:bg-gray-100/50"
                  >
                    <div className="flex items-center gap-2">
                      <MessageCircle size={14} className="text-gray-400" />
                      <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Đánh giá cộng đồng</span>
                      {comments.length > 0 && <span className="bg-[#007AFF] text-white text-[9px] font-black px-1.5 py-0.5 rounded-full">{comments.length}</span>}
                    </div>
                    {showReviews ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                  </button>
                  {showReviews && (
                    <div className="px-2.5 pb-2.5 space-y-2.5 animate-in fade-in slide-in-from-top-1 duration-200">
                      {comments.slice(0, 1).map(comment => (
                        <div key={comment.id} className="flex gap-2 bg-white p-2 rounded-lg border border-gray-100 shadow-sm">
                          <img 
                            src={comment.authorPhoto || `https://ui-avatars.com/api/?name=${comment.authorName}`} 
                            alt={comment.authorName} 
                            className="w-5 h-5 rounded-full object-cover shrink-0 bg-gray-100"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] text-gray-700 line-clamp-2 leading-snug font-medium">{comment.text}</p>
                          </div>
                        </div>
                      ))}
                      {comments.length > 0 ? (
                        <button 
                          onClick={() => setShowComments(true)}
                          className="text-[#007AFF] text-[12px] font-bold hover:underline ml-1"
                        >
                          {comments.length > 1 ? `Xem tất cả ${comments.length} đánh giá` : 'Xem chi tiết đánh giá'}
                        </button>
                      ) : (
                        <p className="text-[12px] text-gray-400 italic px-1">Chưa có đánh giá nào.</p>
                      )}
                    </div>
                  )}
                </div>

                {selectedDangerZone.isTemporary && (
                  <div className="flex items-center gap-2 text-[12px] text-[#FF9500] font-bold bg-orange-50/50 p-2.5 rounded-xl border border-orange-100/50">
                    <Clock size={14} />
                    Hết hạn: {selectedDangerZone.expiresAt?.toDate().toLocaleString('vi-VN')}
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <div className="flex bg-gray-100/80 rounded-2xl p-1 border border-gray-200/50">
                    <button 
                      onClick={() => handleDangerFeedback(selectedDangerZone.id, 'up')}
                      className="flex items-center gap-1.5 px-3 py-2 hover:bg-white rounded-xl transition-all text-gray-600 hover:text-[#34C759]"
                    >
                      <ThumbsUp size={16} />
                      <span className="text-[13px] font-bold">{selectedDangerZone.upvotes || 0}</span>
                    </button>
                    <div className="w-px h-5 bg-gray-200 self-center"></div>
                    <button 
                      onClick={() => handleDangerFeedback(selectedDangerZone.id, 'down')}
                      className="flex items-center gap-1.5 px-3 py-2 hover:bg-white rounded-xl transition-all text-gray-600 hover:text-[#FF3B30]"
                    >
                      <ThumbsDown size={16} />
                      <span className="text-[13px] font-bold">{selectedDangerZone.downvotes || 0}</span>
                    </button>
                  </div>

                  <button 
                    onClick={() => handleDangerFeedback(selectedDangerZone.id, 'clear')}
                    className="flex-1 bg-white border border-gray-200 text-gray-700 py-3 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-gray-50 transition-all shadow-sm text-[14px]"
                  >
                    <CheckCircle size={16} className="text-[#34C759]" />
                    Đã an toàn
                  </button>
                </div>

                <div className="flex gap-2 pt-0.5">
                  <button 
                    onClick={() => setShowComments(!showComments)}
                    className={`flex-1 py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all border ${showComments ? 'bg-gray-100 border-gray-200 text-black' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50 shadow-sm'}`}
                  >
                    <MessageCircle size={20} />
                    {showComments ? <ChevronDown size={16}/> : <ChevronUp size={16}/>}
                  </button>
                  {user?.uid === selectedDangerZone.addedBy && (
                    <button 
                      onClick={() => { handleDeleteDanger(selectedDangerZone.id); setSelectedDangerZone(null); }}
                      className="p-3.5 bg-[#FF3B30]/8 text-[#FF3B30] rounded-2xl hover:bg-[#FF3B30]/15 transition-colors border border-red-100/50"
                    >
                      <Trash2 size={20} />
                    </button>
                  )}
                </div>
              </div>

              {showComments && (
                <div className="flex-1 flex flex-col overflow-hidden bg-gray-50/50 border-t border-gray-100">
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {comments.map(comment => (
                      <div key={comment.id} className="flex gap-3 animate-in fade-in slide-in-from-bottom-2">
                        <img 
                          src={comment.authorPhoto || `https://ui-avatars.com/api/?name=${comment.authorName}`} 
                          alt={comment.authorName} 
                          className="w-8 h-8 rounded-full object-cover bg-white shadow-sm"
                        />
                        <div className="flex-1">
                          <div className="bg-white p-3 rounded-2xl rounded-tl-none shadow-sm border border-gray-100">
                            <p className="font-bold text-[12px] text-black mb-0.5">{comment.authorName}</p>
                            <p className="text-[14px] text-gray-700 leading-relaxed">{comment.text}</p>
                          </div>
                          <p className="text-[10px] text-gray-400 mt-1 ml-1">
                            {comment.createdAt?.toDate ? comment.createdAt.toDate().toLocaleString('vi-VN') : 'Vừa xong'}
                          </p>
                        </div>
                      </div>
                    ))}
                    {comments.length === 0 && (
                      <div className="text-center py-12 text-gray-400">
                        <MessageCircle size={48} className="mx-auto mb-3 opacity-10" />
                        <p className="text-sm">Chưa có báo cáo nào cho khu vực này.</p>
                      </div>
                    )}
                  </div>

                  <div className="p-4 bg-white border-t border-gray-100 pb-safe">
                    <form onSubmit={handleAddComment} className="flex gap-2 items-center">
                      <input 
                        type="text"
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        placeholder="Báo cáo tình hình tại đây..."
                        className="flex-1 bg-gray-100 border-none rounded-2xl px-4 py-3 text-[14px] focus:ring-2 focus:ring-[#007AFF]/20 outline-none transition-all"
                      />
                      <button 
                        type="submit"
                        disabled={!newComment.trim() || isSubmittingComment}
                        className="w-12 h-12 bg-[#007AFF] text-white rounded-2xl flex items-center justify-center disabled:opacity-50 shadow-lg shadow-[#007AFF]/20 transition-all active:scale-90"
                      >
                        {isSubmittingComment ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Routing Info Overlay */}
        {routingTo && (
          <div className="absolute bottom-4 left-4 right-4 z-[1001] bg-white/95 backdrop-blur-xl p-3 rounded-2xl shadow-[0_-8px_30px_rgba(0,0,0,0.15)] border border-gray-200/60 flex flex-col gap-2 transition-all animate-in slide-in-from-bottom-10">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 bg-gradient-to-br from-[#007AFF] to-[#0056b3] rounded-full flex items-center justify-center text-white shadow-md shrink-0">
                  <ShieldCheck size={20} />
                </div>
                <div className="flex flex-col">
                  <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-0">Đang chỉ đường tới</p>
                  <p className="font-bold text-black text-[15px] leading-tight line-clamp-1">{routingTo.name}</p>
                  
                  {(routeDistance !== null && routeDuration !== null) && (
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex items-center gap-1 text-[12px] font-semibold text-gray-700">
                        <Navigation size={12} className="text-[#007AFF]"/>
                        {formatDistance(routeDistance)}
                      </div>
                      <div className="w-1 h-1 rounded-full bg-gray-300"></div>
                      <div className="flex items-center gap-1 text-[12px] font-semibold text-gray-700">
                        <Clock size={12} className="text-[#FF9500]"/>
                        {formatDuration(routeDuration)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {!isNavigating && (
                <button 
                  onClick={clearRouting}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-600 px-2.5 py-1 rounded-full text-[12px] font-semibold transition-colors shrink-0 flex items-center gap-1"
                >
                  <X size={12} /> Thoát
                </button>
              )}
            </div>

            {dangerZonesOnRoute.length > 0 && (
              <div className="bg-[#FF3B30]/10 border border-[#FF3B30]/20 rounded-lg p-2 flex items-start gap-2 animate-in fade-in zoom-in duration-300">
                <AlertTriangle size={16} className="text-[#FF3B30] shrink-0 mt-0.5" />
                <p className="text-[12px] text-[#FF3B30] font-medium leading-tight">
                  Lộ trình đi qua <span className="font-bold">{dangerZonesOnRoute.length} khu vực nguy hiểm</span>. Hãy cẩn thận!
                </p>
              </div>
            )}

            <div className="flex gap-2 bg-gray-100/80 p-1 rounded-xl mt-0.5">
              <button
                onClick={() => { setRoutingMode('driving'); calculateSafeRoute(routingTo, 'driving'); }}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-[10px] transition-all ${routingMode === 'driving' ? 'bg-white text-[#007AFF] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                disabled={isNavigating}
              >
                Xe máy / Ô tô
              </button>
              <button
                onClick={() => { setRoutingMode('walking'); calculateSafeRoute(routingTo, 'walking'); }}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-[10px] transition-all ${routingMode === 'walking' ? 'bg-white text-[#007AFF] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                disabled={isNavigating}
              >
                Đi bộ
              </button>
            </div>

            {!isNavigating ? (
              <button 
                onClick={() => {
                  setIsNavigating(true);
                  if (userLocation) setMapCenter([...userLocation]);
                }}
                className="w-full bg-[#34C759] hover:bg-[#2fb350] text-white py-2.5 rounded-xl font-bold text-[15px] shadow-lg shadow-[#34C759]/20 transition-colors mt-0.5 flex items-center justify-center gap-2"
              >
                <Navigation size={18} /> Bắt đầu đi
              </button>
            ) : (
              <div className="flex flex-col gap-1.5 mt-0.5">
                <div className="bg-[#34C759]/10 border border-[#34C759]/30 text-[#34C759] py-2 px-3 rounded-xl flex items-center justify-center gap-2 font-bold animate-pulse text-[14px]">
                  <Navigation size={18} /> Đang dẫn đường...
                </div>
                <button 
                  onClick={clearRouting}
                  className="w-full bg-[#FF3B30] hover:bg-[#e6352b] text-white py-2.5 rounded-xl font-bold text-[15px] shadow-lg shadow-[#FF3B30]/20 transition-colors flex items-center justify-center gap-2"
                >
                  <X size={18} /> Thoát chỉ đường
                </button>
              </div>
            )}
          </div>
        )}

        {/* Danger Alert Overlay */}
        {isInsideDanger && activeDangerZone && (
          <div className="absolute top-24 left-4 right-4 z-[1001] bg-[#FF3B30] p-4 rounded-2xl shadow-2xl border border-[#FF3B30]/20 flex items-center gap-4 animate-bounce-subtle">
            <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center text-white shrink-0">
              <AlertTriangle size={28} />
            </div>
            <div className="flex-1">
              <p className="text-white font-bold text-[15px]">CẢNH BÁO NGUY HIỂM!</p>
              <p className="text-white/90 text-[13px] leading-tight">
                Bạn đang ở trong khu vực: <span className="font-bold">{activeDangerZone.name}</span>. Hãy cẩn thận!
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Danger Zone Modal */}
      {showDangerModal && (
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-[24px] w-full max-w-md flex flex-col shadow-2xl">
            <div className="flex justify-between items-center p-4 border-b border-gray-100">
              <h2 className="text-[17px] font-semibold text-[#FF3B30] flex items-center gap-2">
                <AlertTriangle size={20} /> Báo Cáo Khu Vực Nguy Hiểm
              </h2>
              <button onClick={() => setShowDangerModal(false)} className="p-1.5 text-[#8E8E93] hover:text-black bg-gray-100 rounded-full">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleSaveDanger} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-1">Tên khu vực / Lý do</label>
                <input 
                  required
                  type="text" 
                  placeholder="VD: Đoạn đường vắng, hay có trộm..."
                  className="w-full rounded-xl bg-gray-100 p-3 outline-none focus:ring-2 focus:ring-[#FF3B30]/20"
                  value={newDanger.name}
                  onChange={e => setNewDanger({...newDanger, name: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Mức độ nguy hiểm</label>
                <select 
                  className="w-full rounded-xl bg-gray-100 p-3 outline-none"
                  value={newDanger.severity}
                  onChange={e => setNewDanger({...newDanger, severity: e.target.value as any})}
                >
                  <option value="low">Thấp (Cần chú ý)</option>
                  <option value="medium">Trung bình (Nên tránh)</option>
                  <option value="high">Cao (Nguy hiểm - Tuyệt đối tránh)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Bán kính ảnh hưởng (mét): {newDanger.radius}m</label>
                <input 
                  type="range" min="50" max="500" step="50"
                  className="w-full accent-[#FF3B30]"
                  value={newDanger.radius}
                  onChange={e => setNewDanger({...newDanger, radius: parseInt(e.target.value)})}
                />
              </div>

              <div className="bg-gray-50 p-3 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock size={18} className="text-[#FF9500]" />
                    <span className="text-sm font-semibold">Cảnh báo tạm thời</span>
                  </div>
                  <div className="w-12 h-6 rounded-full bg-[#34C759] relative">
                    <div className="absolute top-1 w-4 h-4 bg-white rounded-full left-7"></div>
                  </div>
                </div>
                
                <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Thời gian hiệu lực (giờ): {newDanger.duration}h</label>
                  <input 
                    type="range" min="1" max="72" step="1"
                    className="w-full accent-[#34C759]"
                    value={newDanger.duration}
                    onChange={e => setNewDanger({...newDanger, duration: parseInt(e.target.value)})}
                  />
                </div>
              </div>

              <button 
                type="submit"
                disabled={loading}
                className="w-full bg-[#FF3B30] text-white py-3.5 rounded-xl font-bold flex items-center justify-center gap-2"
              >
                {loading && <Loader2 size={20} className="animate-spin" />}
                Gửi Báo Cáo
              </button>
            </form>
          </div>
        </div>
      )}

      {showModal && (
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-[24px] w-full max-w-md max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex justify-between items-center p-4 border-b border-gray-100">
              <h2 className="text-[17px] font-semibold text-black">
                {editingPlace ? 'Chỉnh Sửa Địa Điểm' : 'Thêm Địa Điểm An Toàn'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1.5 text-[#8E8E93] hover:text-black bg-gray-100 rounded-full">
                <X size={20} />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-5">
              <form id="place-form" onSubmit={handleSavePlace} className="space-y-5">
                {/* Image Upload */}
                <div>
                  <label className="block text-[15px] font-semibold text-black mb-2">Hình ảnh (Tùy chọn)</label>
                  {image ? (
                    <div className="relative rounded-[14px] overflow-hidden border border-gray-200">
                      <img src={image} alt="Preview" className="w-full h-40 object-cover" />
                      <button 
                        type="button"
                        onClick={() => setImage(null)}
                        className="absolute top-2 right-2 bg-black/50 text-white p-1.5 rounded-full hover:bg-black/70 backdrop-blur-md"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full h-32 border-2 border-dashed border-gray-300 rounded-[14px] flex flex-col items-center justify-center text-[#8E8E93] hover:bg-gray-50 hover:border-[#007AFF] hover:text-[#007AFF] cursor-pointer transition-colors"
                    >
                      <ImageIcon size={32} className="mb-2" />
                      <span className="text-[15px] font-medium">Nhấn để tải ảnh lên</span>
                    </div>
                  )}
                  <input 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    ref={fileInputRef} 
                    onChange={handleImageUpload} 
                  />
                </div>

                {/* Name */}
                <div>
                  <label className="block text-[15px] font-semibold text-black mb-2">Tên địa điểm</label>
                  <input 
                    required
                    type="text" 
                    placeholder="VD: Quán Cafe An Nhiên"
                    className="w-full rounded-[10px] bg-[#767680]/12 border-transparent focus:bg-white focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/20 p-3 outline-none transition-all text-[15px] text-black placeholder-[#8E8E93]"
                    value={newPlace.name}
                    onChange={e => setNewPlace({...newPlace, name: e.target.value})}
                  />
                </div>

                {/* Category */}
                <div>
                  <label className="block text-[15px] font-semibold text-black mb-2">Danh mục</label>
                  <select 
                    className="w-full rounded-[10px] bg-[#767680]/12 border-transparent focus:bg-white focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/20 p-3 outline-none transition-all text-[15px] text-black"
                    value={newPlace.category}
                    onChange={e => setNewPlace({...newPlace, category: e.target.value})}
                  >
                    <option value="cafe">Quán Cafe / Nhà hàng</option>
                    <option value="clinic">Phòng Khám / Y tế</option>
                    <option value="shelter">Nơi Trú Ẩn / Hỗ trợ</option>
                    <option value="store">Cửa Hàng / Siêu thị</option>
                    <option value="other">Khác</option>
                  </select>
                </div>

                {/* Rating */}
                <div>
                  <label className="block text-[15px] font-semibold text-black mb-2">Đánh giá mức độ an toàn</label>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setRating(star)}
                        className="focus:outline-none transition-transform hover:scale-110"
                      >
                        <Star 
                          size={32} 
                          className={star <= rating ? "fill-[#FF9500] text-[#FF9500]" : "text-gray-300"} 
                        />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Inclusivity Rating */}
                <div>
                  <label className="block text-[15px] font-semibold text-black mb-2">Độ mở lòng / Thân thiện với người yếu thế</label>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setInclusivityRating(star)}
                        className="focus:outline-none transition-transform hover:scale-110"
                      >
                        <Heart 
                          size={32} 
                          className={star <= inclusivityRating ? "fill-[#FF2D55] text-[#FF2D55]" : "text-gray-300"} 
                        />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Accessibility & Inclusivity Features */}
                <div>
                  <label className="block text-[15px] font-semibold text-black mb-2">Tiện ích hỗ trợ</label>
                  <div className="space-y-3 bg-[#767680]/5 p-4 rounded-[10px]">
                    <label className="flex items-center gap-3">
                      <input type="checkbox" checked={newPlace.wheelchairAccessible} onChange={e => setNewPlace({...newPlace, wheelchairAccessible: e.target.checked})} className="w-5 h-5 rounded text-[#007AFF] focus:ring-[#007AFF]" />
                      <span className="text-[15px] text-black flex items-center gap-2"><Accessibility size={18} className="text-[#007AFF]"/> Xe lăn có thể vào</span>
                    </label>
                    <label className="flex items-center gap-3">
                      <input type="checkbox" checked={newPlace.hasRamp} onChange={e => setNewPlace({...newPlace, hasRamp: e.target.checked})} className="w-5 h-5 rounded text-[#007AFF] focus:ring-[#007AFF]" />
                      <span className="text-[15px] text-black">Có đường dốc cho xe lăn</span>
                    </label>
                    <label className="flex items-center gap-3">
                      <input type="checkbox" checked={newPlace.lgbtqFriendly} onChange={e => setNewPlace({...newPlace, lgbtqFriendly: e.target.checked})} className="w-5 h-5 rounded text-[#FF2D55] focus:ring-[#FF2D55]" />
                      <span className="text-[15px] text-black flex items-center gap-2"><Heart size={18} className="text-[#FF2D55]"/> Thân thiện với LGBTQ+</span>
                    </label>
                    <label className="flex items-center gap-3">
                      <input type="checkbox" checked={newPlace.genderNeutralRestroom} onChange={e => setNewPlace({...newPlace, genderNeutralRestroom: e.target.checked})} className="w-5 h-5 rounded text-[#AF52DE] focus:ring-[#AF52DE]" />
                      <span className="text-[15px] text-black">Nhà vệ sinh phi giới tính</span>
                    </label>
                    <label className="flex items-center gap-3">
                      <input type="checkbox" checked={newPlace.quietZone} onChange={e => setNewPlace({...newPlace, quietZone: e.target.checked})} className="w-5 h-5 rounded text-[#34C759] focus:ring-[#34C759]" />
                      <span className="text-[15px] text-black flex items-center gap-2"><VolumeX size={18} className="text-[#34C759]"/> Không gian yên tĩnh</span>
                    </label>
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-[15px] font-semibold text-black mb-2">Mô tả chi tiết</label>
                  <textarea 
                    required
                    placeholder="Chia sẻ lý do tại sao nơi này an toàn..."
                    className="w-full rounded-[10px] bg-[#767680]/12 border-transparent focus:bg-white focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/20 p-3 outline-none transition-all resize-none text-[15px] text-black placeholder-[#8E8E93]"
                    rows={3}
                    value={newPlace.description}
                    onChange={e => setNewPlace({...newPlace, description: e.target.value})}
                  />
                </div>
              </form>
            </div>

            <div className="p-4 border-t border-gray-100 bg-white rounded-b-[24px]">
              <button 
                form="place-form"
                type="submit"
                disabled={loading || !selectedLocation}
                className="w-full bg-[#007AFF] text-white py-3.5 px-4 rounded-[14px] hover:bg-[#007AFF]/90 font-semibold text-[17px] flex items-center justify-center gap-2 disabled:opacity-70 transition-colors"
              >
                {loading ? <Loader2 size={20} className="animate-spin" /> : null}
                {editingPlace ? 'Lưu Thay Đổi' : 'Đăng Địa Điểm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

