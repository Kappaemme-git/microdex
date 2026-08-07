import { MaterialCommunityIcons } from '@expo/vector-icons';

import { CentralIcon, type CentralIconName } from '@/components/central-icon';
import { CodexMicroActionGlyph } from '@/components/codex-micro-glyph';
import { findMicroAction } from '@/lib/micro-actions';

const COMMAND_ICON_OVERRIDES: Readonly<Record<string, CentralIconName>> = {
  toggleSidebar: 'sidebarPanel',
  'workspace.openSkills': 'skillsBlock',
  'git.commit': 'gitCommit',
  'workspace.toggleReviewPanel': 'reviewPanel',
  'workspace.toggleBottomPanel': 'bottomPanel',
};

type CodexCommandGlyphProps = {
  actionId: string;
  size?: number;
  color?: string;
};

/**
 * The command picker needs semantic command icons, not only the suggested
 * physical keycap. Overrides keep commands that share one keycap visually
 * distinct while every other action retains its official Micro legend.
 */
export function CodexCommandGlyph({
  actionId,
  size = 22,
  color = '#111719',
}: CodexCommandGlyphProps) {
  const icon = COMMAND_ICON_OVERRIDES[actionId];
  const action = findMicroAction(actionId);

  if (icon) return <CentralIcon name={icon} size={size} color={color} />;
  if (action) {
    return <MaterialCommunityIcons name={action.icon} size={size} color={color} />;
  }
  return <CodexMicroActionGlyph actionId={actionId} size={size} color={color} />;
}
