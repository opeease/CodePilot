'use client';

import { useTranslation } from '@/hooks/useTranslation';
import type { TranslationKey } from '@/i18n';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';

interface SlashCommandButtonProps {
  onInsertSlash: () => void;
}

export function SlashCommandButton({ onInsertSlash }: SlashCommandButtonProps) {
  const { t } = useTranslation();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <PromptInputButton onClick={onInsertSlash}>
          <span className="text-sm font-medium leading-none">/</span>
        </PromptInputButton>
      </TooltipTrigger>
      <TooltipContent>
        {t('composer.slashCommandTooltip' as TranslationKey)}
      </TooltipContent>
    </Tooltip>
  );
}
