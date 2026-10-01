import React, { useSyncExternalStore } from 'react';
import { Cast } from 'lucide-react';
import { FocusableButton } from './FocusableButton';
import { castSupported, getCastState, openCastDialog, subscribeCast, CastState } from '../services/cast';

/** Live Google Cast state (website only; always "unavailable" on the TV app). */
export const useCast = (): CastState => useSyncExternalStore(subscribeCast, getCastState);

/**
 * Cast button. Shown only on the website when a Cast device is on the network. Opens the browser's device picker
 * (or its stop dialog while casting). Accent-coloured while connected.
 */
export const CastButton: React.FC<{
  focusKey?: string;
  className?: string;
  style?: React.CSSProperties;
  plain?: boolean; // a simple <button> (phone top bar) instead of a remote-focusable one
}> = ({ focusKey, className, style, plain }) => {
  const cast = useCast();
  if (!castSupported() || !cast.ready || (!cast.available && !cast.connected)) return null;
  const label = cast.connected ? `Casting to ${cast.deviceName || 'your TV'}` : 'Cast to a TV';
  const color = cast.connected ? 'var(--accent)' : undefined;
  const icon = <Cast size={plain ? 22 : 20} color={color} className={cast.connecting ? 'animate-pulse' : undefined} />;
  if (plain) {
    return (
      <button className={className} style={style} aria-label={label} title={label} onClick={openCastDialog}>
        {icon}
      </button>
    );
  }
  return (
    <FocusableButton focusKey={focusKey} onPress={openCastDialog} className={className} style={{ ...(color ? { borderColor: color } : {}), ...style }}>
      <span aria-label={label} title={label} style={{ display: 'inline-flex' }}>
        {icon}
      </span>
    </FocusableButton>
  );
};
