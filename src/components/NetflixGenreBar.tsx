import React, { useRef, useEffect } from 'react';
import { useFocusable, FocusContext } from '@noriginmedia/norigin-spatial-navigation';
import { Sparkles } from 'lucide-react';

interface NetflixGenreBarProps {
  focusKeyId: string;
  selectedGenre: string;
  onSelectGenre: (genre: string) => void;
  genres?: string[];
}

const DEFAULT_GENRES = [
  'All',
  'Action',
  'Sci-Fi',
  'Drama',
  'Comedy',
  'Thriller',
  'Adventure',
  'Mystery',
  'Crime',
  'Animation'
];

export const NetflixGenreBar: React.FC<NetflixGenreBarProps> = ({
  focusKeyId,
  selectedGenre,
  onSelectGenre,
  genres = DEFAULT_GENRES
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const { ref, focusKey, hasFocusedChild } = useFocusable({
    focusKey: focusKeyId
  });

  // Smooth scroll container when active genre changes
  useEffect(() => {
    if (hasFocusedChild && containerRef.current) {
      const activeEl = containerRef.current.querySelector('.focused') as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }
  }, [hasFocusedChild]);

  return (
    <FocusContext.Provider value={focusKey}>
      <div
        ref={ref}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '28px',
          position: 'relative',
          zIndex: 10
        }}
      >
        <div
          ref={containerRef}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            overflowX: 'auto',
            padding: '6px 4px',
            scrollBehavior: 'smooth'
          }}
          className="no-scrollbar"
        >
          {genres.map((genre) => (
            <GenrePillButton
              key={genre}
              genre={genre}
              isSelected={selectedGenre.toLowerCase() === genre.toLowerCase()}
              onSelect={() => onSelectGenre(genre)}
            />
          ))}
        </div>
      </div>
    </FocusContext.Provider>
  );
};

const GenrePillButton: React.FC<{
  genre: string;
  isSelected: boolean;
  onSelect: () => void;
}> = ({ genre, isSelected, onSelect }) => {
  const { ref, focused } = useFocusable({
    onEnterPress: onSelect
  });

  return (
    <button
      ref={ref}
      onClick={onSelect}
      className={`focusable ${focused ? 'focused' : ''}`}
      style={{
        padding: '8px 20px',
        borderRadius: '24px',
        border: focused
          ? '2px solid #ffffff'
          : isSelected
          ? '1px solid rgba(var(--accent-rgb), 0.6)'
          : '1px solid rgba(255, 255, 255, 0.12)',
        backgroundColor: focused
          ? 'rgba(255, 255, 255, 0.28)'
          : isSelected
          ? 'rgba(var(--accent-rgb), 0.16)'
          : 'rgba(255, 255, 255, 0.05)',
        backdropFilter: 'blur(16px)',
        color: focused ? '#ffffff' : isSelected ? 'var(--accent)' : 'rgba(255, 255, 255, 0.75)',
        fontSize: '0.9rem',
        fontWeight: isSelected || focused ? 700 : 500,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        transform: focused ? 'scale(1.05)' : 'scale(1)',
        boxShadow: focused
          ? '0 0 20px rgba(255, 255, 255, 0.4), 0 4px 12px rgba(0,0,0,0.5)'
          : isSelected
          ? '0 0 14px rgba(var(--accent-rgb), 0.25)'
          : 'none',
        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
      }}
    >
      {genre === 'All' && <Sparkles size={13} color={isSelected ? 'var(--accent)' : 'currentColor'} />}
      <span>{genre}</span>
    </button>
  );
};
