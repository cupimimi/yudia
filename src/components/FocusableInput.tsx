import React, { useEffect, useRef } from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';

interface FocusableInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  focusKeyId?: string;
  onEnterPress?: () => void;
  onArrowPress?: (direction: string) => boolean;
}

export const FocusableInput: React.FC<FocusableInputProps> = ({
  focusKeyId,
  onEnterPress,
  onArrowPress,
  className,
  style,
  ...props
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const { ref, focused } = useFocusable({
    focusKey: focusKeyId,
    onEnterPress: () => {
      // Focus the actual HTML input element to trigger system on-screen keyboards
      inputRef.current?.focus();
      if (onEnterPress) {
        onEnterPress();
      }
    },
    onArrowPress
  });

  useEffect(() => {
    if (focused && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [focused]);

  return (
    <div
      ref={ref}
      className={`focusable-input-wrapper ${focused ? 'focused' : ''} ${className || ''}`}
      style={{
        display: 'block',
        width: '100%',
        borderRadius: '14px',
        border: focused ? '2px solid #ffffff' : '2px solid transparent',
        transition: 'all 0.2s ease',
        boxSizing: 'border-box',
        ...style
      }}
    >
      <input
        ref={inputRef}
        {...props}
        style={{
          width: '100%',
          padding: '14px 18px',
          borderRadius: '12px',
          backgroundColor: focused ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.08)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          color: '#ffffff',
          fontSize: '1rem',
          outline: 'none',
          boxSizing: 'border-box',
          ...style
        }}
      />
    </div>
  );
};
