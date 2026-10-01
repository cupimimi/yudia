import React from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';

interface FocusableButtonProps {
  onPress: () => void;
  children: React.ReactNode;
  className?: string;
  focusKey?: string;
  autoFocus?: boolean;
  onArrowPress?: (direction: string) => boolean;
  style?: React.CSSProperties;
  disabled?: boolean;
}

export const FocusableButton: React.FC<FocusableButtonProps> = ({
  onPress,
  children,
  className = '',
  focusKey,
  onArrowPress,
  style = {},
  disabled = false
}) => {
  const { ref, focused } = useFocusable({
    focusKey,
    focusable: !disabled,
    onEnterPress: () => {
      if (!disabled) onPress();
    },
    onArrowPress
  });

  React.useEffect(() => {
    if (focused && ref.current) {
      ref.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest'
      });
    }
  }, [focused]);

  return (
    <button
      ref={ref}
      onClick={() => {
        if (!disabled) onPress();
      }}
      disabled={disabled}
      className={`focusable ${focused ? 'focused' : ''} ${className}`}
      style={{
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        border: '1px solid rgba(255, 255, 255, 0.2)',
        borderRadius: '12px',
        padding: '12px 24px',
        fontSize: '1rem',
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '10px',
        color: '#ffffff',
        background: focused
          ? 'linear-gradient(135deg, rgba(255,255,255,0.3) 0%, rgba(255,255,255,0.15) 100%)'
          : 'rgba(255, 255, 255, 0.08)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        transition: 'all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)',
        ...style
      }}
    >
      {children}
    </button>
  );
};
