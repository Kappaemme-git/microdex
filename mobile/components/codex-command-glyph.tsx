import { MicrodexIcon, type MicrodexIconName } from '@/components/microdex-icon';
import { MicrodexActionGlyph } from '@/components/microdex-keycap-glyph';
import { findMicroAction } from '@/lib/micro-actions';

const COMMAND_ICON_OVERRIDES: Readonly<Record<string, MicrodexIconName>> = {
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
 * legacy keycap identifier. Overrides keep commands that share one keycap
 * visually distinct while all artwork stays in the Microdex icon family.
 */
export function CodexCommandGlyph({
  actionId,
  size = 22,
  color = '#111719',
}: CodexCommandGlyphProps) {
  const icon = COMMAND_ICON_OVERRIDES[actionId];
  const action = findMicroAction(actionId);

  if (icon) return <MicrodexIcon name={icon} size={size} color={color} />;
  if (action) {
    return <MicrodexIcon name={action.icon} size={size} color={color} />;
  }
  return <MicrodexActionGlyph actionId={actionId} size={size} color={color} />;
}
