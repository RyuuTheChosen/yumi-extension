/**
 * Avatar Component
 * Reusable avatar with fallbacks and size variants
 */

import { useState } from 'react';
import { cn } from '../../lib/design/utils';

interface AvatarProps {
  src?: string;
  fallback?: string;
  alt?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  style?: React.CSSProperties;
}

const sizeClasses = {
  xs: 'w-6 h-6 text-xs',
  sm: 'w-8 h-8 text-sm',
  md: 'w-10 h-10 text-base',
  lg: 'w-12 h-12 text-lg',
  xl: 'w-16 h-16 text-xl',
};

export function Avatar({ 
  src, 
  fallback = '?', 
  alt = 'Avatar',
  size = 'md',
  className,
  style 
}: AvatarProps) {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  
  return (
    <div
      className={cn(
        'relative flex items-center justify-center rounded-full bg-white/20 text-white font-bold overflow-hidden',
        'transition-all duration-200 ease-smooth',
        sizeClasses[size],
        className
      )}
      style={style}
      role="img"
      aria-label={alt}
    >
      {src && !imageError ? (
        <img
          src={src}
          alt={alt}
          className={cn(
            'w-full h-full object-cover transition-opacity duration-300',
            imageLoaded ? 'opacity-100' : 'opacity-0'
          )}
          onError={() => setImageError(true)}
          onLoad={() => setImageLoaded(true)}
        />
      ) : (
        <span className="select-none">{fallback}</span>
      )}
    </div>
  );
}
