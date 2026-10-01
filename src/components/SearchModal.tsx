import React, { useState, useEffect, useRef } from 'react';
import { useFocusable, FocusContext, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { Search, X, Film, Tv, Music, ArrowLeft, Loader2 } from 'lucide-react';
import { MediaCard } from './MediaCard';
import { MediaItem } from '../mockData';
import { jellyfinClient } from '../api/jellyfin';
import { useAppState } from '../state/AppStateContext';

interface SearchModalProps {
  onClose: () => void;
  onSelectMedia: (item: MediaItem) => void;
}

const KEYBOARD_ROWS = [
  ['A', 'B', 'C', 'D', 'E', 'F', '1', '2', '3'],
  ['G', 'H', 'I', 'J', 'K', 'L', '4', '5', '6'],
  ['M', 'N', 'O', 'P', 'Q', 'R', '7', '8', '9'],
  ['S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', '0'],
  ['SPACE', 'BACKSPACE', 'CLEAR']
];

export const SearchModal: React.FC<SearchModalProps> = ({ onClose, onSelectMedia }) => {
  const {
    allMovies,
    recentMovies,
    allSeries,
    heroItems,
    allMusic,
    nextUp,
    userFavorites
  } = useAppState();

  const [query, setQuery] = useState('');
  const [filterType, setFilterType] = useState<'All' | 'Movie' | 'Series' | 'Audio'>('All');
  const [results, setResults] = useState<MediaItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const { ref, focusKey } = useFocusable({
    focusKey: 'SEARCH_MODAL_VIEW',
    isFocusBoundary: true
  });

  // Prime focus on letter 'A' of virtual keyboard on mount so remote works immediately
  useEffect(() => {
    const timer = setTimeout(() => {
      setFocus('SEARCH_KEY_A');
    }, 150);
    return () => clearTimeout(timer);
  }, []);

  // Handle physical keyboard typing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.keyCode === 10009) {
        onClose();
        return;
      }
      if (e.key === 'Backspace') {
        setQuery((prev) => prev.slice(0, -1));
      } else if (e.key === ' ' || e.key === 'Spacebar') {
        setQuery((prev) => prev + ' ');
      } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        setQuery((prev) => prev + e.key);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Live robust hybrid search: strictly Series, Films, and Music (excluding episode names)
  useEffect(() => {
    const rawPool = [
      ...heroItems,
      ...recentMovies,
      ...allMovies,
      ...allSeries,
      ...allMusic,
      ...userFavorites
    ];

    // Filter strictly to Series, Films, and Music (exclude any episode items)
    const localPool = rawPool.filter((item) => {
      if (item.type === 'tv') {
        return !item.episodeName && item.episodeNumber === undefined;
      }
      return item.type === 'movie' || item.type === 'music';
    });

    if (!query.trim()) {
      // Show popular / recommended items if query is empty (Series, Films, Music only)
      const uniqueRecs: MediaItem[] = [];
      const seen = new Set<string>();
      for (const item of localPool) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          uniqueRecs.push(item);
        }
        if (uniqueRecs.length >= 12) break;
      }
      setResults(uniqueRecs);
      setIsSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      const q = query.trim().toLowerCase();

      // 1. Search local pool (Series, Films, Music only - strictly exclude episode names)
      const localMatches = localPool.filter((item) => {
        if (filterType === 'Movie' && item.type !== 'movie') return false;
        if (filterType === 'Series' && item.type !== 'tv') return false;
        if (filterType === 'Audio' && item.type !== 'music') return false;

        return (
          item.title?.toLowerCase().includes(q) ||
          item.artist?.toLowerCase().includes(q) ||
          item.overview?.toLowerCase().includes(q) ||
          item.genres?.some((g) => g.toLowerCase().includes(q))
        );
      });

      // 2. Search Jellyfin server if authenticated (includes Movie, Series, Audio only)
      let serverMatches: MediaItem[] = [];
      if (jellyfinClient.isAuthenticated()) {
        try {
          const itemTypeParam = filterType === 'All' ? undefined : filterType;
          serverMatches = await jellyfinClient.searchMedia(query.trim(), itemTypeParam);
        } catch (e) {
          console.warn('Server search error:', e);
        }
      }

      // Merge and deduplicate
      const combined: MediaItem[] = [...serverMatches];
      const seen = new Set(serverMatches.map((i) => i.id));
      for (const localItem of localMatches) {
        if (!seen.has(localItem.id)) {
          seen.add(localItem.id);
          combined.push(localItem);
        }
      }

      setResults(combined);
      setIsSearching(false);
    }, 180);

    return () => clearTimeout(timer);
  }, [query, filterType, allMovies, recentMovies, allSeries, allMusic, heroItems, userFavorites]);

  const handleVirtualKey = (key: string) => {
    if (key === 'SPACE') {
      setQuery((prev) => prev + ' ');
    } else if (key === 'BACKSPACE') {
      setQuery((prev) => prev.slice(0, -1));
    } else if (key === 'CLEAR') {
      setQuery('');
    } else {
      setQuery((prev) => prev + key);
    }
  };

  return (
    <FocusContext.Provider value={focusKey}>
      <div
        ref={ref}
        className="search-modal"
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0, left: 0,
          zIndex: 950,
          backgroundColor: 'rgba(5, 7, 12, 0.96)',
          backdropFilter: 'blur(28px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: '36px 48px',
          boxSizing: 'border-box'
        }}
      >
        {/* Top Header Bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <FocusableActionButton
              focusKey="SEARCH_BACK_BTN"
              onSelect={onClose}
              icon={<ArrowLeft size={22} />}
              label="Back"
              onRight={() => setFocus('SEARCH_FILTER_All')}
            />
            <h2 style={{ fontSize: '1.8rem', fontWeight: 800, letterSpacing: '-0.5px', margin: 0 }}>
              Search Jellyfin
            </h2>
          </div>

          {/* Filter Pills */}
          <div style={{ display: 'flex', gap: '10px' }}>
            {(['All', 'Movie', 'Series', 'Audio'] as const).map((type) => (
              <FilterPillButton
                key={type}
                focusKey={`SEARCH_FILTER_${type}`}
                onLeftEdge={type === 'All' ? () => setFocus('SEARCH_BACK_BTN') : undefined}
                label={type === 'All' ? 'All' : type === 'Movie' ? 'Movies' : type === 'Series' ? 'TV Shows' : 'Music'}
                isActive={filterType === type}
                onSelect={() => setFilterType(type)}
              />
            ))}
          </div>
        </div>

        {/* Search Bar Input Display */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            backgroundColor: 'rgba(255, 255, 255, 0.08)',
            border: '2px solid rgba(var(--accent-rgb), 0.4)',
            borderRadius: '20px',
            padding: '12px 24px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.15)',
            marginBottom: '24px'
          }}
        >
          <Search size={24} color="var(--accent)" />
          <div style={{ flex: 1, fontSize: '1.4rem', fontWeight: 600, color: query ? '#ffffff' : 'rgba(255, 255, 255, 0.4)' }}>
            {query || 'Type to search movies, TV series, songs, artists...'}
          </div>
          {isSearching && <Loader2 size={22} color="var(--accent)" className="animate-spin" />}
          {query && (
            <button
              onClick={() => setQuery('')}
              style={{
                background: 'rgba(255, 255, 255, 0.15)',
                border: 'none',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#fff'
              }}
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Content Layout: Virtual TV Keyboard (Left) + Search Results (Right) */}
        <div style={{ display: 'flex', gap: '40px', flex: 1, minHeight: 0 }}>
          {/* On-screen TV Keyboard */}
          <div
            style={{
              width: '360px',
              flexShrink: 0,
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '24px',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}
          >
            <div style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.5)', fontWeight: 600, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              Virtual Remote Keyboard
            </div>
            {KEYBOARD_ROWS.map((row, rIdx) => (
              <div key={rIdx} style={{ display: 'flex', gap: '6px' }}>
                {row.map((k) => (
                  <VirtualKeyButton
                    key={k}
                    keyChar={k}
                    onPress={() => handleVirtualKey(k)}
                    isSpecial={k.length > 1}
                  />
                ))}
              </div>
            ))}
          </div>

          {/* Search Results Grid */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              paddingRight: '12px'
            }}
          >
            {results.length > 0 ? (
              <div>
                <div style={{ fontSize: '0.95rem', color: 'rgba(255, 255, 255, 0.6)', fontWeight: 600, marginBottom: '16px' }}>
                  Found {results.length} result{results.length !== 1 ? 's' : ''}
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
                    gap: '20px',
                    paddingBottom: '60px'
                  }}
                >
                  {results.map((item) => (
                    <MediaCard
                      key={item.id}
                      item={item}
                      aspectRatio={item.type === 'tv' ? 'backdrop' : item.type === 'music' ? 'square' : 'poster'}
                      onSelect={(selected) => {
                        onClose();
                        onSelectMedia(selected);
                      }}
                    />
                  ))}
                </div>
              </div>
            ) : query.trim() ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '70%',
                  color: 'rgba(255, 255, 255, 0.5)',
                  gap: '12px'
                }}
              >
                <Search size={48} strokeWidth={1.5} color="rgba(255, 255, 255, 0.3)" />
                <p style={{ fontSize: '1.1rem', margin: 0 }}>No media matching "{query}" found</p>
                <span style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.4)' }}>
                  Check your spelling or try another keyword
                </span>
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '70%',
                  color: 'rgba(255, 255, 255, 0.4)',
                  gap: '14px'
                }}
              >
                <Search size={54} strokeWidth={1.2} color="rgba(255, 255, 255, 0.2)" />
                <p style={{ fontSize: '1.1rem', margin: 0 }}>Search by title, artist, director, or genre</p>
                <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
                    <Film size={16} /> Movies
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
                    <Tv size={16} /> TV Shows
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}>
                    <Music size={16} /> Songs & Albums
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </FocusContext.Provider>
  );
};

interface FocusableActionButtonProps {
  focusKey: string;
  onSelect: () => void;
  icon: React.ReactNode;
  label: string;
  onRight?: () => void;
}

const FocusableActionButton: React.FC<FocusableActionButtonProps> = ({ focusKey, onSelect, icon, label, onRight }) => {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: onSelect,
    // Remote: → goes along the top row to the filters (they're far right, the keyboard is closer)
    onArrowPress: (dir) => {
      if (dir === 'right' && onRight) {
        onRight();
        return false;
      }
      return true;
    }
  });

  return (
    <button
      ref={ref}
      onClick={onSelect}
      className={`focusable ${focused ? 'focused' : ''}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 18px',
        borderRadius: '30px',
        border: focused ? '2px solid #ffffff' : '1px solid rgba(255, 255, 255, 0.2)',
        backgroundColor: focused ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.08)',
        color: '#ffffff',
        cursor: 'pointer',
        fontSize: '0.95rem',
        fontWeight: 600,
        boxShadow: focused ? '0 0 16px rgba(255, 255, 255, 0.4)' : 'none',
        transform: focused ? 'scale(1.05)' : 'scale(1)',
        transition: 'all 0.2s ease'
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
};

interface FilterPillButtonProps {
  label: string;
  isActive: boolean;
  onSelect: () => void;
  focusKey?: string;
  onLeftEdge?: () => void;
}

const FilterPillButton: React.FC<FilterPillButtonProps> = ({ label, isActive, onSelect, focusKey, onLeftEdge }) => {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: onSelect,
    onArrowPress: (dir) => {
      if (dir === 'left' && onLeftEdge) {
        onLeftEdge();
        return false;
      }
      return true;
    }
  });

  return (
    <button
      ref={ref}
      onClick={onSelect}
      className={`focusable ${focused ? 'focused' : ''}`}
      style={{
        padding: '6px 16px',
        borderRadius: '20px',
        border: focused
          ? '2px solid var(--accent)'
          : isActive
          ? '1px solid rgba(var(--accent-rgb), 0.6)'
          : '1px solid rgba(255, 255, 255, 0.15)',
        backgroundColor: focused
          ? 'rgba(var(--accent-rgb), 0.3)'
          : isActive
          ? 'rgba(var(--accent-rgb), 0.15)'
          : 'rgba(255, 255, 255, 0.05)',
        color: isActive || focused ? '#ffffff' : 'rgba(255, 255, 255, 0.6)',
        fontWeight: 600,
        fontSize: '0.85rem',
        cursor: 'pointer',
        boxShadow: focused ? '0 0 12px rgba(var(--accent-rgb), 0.5)' : 'none',
        transform: focused ? 'scale(1.05)' : 'scale(1)',
        transition: 'all 0.18s ease'
      }}
    >
      {label}
    </button>
  );
};

interface VirtualKeyButtonProps {
  keyChar: string;
  onPress: () => void;
  isSpecial?: boolean;
}

const VirtualKeyButton: React.FC<VirtualKeyButtonProps> = ({ keyChar, onPress, isSpecial }) => {
  const { ref, focused } = useFocusable({
    focusKey: 'SEARCH_KEY_' + keyChar,
    onEnterPress: onPress
  });

  return (
    <button
      ref={ref}
      onClick={onPress}
      className={`focusable ${focused ? 'focused' : ''}`}
      style={{
        flex: isSpecial ? (keyChar === 'SPACE' ? 2 : 1.5) : 1,
        height: '38px',
        borderRadius: '8px',
        border: focused ? '2px solid #ffffff' : '1px solid rgba(255, 255, 255, 0.12)',
        backgroundColor: focused ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.06)',
        color: '#ffffff',
        fontSize: isSpecial ? '0.75rem' : '0.9rem',
        fontWeight: 700,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: focused ? 'scale(1.08)' : 'scale(1)',
        boxShadow: focused ? '0 0 12px rgba(255, 255, 255, 0.45)' : 'none',
        transition: 'all 0.15s ease'
      }}
    >
      {keyChar}
    </button>
  );
};
