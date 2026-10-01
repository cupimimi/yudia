import React, { useRef, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useFocusable, FocusContext } from '@noriginmedia/norigin-spatial-navigation';
import { MediaItem } from '../mockData';
import { MediaCard } from './MediaCard';

interface MediaRowProps {
  title: string;
  items: MediaItem[];
  onSelect: (item: MediaItem) => void;
  aspectRatio?: 'poster' | 'backdrop' | 'square';
  rowFocusKey: string;
  className?: string;
  badge?: string;
  /** "grid": cards wrap onto new lines and the page scrolls down (All Movies / All Series). Default: one row. */
  layout?: 'row' | 'grid';
}

export const MediaRow: React.FC<MediaRowProps> = ({
  title,
  items,
  onSelect,
  aspectRatio = 'poster',
  rowFocusKey,
  className = '',
  badge,
  layout = 'row'
}) => {
  const isGrid = layout === 'grid';
  const rowRef = useRef<HTMLDivElement>(null);

  // Mouse users (website on a laptop): ‹ › buttons page the row. Hidden on TVs — see .row-arrow in index.css.
  const [edges, setEdges] = useState({ left: false, right: false });
  const updateEdges = () => {
    const el = rowRef.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  useEffect(updateEdges, [items.length]);
  const page = (dir: 1 | -1) => {
    const el = rowRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  const { ref, focusKey, hasFocusedChild } = useFocusable({
    focusKey: rowFocusKey,
    focusable: !!items && items.length > 0 // an empty row is hidden: it must not catch the remote
  });

  // Smooth auto-scroll container when a child inside the row gets focused
  useEffect(() => {
    if (hasFocusedChild && rowRef.current) {
      const focusedElement = rowRef.current.querySelector('.focused') as HTMLElement;
      if (focusedElement) {
        const container = rowRef.current;
        const scrollLeft = focusedElement.offsetLeft - container.offsetLeft - 48;
        container.scrollTo({ left: Math.max(0, scrollLeft), behavior: 'smooth' });
      }
    }
  }, [hasFocusedChild]);

  if (!items || items.length === 0) return null;

  if (items.length === 0) return null; // empty list: no title with nothing under it

  return (
    <FocusContext.Provider value={focusKey}>
      <div
        ref={ref}
        className={className}
        style={{
          marginBottom: '32px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}
      >
        <h3
          className="media-row__title"
          style={{
            fontSize: '1.25rem',
            fontWeight: 700,
            paddingLeft: '48px',
            color: hasFocusedChild ? '#ffffff' : 'rgba(255,255,255,0.85)',
            transition: 'color 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}
        >
          <span>{title}</span>
          {badge && (
            <span
              style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                color: 'var(--accent)',
                backgroundColor: 'rgba(var(--accent-rgb), 0.12)',
                border: '1px solid rgba(var(--accent-rgb), 0.3)',
                padding: '2px 8px',
                borderRadius: '12px',
                letterSpacing: '0.4px',
                textTransform: 'uppercase'
              }}
            >
              {badge}
            </span>
          )}
        </h3>

        <div className="media-row-scroller" style={{ position: 'relative' }}>
        {!isGrid && edges.left && (
          <button className="row-arrow row-arrow--left" tabIndex={-1} aria-label="Scroll left" onClick={() => page(-1)}>
            <ChevronLeft size={34} />
          </button>
        )}
        {!isGrid && edges.right && (
          <button className="row-arrow row-arrow--right" tabIndex={-1} aria-label="Scroll right" onClick={() => page(1)}>
            <ChevronRight size={34} />
          </button>
        )}
        <div
          ref={rowRef}
          onScroll={updateEdges}
          className={`media-row__track ${isGrid ? 'media-row__track--grid' : ''}`}
          style={{
            display: 'flex',
            flexWrap: isGrid ? 'wrap' : 'nowrap',
            gap: isGrid ? '28px 20px' : '20px',
            paddingLeft: '48px',
            paddingRight: '48px',
            overflowX: isGrid ? 'visible' : 'auto',
            paddingTop: '10px',
            paddingBottom: '20px',
            scrollBehavior: 'smooth'
          }}
        >
          {items.map((item) => (
            <MediaCard
              key={item.id}
              item={item}
              onSelect={onSelect}
              aspectRatio={aspectRatio}
            />
          ))}
        </div>
        </div>
      </div>
    </FocusContext.Provider>
  );
};
