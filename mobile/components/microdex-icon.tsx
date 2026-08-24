import { useMemo } from 'react';
import { SvgXml, type SvgProps } from 'react-native-svg';

import {
  CENTRAL_ICON_XML,
  type CentralIconSource,
} from '@/components/central-icon-data';

/**
 * Stable semantic aliases used by saved layouts and action metadata. Every
 * alias now resolves to the custom SVG artwork supplied with the project, so
 * the picker, manager and physical-style key always match.
 */
const MICRODEX_ICONS = {
  skillsBlock: '3d-package-2',
  sidebarPanel: 'layout-sidebar',
  gitCommit: 'commits',
  reviewPanel: 'checklist',
  bottomPanel: 'layout-bottom',
  archive: 'archive',
  arrowLeft: 'arrow-left',
  arrowUp: 'arrow-up',
  refresh: 'arrow-rotate-clockwise',
  link: 'chain-link-2',
  chat: 'chat-bubble-7',
  successCircle: 'check-circle-2',
  check: 'checkmark-2-small',
  chevronDown: 'chevron-bottom',
  chevronRight: 'chevron-right',
  output: 'airplay',
  close: 'cross-medium',
  alert: 'exclamation-circle-bold',
  copy: 'square-behind-square-4',
  folder: 'folder-1',
  folderRemove: 'folder-delete',
  folderOpen: 'folder-open',
  search: 'search-menu',
  moon: 'moon',
  plus: 'plus-medium',
  qrCode: 'qr-code',
  settings: 'settings-gear-2',
  sun: 'sun',
  trash: 'trash-can',
  'arrow-decision-outline': 'arrow-split-right',
  'arrow-top-right-thick': 'arrow-up-right',
  blur: 'apple-intelligence-icon',
  brain: 'brain-1',
  'bug-outline': 'bug',
  'call-split': 'fork-code',
  'check-circle-outline': 'check-circle-2',
  'checkbox-blank-outline': 'square-placeholder',
  'clock-outline': 'clock',
  'close-circle-outline': 'circle-x',
  'cloud-upload-outline': 'cloud-upload',
  'cog-outline': 'settings-gear-2',
  console: 'code-lines',
  'cursor-default-click-outline': 'cursor-click',
  'dots-grid': 'layout-grid-1',
  'flask-outline': 'test-tube-2',
  'folder-plus-outline': 'folder-add-right',
  'format-paint': 'paint-brush',
  'head-cog-outline': 'brain-2',
  'lightning-bolt-outline': 'lightning',
  'microphone-outline': 'microphone',
  'party-popper': 'celebrate',
  'play-circle-outline': 'play-circle',
  'plus-box-outline': 'square-plus',
  'plus-minus-variant': 'difference-modified',
  'robot-outline': 'code-assistant',
  'rocket-launch-outline': 'rocket',
  'source-branch': 'branch',
  'source-branch-plus': 'pull-request-simple',
  'source-merge': 'merged',
  'source-pull': 'pull-request',
  'star-four-points-outline': 'sparkle-central',
  'trash-can-outline': 'trash-can',
  'tray-arrow-down': 'cloud-simple-download',
  'archive-outline': 'archive',
  'arrow-left': 'arrow-left',
  'arrow-right': 'arrow-right',
  'backspace-outline': 'keyboard-down',
  'book-open-page-variant-outline': 'book',
  'chevron-down': 'chevron-bottom',
  'chevron-up': 'chevron-top',
  'clipboard-check-outline': 'checklist',
  'clipboard-text-outline': 'clipboard',
  'content-copy': 'square-behind-square-4',
  'dock-bottom': 'layout-bottom',
  'file-tree': 'code-tree',
  'folder-swap-outline': 'folders-2',
  'keyboard-outline': 'keyboard',
  magnify: 'search-menu',
  menu: 'bars-three',
  'message-plus-outline': 'chat-bubbles',
  'page-layout-sidebar-left': 'layout-sidebar',
  paperclip: 'paperclip-1',
  'pin-outline': 'pin',
  'plus-circle-outline': 'circle-plus',
  'puzzle-outline': 'puzzle',
  'source-commit': 'commits',
  'tune-variant': 'settings-slider-three',
  web: 'browser-tabs',
  'play-outline': 'play-circle',
  'exit-to-app': 'arrow-out-of-box',
  'circle-outline': 'circle',
  'voice-wave': 'voice-mode',
  'gamepad-round-outline': 'gamepad-controls',
  waveform: 'voice-3',
  'label-outline': 'tag',
} as const satisfies Record<string, CentralIconSource>;

export type MicrodexIconName = keyof typeof MICRODEX_ICONS;

type MicrodexIconProps = {
  name: MicrodexIconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: SvgProps['style'];
};

export function MicrodexIcon({
  name,
  size = 24,
  color = '#111719',
  strokeWidth = 1.5,
  style,
}: MicrodexIconProps) {
  const source = MICRODEX_ICONS[name];
  const xml = useMemo(
    () => CENTRAL_ICON_XML[source].replace(
      /stroke-width="[^"]+"/g,
      `stroke-width="${strokeWidth}"`,
    ),
    [source, strokeWidth],
  );

  return (
    <SvgXml
      xml={xml}
      width={size}
      height={size}
      color={color}
      style={style}
    />
  );
}
