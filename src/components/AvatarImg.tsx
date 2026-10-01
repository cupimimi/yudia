import React, { useEffect, useState } from 'react';
import { useAvatarSrc } from '../utils/avatarCache';

/**
 * <img> for Jellyfin profile pictures: shows the small, upright cached thumbnail (see utils/avatarCache.ts)
 * instead of the full-size photo, which Jellyfin serves unresized and sideways for phone pictures.
 * Renders nothing when the user has no picture / it can't load (no broken-image icon).
 */
export const AvatarImg: React.FC<React.ImgHTMLAttributes<HTMLImageElement>> = ({ src, style, ...rest }) => {
  const thumb = useAvatarSrc(src);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  if (!src || broken) return null;
  return (
    <img
      {...rest}
      src={thumb}
      decoding="async"
      onError={() => setBroken(true)}
      style={{ ...style, visibility: thumb ? 'visible' : 'hidden' }}
    />
  );
};
