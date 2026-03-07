'use client';

import { useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { HugeiconsIcon } from '@hugeicons/react';
import { LockIcon, SquareUnlock02Icon, ArrowDown01Icon } from '@hugeicons/core-free-icons';

interface ChatPermissionSelectorProps {
  sessionId?: string;
  permissionProfile: 'default' | 'full_access';
  onPermissionChange: (profile: 'default' | 'full_access') => void;
}

export function ChatPermissionSelector({
  sessionId,
  permissionProfile,
  onPermissionChange,
}: ChatPermissionSelectorProps) {
  const { t } = useTranslation();
  const [showWarning, setShowWarning] = useState(false);

  const handleSelect = (profile: 'default' | 'full_access') => {
    if (profile === 'full_access' && permissionProfile !== 'full_access') {
      setShowWarning(true);
      return;
    }
    applyChange(profile);
  };

  const applyChange = async (profile: 'default' | 'full_access') => {
    // No sessionId yet (new chat) — local-only update
    if (!sessionId) {
      onPermissionChange(profile);
      return;
    }
    try {
      const res = await fetch(`/api/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permission_profile: profile }),
      });
      if (!res.ok) {
        console.warn(`[ChatPermissionSelector] PATCH failed: ${res.status}`);
        return;
      }
      onPermissionChange(profile);
    } catch (err) {
      console.warn('[ChatPermissionSelector] PATCH error:', err);
    }
  };

  const isFullAccess = permissionProfile === 'full_access';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              isFullAccess
                ? 'bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            <HugeiconsIcon
              icon={isFullAccess ? SquareUnlock02Icon : LockIcon}
              className={`h-3.5 w-3.5 ${isFullAccess ? 'text-red-500' : ''}`}
            />
            <span>
              {isFullAccess ? t('permission.fullAccess') : t('permission.default')}
            </span>
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              className="h-2.5 w-2.5 opacity-60"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[140px]">
          <DropdownMenuItem onClick={() => handleSelect('default')}>
            <HugeiconsIcon icon={LockIcon} className="h-3.5 w-3.5" />
            <span>{t('permission.default')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleSelect('full_access')}>
            <HugeiconsIcon icon={SquareUnlock02Icon} className="h-3.5 w-3.5 text-red-500" />
            <span>{t('permission.fullAccess')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={showWarning} onOpenChange={setShowWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('permission.fullAccess')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('permission.fullAccessWarning')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setShowWarning(false);
                applyChange('full_access');
              }}
            >
              {t('permission.fullAccess')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
