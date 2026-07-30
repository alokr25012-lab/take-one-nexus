'use client';

import React, { useCallback, useRef, useState } from 'react';
import { fetchWithCSRF } from '@/utils/fetchWithCSRF';

// TODO(security): Malware scanning is not implemented. Images are stored in Supabase
// which provides no built-in AV scanning. Consider a third-party AV API for hardening.

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const MAX_FILE_SIZE_MB = 5;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export interface AvatarUploaderProps {
  /** Current avatar URL to display (null/undefined renders the placeholder) */
  currentUrl?: string | null;
  /** 'group' uploads to /api/chat/conversations/:id/avatar;
   *  'community' uploads to /api/community/logo */
  type: 'group' | 'community';
  /** conversationId for groups, communityId for communities */
  targetId: number;
  /** Whether the current user has permission to change the avatar */
  isAdmin: boolean;
  /** Called with the new public URL after a successful upload, or null after removal */
  onSuccess: (newUrl: string | null) => void;
  /** Display size in px (default 80) */
  size?: number;
  /** Shape of the avatar (default 'rounded' for groups, can be 'circle') */
  shape?: 'circle' | 'rounded';
}

type UploadState = 'idle' | 'dragging' | 'uploading' | 'success' | 'error';

export default function AvatarUploader({
  currentUrl,
  type,
  targetId,
  isAdmin,
  onSuccess,
  size = 80,
  shape = 'rounded',
}: AvatarUploaderProps) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(currentUrl ?? null);
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const borderRadius = shape === 'circle' ? '50%' : '12px';
  const isUploading = uploadState === 'uploading';

  // --- Validation ---
  const validateFile = (file: File): string | null => {
    const ext = '.' + (file.name.split('.').pop()?.toLowerCase() || '');
    if (!ALLOWED_MIME_TYPES.includes(file.type) || !ALLOWED_EXTENSIONS.includes(ext)) {
      return `Unsupported format. Please use JPG, PNG, or WebP.`;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return `File too large. Maximum size is ${MAX_FILE_SIZE_MB} MB.`;
    }
    return null;
  };

  // --- Upload logic ---
  const uploadFile = useCallback(
    async (file: File) => {
      const validationError = validateFile(file);
      if (validationError) {
        setErrorMsg(validationError);
        setUploadState('error');
        return;
      }

      setUploadState('uploading');
      setProgress(0);
      setErrorMsg('');

      // Simulate progress (fetch does not expose upload progress natively)
      const progressInterval = setInterval(() => {
        setProgress((p) => {
          if (p >= 85) { clearInterval(progressInterval); return p; }
          return p + Math.random() * 15;
        });
      }, 200);

      try {
        const token =
          typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;

        const formData = new FormData();
        if (type === 'group') {
          formData.append('avatar', file);
        } else {
          formData.append('logo', file);
          formData.append('communityId', String(targetId));
        }

        const endpoint =
          type === 'group'
            ? `/api/chat/conversations/${targetId}/avatar`
            : '/api/community/logo';

        const res = await fetchWithCSRF(endpoint, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: formData,
        });

        clearInterval(progressInterval);

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.message || 'Upload failed');
        }

        const newUrl: string = type === 'group' ? data.avatar_url : data.logo_url;
        setProgress(100);
        setAvatarUrl(newUrl);
        setUploadState('success');
        onSuccess(newUrl);

        // Auto-reset success state after 2s
        setTimeout(() => setUploadState('idle'), 2000);
      } catch (err: any) {
        clearInterval(progressInterval);
        setErrorMsg(err.message || 'Upload failed. Please try again.');
        setUploadState('error');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [type, targetId, onSuccess]
  );

  // --- Remove avatar ---
  const removeAvatar = useCallback(async () => {
    setUploadState('uploading');
    setErrorMsg('');
    try {
      const token =
        typeof window !== 'undefined' ? localStorage.getItem('take_one_token') : null;

      const endpoint =
        type === 'group'
          ? `/api/chat/conversations/${targetId}/avatar`
          : '/api/community/avatar';

      const body =
        type === 'community' ? JSON.stringify({ communityId: targetId }) : undefined;

      const res = await fetchWithCSRF(endpoint, {
        method: 'DELETE',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(type === 'community' ? { 'Content-Type': 'application/json' } : {}),
        },
        body,
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to remove avatar');
      }

      setAvatarUrl(null);
      setUploadState('idle');
      onSuccess(null);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to remove avatar.');
      setUploadState('error');
    }
  }, [type, targetId, onSuccess]);

  // --- Drag & Drop handlers ---
  const handleDragOver = (e: React.DragEvent) => {
    if (!isAdmin || isUploading) return;
    e.preventDefault();
    setUploadState('dragging');
  };

  const handleDragLeave = () => {
    if (uploadState === 'dragging') setUploadState('idle');
  };

  const handleDrop = (e: React.DragEvent) => {
    if (!isAdmin || isUploading) return;
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
    else setUploadState('idle');
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = ''; // Reset so same file can be re-selected
  };

  const handleClick = () => {
    if (!isAdmin || isUploading) return;
    fileInputRef.current?.click();
  };

  // --- Derived styles ---
  const wrapperBorderColor =
    uploadState === 'dragging'
      ? 'rgba(200,255,0,0.8)'
      : uploadState === 'error'
      ? 'rgba(255,80,80,0.7)'
      : uploadState === 'success'
      ? 'rgba(80,255,120,0.7)'
      : 'rgba(200,255,0,0.18)';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '10px',
        width: '100%',
      }}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
        disabled={!isAdmin || isUploading}
        aria-label="Upload avatar image"
      />

      {/* Avatar preview + drag-and-drop zone */}
      <div
        style={{
          position: 'relative',
          width: size,
          height: size,
          borderRadius,
          overflow: 'hidden',
          flexShrink: 0,
          cursor: isAdmin && !isUploading ? 'pointer' : 'default',
          border: `2px ${uploadState === 'dragging' ? 'dashed' : 'solid'} ${wrapperBorderColor}`,
          transition: 'border-color 0.25s ease, box-shadow 0.25s ease',
          background: 'rgba(0,0,0,0.4)',
          boxShadow: uploadState === 'dragging' ? '0 0 18px rgba(200,255,0,0.25)' : 'none',
        }}
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        role={isAdmin ? 'button' : undefined}
        aria-label={isAdmin ? `Change ${type} avatar` : `${type} avatar`}
        tabIndex={isAdmin ? 0 : undefined}
        onKeyDown={(e) => e.key === 'Enter' && handleClick()}
        title={isAdmin ? 'Click or drag to upload a new image' : undefined}
      >
        {/* Image or placeholder */}
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={`${type} avatar`}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
              opacity: isUploading ? 0.35 : 1,
              transition: 'opacity 0.2s ease',
            }}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(200,255,0,0.06)',
              opacity: isUploading ? 0.35 : 1,
              transition: 'opacity 0.2s ease',
            }}
          >
            {/* Camera icon */}
            <svg
              viewBox="0 0 24 24"
              width={Math.round(size * 0.38)}
              height={Math.round(size * 0.38)}
              stroke="rgba(200,255,0,0.4)"
              strokeWidth="1.5"
              fill="none"
            >
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </div>
        )}

        {/* Uploading / dragging overlay */}
        {isAdmin && (isUploading || uploadState === 'dragging') && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0,0,0,0.6)',
              gap: '6px',
            }}
          >
            {isUploading ? (
              <>
                <span
                  style={{
                    fontSize: '10px',
                    color: '#fff',
                    letterSpacing: '1px',
                    textTransform: 'uppercase',
                  }}
                >
                  Uploading…
                </span>
                {/* Progress bar */}
                <div
                  style={{
                    width: '70%',
                    height: '3px',
                    background: 'rgba(255,255,255,0.15)',
                    borderRadius: '2px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(progress, 100)}%`,
                      background: 'var(--neon, #c8ff00)',
                      borderRadius: '2px',
                      transition: 'width 0.15s linear',
                    }}
                  />
                </div>
              </>
            ) : (
              <span
                style={{
                  fontSize: '10px',
                  color: 'var(--neon, #c8ff00)',
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                }}
              >
                Drop to upload
              </span>
            )}
          </div>
        )}
      </div>

      {/* Action buttons row (admins only) */}
      {isAdmin && (
        <div
          style={{
            display: 'flex',
            gap: '6px',
            alignItems: 'center',
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          <button
            type="button"
            onClick={handleClick}
            disabled={isUploading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              background: 'rgba(200,255,0,0.1)',
              border: '1px solid rgba(200,255,0,0.3)',
              borderRadius: '6px',
              color: 'var(--neon, #c8ff00)',
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.5px',
              padding: '5px 10px',
              cursor: isUploading ? 'not-allowed' : 'pointer',
              opacity: isUploading ? 0.5 : 1,
              transition: 'background 0.2s, border-color 0.2s',
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="12"
              height="12"
              stroke="currentColor"
              strokeWidth="2.5"
              fill="none"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            {isUploading ? 'Uploading…' : 'Upload Image'}
          </button>

          {avatarUrl && !isUploading && (
            <button
              type="button"
              onClick={removeAvatar}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                background: 'rgba(255,60,60,0.07)',
                border: '1px solid rgba(255,60,60,0.28)',
                borderRadius: '6px',
                color: 'rgba(255,110,110,0.9)',
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '0.5px',
                padding: '5px 10px',
                cursor: 'pointer',
                transition: 'background 0.2s, border-color 0.2s',
              }}
            >
              <svg
                viewBox="0 0 24 24"
                width="12"
                height="12"
                stroke="currentColor"
                strokeWidth="2.5"
                fill="none"
              >
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
              Remove
            </button>
          )}
        </div>
      )}

      {/* Status messages */}
      {uploadState === 'success' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '11px',
            color: 'rgba(80,255,120,0.9)',
            letterSpacing: '0.5px',
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width="12"
            height="12"
            stroke="currentColor"
            strokeWidth="2.5"
            fill="none"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Avatar updated!
        </div>
      )}

      {uploadState === 'error' && errorMsg && (
        <div
          style={{
            fontSize: '11px',
            color: 'rgba(255,100,100,0.9)',
            textAlign: 'center',
            maxWidth: '200px',
            lineHeight: 1.4,
          }}
        >
          {errorMsg}{' '}
          <button
            type="button"
            onClick={() => { setUploadState('idle'); setErrorMsg(''); }}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255,100,100,0.7)',
              cursor: 'pointer',
              fontSize: '11px',
              textDecoration: 'underline',
              padding: 0,
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Format hint */}
      {isAdmin && uploadState === 'idle' && (
        <p
          style={{
            margin: 0,
            fontSize: '10px',
            color: 'rgba(200,200,200,0.3)',
            textAlign: 'center',
            letterSpacing: '0.5px',
          }}
        >
          JPG · PNG · WebP · max {MAX_FILE_SIZE_MB}MB · drag or click
        </p>
      )}
    </div>
  );
}
